import { collectTabs } from './tab-collector.js';
import { collectBookmarks, collectTree, isUnfiled, ROOT_IDS, BAR_ID } from './bookmark-collector.js';
import { reconcile } from './activity-tracker.js';
import { indexById, mapGroupResult, mapStaleResult, mapImportantResult, mapOrganizeResult, validatePlanItem } from './plan.js';
import { findDuplicateBookmarks, findStaleBookmarks, getVisitsMap, checkDeadLinks, recordDeadStrikes, dedupeDeletes } from './bookmark-health.js';
import { findDuplicateTabs } from './tab-health.js';
import { applyItem as defaultApplyItem } from './executor.js';
import { recordUndo as defaultRecordUndo } from './undo-log.js';
import { redactUrl, isPrivateHost } from './url-utils.js';
import { withLock } from './mutex.js';
import { applyWhitelist, applyFolderProtection } from './protections.js';

// High-impact/destructive actions are never auto-applied — they always wait for
// explicit review, even in auto mode.
const REVIEW_ONLY = new Set(['deleteBookmark', 'moveBookmark', 'removeFolder']);
export function partitionForApply(items, settings) {
  if (settings.automationMode !== 'auto') return { autoApply: [], needsReview: items };
  const autoApply = items.filter((i) => !REVIEW_ONLY.has(i.action));
  const needsReview = items.filter((i) => REVIEW_ONLY.has(i.action));
  return { autoApply, needsReview };
}

// What we actually send to the native host: a minimal, explicit projection so
// no incidental tab fields (or future additions) leak to the model.
// Coarsen private/loopback hosts to origin-only so internal paths (tokens, IDs)
// on localhost / RFC-1918 / *.local aren't sent to the AI provider; public hosts
// keep their path (needed for grouping) with query+fragment redacted.
function safeUrlForModel(url) {
  if (isPrivateHost(url)) { try { return new URL(url).origin; } catch { return ''; } }
  return redactUrl(url);
}

export function projectTabsForHost(tabs) {
  return tabs.map((t) => ({ tabId: t.tabId, title: t.title, url: safeUrlForModel(t.url), idleDays: t.idleDays, pinned: !!t.pinned, groupName: t.groupName || '' }));
}

// match/additive only touch bookmarks that aren't in a folder (directly under a
// root); full considers every bookmark. `rootIds` is the live set from
// collectTree (varies by browser); defaults to Chrome's ids.
export function selectOrganizeCandidates(bookmarks, mode, rootIds) {
  return mode === 'full' ? bookmarks.slice() : bookmarks.filter((b) => isUnfiled(b, rootIds));
}

export function projectBookmarksForHost(bookmarks) {
  return bookmarks.map((b) => ({ id: b.id, title: b.title, url: safeUrlForModel(b.url), folder: (b.path || []).join('/') }));
}

// Proposes removeFolder items for leaf folders (no subfolders) that are empty now
// or would be emptied by `moves`. Skips roots. Bar/whitelist protection and the
// executor's own empty-guard are applied downstream (one pass, no cascade).
export function findEmptyFolders(folders, bookmarks, moves = [], rootIds = ROOT_IDS) {
  const lost = new Map(), gained = new Map(), subfolders = new Map(), bmCount = new Map();
  for (const m of moves) {
    const d = m.data || {};
    if (d.fromParentId) lost.set(d.fromParentId, (lost.get(d.fromParentId) || 0) + 1);
    if (d.toParentId) gained.set(d.toParentId, (gained.get(d.toParentId) || 0) + 1); // newFolderPath targets aren't existing folders
  }
  for (const f of folders) subfolders.set(f.parentId, (subfolders.get(f.parentId) || 0) + 1);
  for (const b of bookmarks) bmCount.set(b.parentId, (bmCount.get(b.parentId) || 0) + 1);
  const items = [];
  for (const f of folders) {
    if (rootIds.has(f.id)) continue;
    if ((subfolders.get(f.id) || 0) > 0) continue;
    const remaining = (bmCount.get(f.id) || 0) - (lost.get(f.id) || 0) + (gained.get(f.id) || 0);
    if (remaining <= 0) items.push({ itemId: `rf-${f.id}`, action: 'removeFolder', status: 'pending', reason: 'Empty folder', data: { folderId: f.id, parentId: f.parentId, index: f.index, title: f.title } });
  }
  return items;
}

// Builds the full plan for the enabled features. `deps` is injectable for tests;
// in production it defaults to real collectors + a native client passed in.
export async function buildPlan(deps) {
  const { settings, nativeClient, chromeApi = chrome, now = Date.now() } = deps;
  const onProgress = deps.onProgress || (() => {});
  const onWarning = deps.onWarning || (() => {});
  const shouldCancel = deps.shouldCancel || (() => false);
  const PHASES = 6;
  let done = 0;
  let folders = []; // folder inventory captured by the organize phase, for finalize protection
  let rootIds, barId; // real root ids/bar id from the live tree (browser-specific)
  const step = (label) => { onProgress(label, done++, PHASES); };

  const rawTabs = await chromeApi.tabs.query({});
  // Serialize with the activity-tracker listeners (same 'tabActivity' key) so this
  // reconcile can't clobber a just-written lastActive, and vice-versa.
  const activity = await withLock('tabActivity', async () => {
    const priorActivity = (await chromeApi.storage.local.get('tabActivity')).tabActivity || {};
    const next = reconcile(priorActivity, rawTabs, now);
    await chromeApi.storage.local.set({ tabActivity: next });
    return next;
  });
  let tabs = await collectTabs(chromeApi, activity, now, deps.windowId ?? null);
  // Sort-just-these mode: keep only the requested tabs and run grouping over all
  // of them (whether or not they're already grouped, like regroupExisting),
  // skipping every other phase (duplicates, forgotten tabs, bookmarks).
  const onlyTabIds = Array.isArray(deps.onlyTabIds) ? new Set(deps.onlyTabIds) : null;
  if (onlyTabIds) tabs = tabs.filter((t) => onlyTabIds.has(t.tabId));
  const byId = indexById(tabs);
  const items = [];
  const f = { ...settings.enabledFeatures, ...(deps.features || {}) };
  const rules = decisionRules(settings.decisions || {}).keep.join('; ');
  const adapter = settings.adapter || 'claude';

  step('Finding duplicate tabs');
  if (shouldCancel()) return finalizePlan(items, settings, folders);
  if (!onlyTabIds && f.dupeTabs && tabs.length) {
    try { items.push(...findDuplicateTabs(tabs)); } catch (e) { console.warn('[organizer] duplicate-tabs phase failed:', e); }
  }

  step('Grouping tabs');
  if (shouldCancel()) return finalizePlan(items, settings, folders);
  if (f.groupTabs && tabs.length) {
    // Normally only currently-ungrouped (loose) tabs are sent, so re-running
    // doesn't shuffle already-organized groups. onlyTabIds (sort-just-these) and
    // deps.regroupAll ("Re-sort all groups") both send every collected tab so the
    // organizer may move tabs between existing groups too. regroupAll is a
    // per-run flag that replaces the old regroupExisting setting.
    // mode 'mine' makes the model reuse existing/parked group names only;
    // 'suggest' (default) lets it invent new groups. An explicit deps.groupMode
    // ('mine' or 'suggest') always wins — in particular, 'suggest' overrides the
    // onlyTabIds/regroupAll default of 'mine', so "Suggest new groups for the
    // leftovers" can invent groups for just those tabs.
    try {
      const regroupAll = onlyTabIds || deps.regroupAll;
      const mode = deps.groupMode === 'mine' || deps.groupMode === 'suggest' || deps.groupMode === 'leftovers'
        ? deps.groupMode
        : (onlyTabIds || deps.regroupAll ? 'mine' : 'suggest');
      const candidates = regroupAll ? tabs : tabs.filter((t) => (t.groupId ?? -1) === -1);
      if (candidates.length) {
        // Pass the live open-group names (per window) and parked-group names so a
        // single-tab result that joins an existing group is kept (see
        // mapGroupResult); a brand-new single-tab "group" is still dropped.
        const openNamesByWindow = new Map();
        for (const t of tabs) {
          if (!t.groupName) continue;
          if (!openNamesByWindow.has(t.windowId)) openNamesByWindow.set(t.windowId, new Set());
          openNamesByWindow.get(t.windowId).add(t.groupName);
        }
        let parkedNames = [];
        try {
          const idx = await nativeClient.request({ type: 'index-read' });
          const idxGroups = (idx && Array.isArray(idx.groups)) ? idx.groups : [];
          parkedNames = idxGroups.filter((g) => g.status !== 'open').map((g) => g.name || '');
        } catch { parkedNames = []; } // the index is best-effort; grouping still works without it
        const r = await nativeClient.request({ type: 'organize', task: 'group', adapter, payload: { tabs: projectTabsForHost(candidates), rules, mode } });
        items.push(...mapGroupResult(r.groups, byId, { openNamesByWindow, parkedNames, allowSingles: mode === 'leftovers' }));
      }
    } catch (e) {
      // Keep other results, but say so: a swallowed failure used to show up as
      // "Nothing to do — your browser looks tidy" with loose tabs on screen.
      console.warn('[organizer] grouping phase failed:', e);
      onWarning(`Couldn't sort your tabs: ${(e && e.message) || e}`);
    }
  }

  step('Finding forgotten tabs');
  if (shouldCancel()) return finalizePlan(items, settings, folders);
  if (!onlyTabIds && f.staleTabs && tabs.length) {
    try {
      const stale = tabs.filter((t) => t.idleDays >= settings.staleTabDays && !t.pinned); // never propose closing pinned tabs
      if (stale.length) {
        const candidateIds = new Set(stale.map((t) => t.tabId));
        const r = await nativeClient.request({ type: 'organize', task: 'stale', adapter, payload: { tabs: projectTabsForHost(stale), thresholdDays: settings.staleTabDays, rules } });
        items.push(...mapStaleResult(r.stale, byId, candidateIds));
      }
    } catch (e) { console.warn('[organizer] stale-tabs phase failed:', e); }
  }

  step('Finding tabs to bookmark');
  if (shouldCancel()) return finalizePlan(items, settings, folders);
  if (!onlyTabIds && f.importantBookmarks && tabs.length) {
    try {
      const r = await nativeClient.request({ type: 'organize', task: 'important', adapter, payload: { tabs: projectTabsForHost(tabs), rules } });
      items.push(...mapImportantResult(r.important, byId));
    } catch (e) { console.warn('[organizer] important-bookmarks phase failed:', e); }
  }

  step('Cleaning bookmarks');
  if (shouldCancel()) return finalizePlan(items, settings, folders);
  if (!onlyTabIds && f.cleanBookmarks) {
   try {
    const bookmarks = await collectBookmarks(chromeApi);
    const visits = await getVisitsMap(bookmarks, chromeApi);
    const deletes = [];
    deletes.push(...findDuplicateBookmarks(bookmarks));
    deletes.push(...findStaleBookmarks(bookmarks, visits, settings.staleBookmarkDays, now));
    if (f.deadLinkScan && await hasAllUrls(chromeApi)) {
      const httpBookmarks = bookmarks.filter((b) => /^https?:/i.test(b.url));
      const cursor = (await chromeApi.storage.local.get('deadCursor')).deadCursor || 0;
      const { slice, nextCursor } = sliceForScan(httpBookmarks, cursor, settings.deadLinkBatchSize);
      await chromeApi.storage.local.set({ deadCursor: nextCursor });
      const deadCandidates = await checkDeadLinks(slice, {});
      const prevStrikes = (await chromeApi.storage.local.get('deadStrikes')).deadStrikes || {};
      // Pass the ids actually scanned this batch so strikes for bookmarks in
      // OTHER (unscanned) slices are carried forward, not silently reset —
      // otherwise pagination means a strike never survives to reach 2.
      const scannedIds = slice.map((b) => b.id);
      const { strikes, confirmed } = recordDeadStrikes(prevStrikes, deadCandidates.map((d) => d.data.bookmarkId), scannedIds);
      await chromeApi.storage.local.set({ deadStrikes: strikes });
      const confirmedSet = new Set(confirmed);
      deletes.push(...deadCandidates.filter((d) => confirmedSet.has(d.data.bookmarkId)));
    }
    items.push(...dedupeDeletes(deletes));
   } catch (e) { console.warn('[organizer] bookmark-cleanup phase failed:', e); }
  }

  step('Organizing bookmarks');
  if (shouldCancel()) return finalizePlan(items, settings, folders);
  if (!onlyTabIds && f.organizeBookmarks) {
    try {
      const tree = await collectTree(chromeApi);
      folders = tree.folders; // captured for finalize protection (bar/whitelist)
      rootIds = tree.rootIds; barId = tree.barId; // real roots (Edge != Chrome ids)
      const mode = settings.organizeMode || 'additive';
      const candidates = selectOrganizeCandidates(tree.bookmarks, mode, tree.rootIds);
      let moveItems = [];
      if (!candidates.length) {
        console.info(`[organizer] organize: 0 candidates (mode=${mode}, ${tree.bookmarks.length} bookmarks total, roots=[${[...tree.rootIds].join(',')}])`);
        onWarning(`Nothing to sort: no loose bookmarks were found${settings.protectBookmarkBar !== false ? ' outside the protected bookmarks bar' : ''}. "Match"/"Add folders" only move bookmarks that aren't already in a folder — try "Fully reorganize" in Settings to include filed ones.`);
      } else {
        const byId = new Map(candidates.map((b) => [b.id, b]));
        const folderPathById = new Map(folders.map((fo) => [fo.id, (fo.path || []).join('/')]));
        const folderInv = folders.map((fo) => ({ id: fo.id, path: folderPathById.get(fo.id) }));
        const r = await nativeClient.request({ type: 'organize', task: 'organize-bookmarks', adapter, payload: { mode, folders: folderInv, bookmarks: projectBookmarksForHost(candidates), rules } });
        const rawMoves = Array.isArray(r && r.moves) ? r.moves : [];
        moveItems = mapOrganizeResult(rawMoves, byId, mode, tree.otherId, folderPathById);
        // How many survive the bar/whitelist protections (what actually reaches the plan)?
        const kept = applyFolderProtection(moveItems, { protectBookmarkBar: settings.protectBookmarkBar !== false, protectedFolders: settings.protectedFolders || [], folders, rootIds: tree.rootIds, barId: tree.barId });
        console.info(`[organizer] organize: ${candidates.length} candidate(s), mode=${mode} → model ${rawMoves.length} move(s) → ${moveItems.length} mapped → ${kept.length} after protections`);
        items.push(...moveItems);
        if (!moveItems.length) {
          onWarning(rawMoves.length
            ? `The AI returned ${rawMoves.length} move(s) for ${candidates.length} bookmarks, but none matched (its ids didn't line up — common with very large collections). Sorting fewer at a time should help.`
            : `The AI reviewed ${candidates.length} loose bookmark(s) and proposed no moves. Large collections can overwhelm it; try again or with fewer bookmarks.`);
        } else if (!kept.length) {
          onWarning(`All ${moveItems.length} proposed move(s) were skipped by your protections${settings.protectBookmarkBar ? ' — your folders are likely inside the Bookmarks Bar, which is protected. Untick "Never touch the Bookmarks Bar" to file into them.' : '.'}`);
        }
      }
      if (settings.removeEmptyFolders) items.push(...findEmptyFolders(folders, tree.bookmarks, moveItems, tree.rootIds));
    } catch (e) {
      console.warn('[organizer] organize-bookmarks phase failed:', e);
      // Never fall through to a silent "looks tidy": surface the failure. The
      // out-of-date-host case is caught proactively by the health banner's
      // MIN_HOST_VERSION check (see viewmodel.healthMessage), so this is just
      // the generic runtime-failure path.
      onWarning('Sorting bookmarks failed (it may have timed out on a large collection). See the service-worker console for details, and try again with fewer bookmarks.');
    }
  }

  return finalizePlan(items, settings, folders, rootIds, barId);
}

// Single tail for every buildPlan return path (including cancellation): dedupe
// tab-close/suspend actions by tab, drop malformed items, apply the ignore-list.
export function dedupeTabActions(items) {
  const seen = new Set();
  return items.filter((it) => {
    if (it.action !== 'closeTab' && it.action !== 'discardTab') return true;
    const key = it.data && it.data.tabId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function finalizePlan(items, settings, folders = [], rootIds = ROOT_IDS, barId = BAR_ID) {
  const s = settings || {};
  let cleaned = applyWhitelist(dedupeTabActions(items).filter(validatePlanItem), s.whitelist || []);
  cleaned = applyFolderProtection(cleaned, { protectBookmarkBar: s.protectBookmarkBar !== false, protectedFolders: s.protectedFolders || [], folders, rootIds, barId });
  return applyIgnoreList(cleaned, s.ignore || []);
}

// Runs a free-text natural-language instruction over the current tab set and
// maps the model's response into the same PlanItem shape as buildPlan, so it
// goes through the exact same review/apply/undo path. Returns { items, summary },
// where summary is the model's one-line reading of the request ('' from an older
// helper that doesn't send one).
export async function runCommand(instruction, deps) {
  const { nativeClient, chromeApi = chrome, now = Date.now(), windowId = null, settings = {} } = deps;
  const adapter = settings.adapter || 'claude';
  const activity = (await chromeApi.storage.local.get('tabActivity')).tabActivity || {};
  const tabs = await collectTabs(chromeApi, activity, now, windowId);
  const byId = indexById(tabs);
  const candidateIds = new Set(tabs.map((t) => t.tabId));
  const rules = decisionRules(settings.decisions || {}).keep.join('; ');
  const r = await nativeClient.request({ type: 'command', adapter, payload: { instruction, tabs: projectTabsForHost(tabs), rules } });
  const items = [
    ...mapGroupResult(r.groups, byId),
    ...mapStaleResult(r.close, byId, candidateIds),
    ...mapImportantResult(r.important, byId),
  ];
  // Same safety tail as buildPlan: dedupe + validate + whitelist + ignore-list.
  return { items: finalizePlan(items, settings), summary: typeof r.summary === 'string' ? r.summary : '' };
}

// Loads agent-written suggestions from the host's proposals.json and maps them
// into the same PlanItem shapes buildPlan/runCommand use, so review/apply/undo
// work unchanged. Each proposal URL is matched to an open tab by exact URL (the
// first match wins); URLs with no open tab are dropped. Returns the mapped items
// plus the file's `note`/`from` for the status line.
export async function loadProposals(deps) {
  const { nativeClient, chromeApi = chrome, now = Date.now(), windowId = null, settings = {} } = deps;
  const adapter = settings.adapter || 'claude';
  const activity = (await chromeApi.storage.local.get('tabActivity')).tabActivity || {};
  const tabs = await collectTabs(chromeApi, activity, now, windowId);
  const byId = indexById(tabs);
  const candidateIds = new Set(tabs.map((t) => t.tabId));
  // Exact-URL → tabId, first open tab wins (ties keep the earliest in tab order).
  const tabIdByUrl = new Map();
  for (const t of tabs) if (!tabIdByUrl.has(t.url)) tabIdByUrl.set(t.url, t.tabId);
  const r = await nativeClient.request({ type: 'proposals', adapter });
  const proposals = r || {};
  const groups = (Array.isArray(proposals.groups) ? proposals.groups : []).map((g) => ({
    name: g.name,
    color: g.color,
    tabIds: (Array.isArray(g.urls) ? g.urls : []).map((u) => tabIdByUrl.get(u)).filter((id) => id != null),
  }));
  const close = (Array.isArray(proposals.close) ? proposals.close : [])
    .map((c) => ({ tabId: tabIdByUrl.get(c.url), reason: c.reason }))
    .filter((c) => c.tabId != null);
  const items = [
    ...mapGroupResult(groups, byId),
    ...mapStaleResult(close, byId, candidateIds),
  ];
  return { items: finalizePlan(items, settings), note: proposals.note, from: proposals.from };
}

export async function hasAllUrls(chromeApi = chrome) {
  if (!chromeApi.permissions) return false;
  return chromeApi.permissions.contains({ origins: ['<all_urls>'] });
}

export function ignoreKey(item) {
  const d = item.data || {};
  const target = d.url || (d.tabIds ? `group:${d.groupName}` : d.bookmarkId || '');
  return `${item.action}:${redactUrl(String(target))}`;
}

// Only rejections drive behavior: repeated "never suggest this" become rules
// fed back into future prompts. (The approve/"relax caution" side was never
// wired and was removed — it risked auto-acting on merely-often-approved targets.)
export function recordDecision(decisions, item, verdict) {
  if (verdict !== 'reject') return decisions;
  const key = ignoreKey(item);
  const prev = decisions[key] || {};
  return { ...decisions, [key]: { reject: (prev.reject || 0) + 1 } };
}

export function decisionRules(decisions) {
  const keep = [];
  for (const [key, v] of Object.entries(decisions)) {
    if (v.reject >= 2) keep.push(`Do not suggest actions on ${key.split(':').slice(1).join(':')}`);
  }
  return { keep };
}

export function applyIgnoreList(items, ignore = []) {
  const set = new Set(ignore);
  return items.filter((it) => !set.has(ignoreKey(it)));
}

export function sliceForScan(items, cursor, batchSize) {
  const start = cursor % Math.max(1, items.length);
  const slice = items.slice(start, start + batchSize);
  const end = start + slice.length;
  return { slice, nextCursor: end >= items.length ? 0 : end };
}

export async function applyItems(items, deps = {}) {
  const runId = deps.runId || `run-${Date.now()}`;
  const applyItem = deps.applyItem || ((item) => defaultApplyItem(item, { runId }));
  const recordUndo = deps.recordUndo || defaultRecordUndo;
  const applied = [];
  const failed = [];
  const failures = []; // { itemId, reason, error } for the panel's status line
  // Group tabs before anything closes or suspends them (closeTab/discardTab):
  // an earlier item that closes a tab would otherwise remove it from a later
  // group. The two filters preserve relative order within each bucket.
  const ordered = [
    ...items.filter((it) => it.action === 'groupTabs'),
    ...items.filter((it) => it.action !== 'groupTabs'),
  ];
  for (const item of ordered) {
    try {
      const undo = await applyItem(item);
      // Persist each undo record immediately: if a later item or the process
      // dies, the destructive actions already taken remain undoable (a single
      // end-of-batch write would lose them all on failure).
      if (undo) await recordUndo([undo]);
      applied.push(item.itemId);
    } catch (e) {
      // StaleTabError etc. are expected skips, but a swallowed error made apply
      // failures undiagnosable — surface it (the item still counts as failed).
      console.warn('[organizer] apply failed for', item.action, item.itemId, e);
      failed.push(item.itemId);
      failures.push({ itemId: item.itemId, reason: item.reason || item.action, error: String((e && e.message) || e) });
    }
  }
  return { applied, failed, failures };
}
