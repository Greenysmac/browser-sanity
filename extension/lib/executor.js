import { TAB_GROUP_COLORS } from './colors.js';
import { ACTION_LABELS } from './labels.js';
import { uniqueId as undoId } from './ids.js';
import { ROOT_IDS, BAR_ID, OTHER_ID } from './bookmark-collector.js';
import { applyFolderProtection } from './protections.js';

const COLORS = new Set(TAB_GROUP_COLORS);

export class StaleTabError extends Error {}
// Settings/folder structure changed (a new "never touch" protection) between
// when the plan was built and when it's applied — mirrors StaleTabError so it
// flows through the same applyItems try/catch -> failed bucket.
export class ProtectedTargetError extends Error {}

// Re-checks a moveBookmark/removeFolder item against LIVE settings and folder
// structure (deps.settings/folders/rootIds/barId, fetched fresh by the caller
// at apply time) — a stale plan item that was fine when built can violate a
// protection the user added since. Skipped when deps.settings isn't provided.
function isProtectedNow(item, deps) {
  if (!deps.settings) return false;
  const { settings, folders = [], rootIds = ROOT_IDS, barId = BAR_ID } = deps;
  const opts = { protectBookmarkBar: settings.protectBookmarkBar !== false, protectedFolders: settings.protectedFolders || [], folders, rootIds, barId };
  return applyFolderProtection([item], opts).length === 0;
}

function labelFor(item) {
  const name = item.data.title || item.data.groupName || item.data.url || '';
  return `${ACTION_LABELS[item.action] || item.action}: ${name}`.trim();
}

// Walk/create a folder path under `rootId` (default the bookmarks bar '1');
// returns the leaf folder id.
export async function ensureFolder(pathParts, chromeApi, rootId = '1') {
  let parentId = rootId;
  for (const name of pathParts) {
    const children = await chromeApi.bookmarks.getChildren(parentId);
    let node = children.find((ch) => !ch.url && ch.title === name);
    if (!node) node = await chromeApi.bookmarks.create({ parentId, title: name });
    parentId = node.id;
  }
  return { id: parentId };
}

export async function applyItem(item, deps = {}) {
  const c = deps.chrome || chrome;
  const runId = deps.runId || 'run';
  const entry = await applyItemInner(item, c, deps);
  return entry ? { ...entry, runId, label: labelFor(item) } : entry;
}

async function applyItemInner(item, c, deps = {}) {
  switch (item.action) {
    case 'closeTab': {
      const { tabId, url, title, windowId, index, pinned, bookmarkFirst } = item.data;
      const live = await c.tabs.get(tabId).catch(() => null);
      if (!live || live.url !== url) throw new StaleTabError(`Tab ${tabId} no longer matches ${url}`);
      if (live.pinned) throw new StaleTabError(`Tab ${tabId} is pinned (protected)`); // never close a pinned tab
      let savedBookmarkId = null;
      if (bookmarkFirst) {
        const targetRoot = (deps.settings?.protectBookmarkBar !== false && (deps.otherId || OTHER_ID)) ? (deps.otherId || OTHER_ID) : (deps.barId || BAR_ID);
        const folder = await ensureFolder(['Browser Organizer', 'Saved before closing'], c, targetRoot);
        const bm = await c.bookmarks.create({ parentId: folder.id, title: title || url, url });
        savedBookmarkId = bm && bm.id;
      }
      await c.tabs.remove(tabId);
      // Record the safety bookmark so undo is a clean inverse (reopen + delete it).
      return { undoId: undoId(), ts: Date.now(), action: 'closeTab', reverse: { url, windowId, index, pinned, savedBookmarkId } };
    }
    case 'groupTabs': {
      const { tabIds, groupName, color } = item.data;
      // Drop tab ids that no longer exist (closed/suspended since the plan was
      // built) so we only group what's live. If nothing survives, there's
      // nothing to group — treat it as a successful no-op, not a failure.
      const liveTabs = await Promise.all(
        (tabIds || []).map((id) => c.tabs.get(id).then((t) => (t ? id : null)).catch(() => null)),
      );
      const liveIds = liveTabs.filter((id) => id != null);
      if (!liveIds.length) return { undoId: undoId(), ts: Date.now(), action: 'groupTabs', reverse: null, skipped: true };
      // Reuse an existing group in the first tab's window whose title matches
      // groupName (trimmed, case-insensitive); leave its title/color alone.
      const first = await c.tabs.get(liveIds[0]).catch(() => null);
      const windowId = first ? first.windowId : item.data.windowId;
      const wanted = (groupName || '').trim().toLowerCase();
      const existing = windowId != null && wanted
        ? await c.tabGroups.query({ windowId }).then((gs) => (gs || []).find((g) => (g.title || '').trim().toLowerCase() === wanted)).catch(() => null)
        : null;
      if (existing) {
        // Only move tabs that aren't already in this group, so the order the
        // user arranged inside it survives. If every tab is already there,
        // there's nothing to move — skip it as a successful no-op.
        const groupIds = await Promise.all(
          liveIds.map((id) => c.tabs.get(id).then((t) => (t ? t.groupId : null)).catch(() => null)),
        );
        const newcomers = liveIds.filter((id, i) => groupIds[i] !== existing.id);
        if (!newcomers.length) return { undoId: undoId(), ts: Date.now(), action: 'groupTabs', reverse: null, skipped: true };
        await c.tabs.group({ tabIds: newcomers, groupId: existing.id });
        return { undoId: undoId(), ts: Date.now(), action: 'groupTabs', reverse: { tabIds: newcomers } };
      }
      const groupId = await c.tabs.group({ tabIds: liveIds });
      await c.tabGroups.update(groupId, { title: groupName, color: COLORS.has(color) ? color : 'grey' });
      return { undoId: undoId(), ts: Date.now(), action: 'groupTabs', reverse: { tabIds: liveIds } };
    }
    case 'createBookmark': {
      const { url, title, folderPath, rootId } = item.data;
      const targetRoot = rootId || (deps.settings?.protectBookmarkBar !== false && (deps.otherId || OTHER_ID) ? (deps.otherId || OTHER_ID) : (deps.barId || BAR_ID));
      const folder = await ensureFolder(folderPath, c, targetRoot);
      const bm = await c.bookmarks.create({ parentId: folder.id, title: title || url, url });
      return { undoId: undoId(), ts: Date.now(), action: 'createBookmark', reverse: { bookmarkId: bm.id } };
    }
    case 'deleteBookmark': {
      const { bookmarkId, parentId, index, title, url } = item.data;
      // Staleness guard (mirrors closeTab): the plan captured this bookmark at
      // scan time. If the user has since edited its URL, don't delete the now-
      // different bookmark, and don't let undo resurrect a stale snapshot.
      const live = await c.bookmarks.get(bookmarkId).then((r) => r && r[0]).catch(() => null);
      if (!live || live.url !== url) throw new StaleTabError(`Bookmark ${bookmarkId} no longer matches ${url}`);
      await c.bookmarks.remove(bookmarkId);
      return { undoId: undoId(), ts: Date.now(), action: 'deleteBookmark', reverse: { parentId: live.parentId ?? parentId, index: live.index ?? index, title: live.title ?? title, url: live.url } };
    }
    case 'moveBookmark': {
      const { bookmarkId, fromParentId, fromIndex, toParentId, toFolderPath, toRootId } = item.data;
      // Settings/protected-folders may have changed since the plan was built —
      // re-check now, not just at plan-build time (see ProtectedTargetError).
      if (isProtectedNow(item, deps)) throw new ProtectedTargetError(`Move of bookmark ${bookmarkId} is now blocked by folder protections`);
      // Capture the live origin so undo restores correctly even if the plan's
      // fromParentId/fromIndex are stale or missing.
      const cur = await c.bookmarks.get(bookmarkId).then((r) => r && r[0]).catch(() => null) || {};
      const parentId = toParentId || (await ensureFolder(toFolderPath || [], c, toRootId || deps.otherId || OTHER_ID)).id;
      await c.bookmarks.move(bookmarkId, { parentId });
      return { undoId: undoId(), ts: Date.now(), action: 'moveBookmark', reverse: { bookmarkId, parentId: fromParentId ?? cur.parentId, index: fromIndex ?? cur.index } };
    }
    case 'removeFolder': {
      const { folderId, parentId, index, title } = item.data;
      // Guards (independent of the planner): never touch a root (by classic id
      // OR any top-level node — Edge's roots aren't 0/1/2/3), never remove a
      // folder that still has children at apply time (keeps partial-apply safe).
      if (ROOT_IDS.has(folderId) || parentId === '0') return { undoId: undoId(), ts: Date.now(), action: 'removeFolder', reverse: null, skipped: true };
      // Settings/protected-folders may have changed since the plan was built —
      // re-check now, not just at plan-build time (see ProtectedTargetError).
      if (isProtectedNow(item, deps)) throw new ProtectedTargetError(`Removal of folder ${folderId} is now blocked by folder protections`);
      // The folder may already be gone (user deleted it before apply) — treat a
      // failed lookup as a skip so the batch keeps going.
      const kids = await c.bookmarks.getChildren(folderId).catch(() => null);
      if (!kids || kids.length) return { undoId: undoId(), ts: Date.now(), action: 'removeFolder', reverse: null, skipped: true };
      await c.bookmarks.remove(folderId);
      // Keep folderId so undo can remap it: recreating the folder yields a NEW id,
      // and any moveBookmark that pointed here must be redirected to that new id.
      return { undoId: undoId(), ts: Date.now(), action: 'removeFolder', reverse: { folderId, parentId, index, title } };
    }
    case 'discardTab': {
      await c.tabs.discard(item.data.tabId);
      return { undoId: undoId(), ts: Date.now(), action: 'discardTab', reverse: {} };
    }
    default:
      throw new Error(`Unknown action: ${item.action}`);
  }
}
