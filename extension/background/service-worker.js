import { getSettings, setSettings } from '../lib/storage.js';
import { installActivityListeners } from '../lib/activity-tracker.js';
import { createNativeClient } from '../lib/native-client.js';
import { buildPlan, partitionForApply, applyItems, runCommand, loadProposals, recordDecision } from '../lib/orchestrator.js';
import { applyItem } from '../lib/executor.js';
import { collectTree } from '../lib/bookmark-collector.js';
import { recordUndo, reverseEntry, pruneUndo, getUndoLog, claimUndoEntries, restoreUndoEntries } from '../lib/undo-log.js';
import { listSessions, saveCurrentWindowSession, restoreSession, removeSession, renameSession, mutateSessions } from '../lib/sessions.js';
import { parseOmnibox } from '../lib/omnibox.js';
import { digestText } from '../lib/plan-summary.js';
import { withLock } from '../lib/mutex.js';
import { uniqueId } from '../lib/ids.js';
import { getSecret } from '../lib/secret-store.js';
import { syncIndex, openGroupTitles } from '../lib/index-sync.js';
import { parkGroup, openParked } from '../lib/park.js';

// Creates the native client, attaching the openai adapter's UI-entered config
// (key decrypted from secret-store here, base/model from settings) so the host
// resolves them per-request. Other adapters send no config.
// Advanced-settings CLI controls for the active adapter, sent with every request.
// The host re-validates (sanitizeCli) — this is convenience, not a trust boundary.
function cliExtrasFor(settings) {
  const adv = settings.advancedCli || {};
  return {
    cli: {
      loadMcpServers: adv.loadMcpServers === true,
      loadPluginsSettings: adv.loadPluginsSettings === true,
      extraArgs: (adv.extraArgs && adv.extraArgs[settings.adapter]) || '',
    },
  };
}

async function makeClient(settings) {
  const extras = cliExtrasFor(settings);
  if (settings.adapter === 'openai') {
    extras.config = { apiKey: await getSecret('openaiApiKey'), baseUrl: settings.openaiBaseUrl || '', model: settings.openaiModel || '' };
  }
  return createNativeClient({ requestExtras: extras });
}

const ALARM_SCAN = 'organizer-scan';
const ALARM_PRUNE = 'organizer-prune';

// Progress streaming: the panel opens a port named 'scan' before requesting a
// run; runScan broadcasts {progress} to every connected scan port.
const scanPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id) return; // ignore connections from anything but ourselves
  if (port.name !== 'scan') return;
  scanPorts.add(port);
  port.onDisconnect.addListener(() => scanPorts.delete(port));
});

function broadcastProgress(phase, done, total) {
  for (const port of scanPorts) {
    try { port.postMessage({ progress: { phase, done, total } }); } catch { /* port gone */ }
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.alarms.create(ALARM_SCAN, { periodInMinutes: settings.scanIntervalMinutes });
  await chrome.alarms.create(ALARM_PRUNE, { periodInMinutes: 1440 });
});

// Keep the scheduled-scan cadence in sync when it changes — but ONLY when the
// interval actually changed. chrome.alarms.create restarts the countdown, so
// recreating on every settings write (incl. each ignore/decision update or a
// remote sync echo) would perpetually defer the scan.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  const newMin = changes.settings.newValue && changes.settings.newValue.scanIntervalMinutes;
  if (newMin == null) return;
  const oldMin = changes.settings.oldValue && changes.settings.oldValue.scanIntervalMinutes;
  if (oldMin === newMin) return;
  await chrome.alarms.create(ALARM_SCAN, { periodInMinutes: newMin });
});

chrome.runtime.onStartup.addListener(async () => {
  const now = Date.now();
  const rawTabs = await chrome.tabs.query({});
  const { reconcile } = await import('../lib/activity-tracker.js');
  // Share the 'tabActivity' lock with the activity listeners so this startup
  // reconcile can't clobber a concurrently-written timestamp.
  await withLock('tabActivity', async () => {
    const { tabActivity = {} } = await chrome.storage.local.get('tabActivity');
    await chrome.storage.local.set({ tabActivity: reconcile(tabActivity, rawTabs, now) });
  });
  await chrome.storage.local.remove('currentPlan'); // stale plan (see Task 6)
});

installActivityListeners(chrome);

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'run-scan') await runScan({ background: true });
  if (command === 'open-panel') {
    const win = await chrome.windows.getLastFocused();
    await chrome.sidePanel.open({ windowId: win.id });
  }
});

chrome.omnibox.onInputEntered.addListener(async (text) => {
  const { instruction } = parseOmnibox(text);
  if (!instruction) return;
  const settings = await getSettings();
  const win = await chrome.windows.getLastFocused();
  const client = await makeClient(settings);
  try {
    const items = await runCommand(instruction, { nativeClient: client, windowId: win.id, settings });
    await withLock('currentPlan', () => chrome.storage.local.set({ currentPlan: items }));
    await chrome.sidePanel.open({ windowId: win.id });
  } finally {
    client.disconnect();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const settings = await getSettings();
  if (alarm.name === ALARM_PRUNE) {
    await pruneUndo(Date.now(), settings.undoRetentionDays);
    return;
  }
  if (alarm.name === ALARM_SCAN && settings.automationMode === 'auto') {
    await runScan({ background: true });
  }
});

// Single-flight: three callers (panel, hotkey, 12h alarm) can trigger a scan.
// Overlapping scans would interleave read-modify-write on deadCursor/deadStrikes/
// currentPlan and corrupt them. A second caller with the SAME scope+features
// joins the in-flight run; a caller with DIFFERENT scope (e.g. the panel asks
// for one window while a background all-windows scan runs) must NOT receive the
// other run's plan, so it waits and then runs with its own parameters.
// Each run gets its own cancel token so a Cancel targets exactly one scan.
let scanInFlight = null;
let scanInFlightSig = null;
let currentScanCancel = null;

function scanSig(deps = {}) {
  return JSON.stringify({ w: deps.windowId ?? null, f: deps.features ?? null });
}

function runScan(deps = {}) {
  const sig = scanSig(deps);
  if (scanInFlight) {
    if (scanInFlightSig === sig) return scanInFlight;
    // Different scope/features: chain after the current run rather than return it.
    return scanInFlight.then(() => runScan(deps), () => runScan(deps));
  }
  scanInFlightSig = sig;
  const token = { cancelled: false };
  currentScanCancel = token;
  const onProgress = deps.onProgress || broadcastProgress;
  const shouldCancel = deps.shouldCancel || (() => token.cancelled);
  scanInFlight = (async () => {
    const settings = await getSettings();
    const nativeClient = await makeClient(settings);
    const warnings = [];
    try {
      const items = await buildPlan({ settings, nativeClient, onProgress, shouldCancel, onWarning: (w) => warnings.push(w), features: deps.features, windowId: deps.windowId ?? null });
      if (settings.debugLogging) console.info('[organizer] scan produced', items.length, 'item(s),', warnings.length, 'warning(s)');
      const { autoApply, needsReview } = partitionForApply(items, settings);
      await withLock('currentPlan', () => chrome.storage.local.set({ currentPlan: needsReview }));
      if (autoApply.length) {
        const runId = uniqueId('run-');
        const { folders, rootIds, barId, otherId } = await collectTree(chrome);
        const res = await applyItems(autoApply, { runId, applyItem: (i) => applyItem(i, { runId, settings, folders, rootIds, barId, otherId }), recordUndo });
        await notify(`Applied ${res.applied.length} changes (${res.failed.length} failed). Undo available.`);
      } else if (needsReview.length && deps.background) {
        // Only notify for background/scheduled scans; a foreground run already shows the panel.
        await notify(digestText(needsReview));
      }
      return { items, warnings };
    } finally {
      nativeClient.disconnect();
    }
  })().finally(() => { scanInFlight = null; scanInFlightSig = null; currentScanCancel = null; });
  return scanInFlight;
}

// Clicking a background digest notification opens the panel. sidePanel.open may
// require a user gesture that a notification click doesn't carry in every
// browser, so fall back to opening the panel page as a tab.
chrome.notifications.onClicked.addListener(async () => {
  const win = await chrome.windows.getLastFocused();
  try {
    await chrome.sidePanel.open({ windowId: win.id });
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/sidepanel.html') });
  }
});

// A `basic` notification requires an iconUrl (Edge rejects it otherwise). We
// render one at runtime via OffscreenCanvas so no packaged image file is needed,
// and memoize it.
let _iconUrl = null;
async function notificationIcon() {
  if (_iconUrl) return _iconUrl;
  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('B', 64, 74);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  _iconUrl = `data:image/png;base64,${btoa(bin)}`;
  return _iconUrl;
}

async function notify(message) {
  try {
    await chrome.notifications.create({ type: 'basic', iconUrl: await notificationIcon(), title: 'Browser Organizer', message });
  } catch { /* notifications are best-effort */ }
}

// ---- Message handlers (one function per command; dispatched by the map below) ----

async function handleRun(m) {
  const { items, warnings } = await runScan({ features: m.features, windowId: m.windowId ?? null });
  return { ok: true, items, warnings };
}

function handleCancel() {
  if (currentScanCancel) currentScanCancel.cancelled = true;
  return { ok: true };
}

// The single settings writer. The side panel and service worker run in separate
// JS contexts with separate in-memory locks, so a panel writing settings directly
// couldn't be serialized against SW writers (handleIgnore etc.) — last write wins
// and clobbers. Routing every panel settings write through here puts all writers
// in ONE context under ONE 'settings' lock.
async function handleSetSettings(m) {
  return withLock('settings', async () => ({ ok: true, settings: await setSettings(m.patch || {}) }));
}

async function handleIgnore(m) {
  // Serialize with other settings writers so concurrent rejects don't clobber.
  return withLock('settings', async () => {
    const settings = await getSettings();
    const next = [...new Set([...(settings.ignore || []), ...(m.keys || [])])];
    let decisions = settings.decisions || {};
    for (const item of m.items || []) decisions = recordDecision(decisions, item, 'reject');
    await setSettings({ ignore: next, decisions });
    return { ok: true, ignore: next };
  });
}

async function handleListOpenTabs(m) {
  // Include browser pages (chrome://, edge://, about:) too — the panel tags them
  // so the user can still bulk-close them; the AI send-path elsewhere still only
  // ever sees http(s) URLs. Exclude our own extension pages, about:blank, and
  // empty/loading tabs so the list stays meaningful.
  const all = await chrome.tabs.query(m.windowId ? { windowId: m.windowId } : {});
  const tabs = all
    .filter((t) => t.id != null && t.url && t.url !== 'about:blank' && !/^chrome-extension:|^moz-extension:/i.test(t.url))
    .map((t) => ({ id: t.id, title: t.title || '', url: t.url, pinned: !!t.pinned, windowId: t.windowId }));
  return { ok: true, tabs };
}

async function handleFocusTab(m) {
  const t = await chrome.tabs.get(m.tabId).catch(() => null);
  if (t) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }); }
  return { ok: !!t };
}

async function handleCloseTabs(m) {
  // Manual, explicit bulk close (no AI). Records undo only for tabs that were
  // actually removed, so "Undo" can't re-create still-open tabs.
  const runId = uniqueId('run-');
  const entries = [];
  for (const id of m.tabIds || []) {
    const t = await chrome.tabs.get(id).catch(() => null);
    if (!t) continue;
    try { await chrome.tabs.remove(id); } catch { continue; }
    entries.push({ undoId: uniqueId(), runId, ts: Date.now(), action: 'closeTab', label: `Close tab: ${t.title || t.url}`, reverse: { url: t.url, windowId: t.windowId, index: t.index, pinned: t.pinned } });
  }
  if (entries.length) await recordUndo(entries);
  return { ok: true, closed: entries.length };
}

async function handleGetPlan() {
  const { currentPlan = [] } = await chrome.storage.local.get('currentPlan');
  return { ok: true, items: currentPlan };
}

async function handleUpdatePlan(m) {
  return withLock('currentPlan', async () => {
    await chrome.storage.local.set({ currentPlan: m.items || [] });
    return { ok: true };
  });
}

async function handleApply(m) {
  // Snapshot the open group titles before applying so we can tell which groups a
  // re-sort emptied (existed before, gone after) and report them as dissolved.
  const beforeTitles = await openGroupTitles(chrome);
  // Serialize the read-modify-write on currentPlan so a double-clicked Apply
  // (or an auto-scan writing the plan concurrently) can't double-execute an
  // item or clobber the stored plan.
  const res = await withLock('currentPlan', async () => {
    const { currentPlan = [] } = await chrome.storage.local.get('currentPlan');
    const chosen = currentPlan.filter((i) => m.itemIds.includes(i.itemId));
    const runId = uniqueId('run-');
    // Fetch settings/folder structure fresh (not whatever was current when the
    // plan was built) so a protection added while the plan sat unreviewed still
    // blocks a now-stale moveBookmark/removeFolder item (see executor.js).
    const settings = await getSettings();
    const { folders, rootIds, barId, otherId } = await collectTree(chrome);
    const applyRes = await applyItems(chosen, { runId, applyItem: (i) => applyItem(i, { runId, settings, folders, rootIds, barId, otherId }), recordUndo });
    const remaining = currentPlan.filter((i) => !applyRes.applied.includes(i.itemId));
    await chrome.storage.local.set({ currentPlan: remaining });
    return { ok: true, ...applyRes };
  });
  // Refresh the on-disk index to match the now-applied tab state. Best-effort:
  // syncIndex never throws, and a failed sync must not fail the apply. Groups
  // present before but gone after are reported as dissolved so the index drops
  // them rather than parking them.
  const afterTitles = await openGroupTitles(chrome);
  const afterSet = new Set(afterTitles);
  const dissolved = beforeTitles.filter((t) => !afterSet.has(t));
  await syncCurrentIndex({ dissolved });
  return res;
}

// Open a native client, push the current index through it, and tear it down.
// Delegates to syncIndex (which swallows errors) so this is always safe to call.
async function syncCurrentIndex({ dissolved } = {}) {
  const settings = await getSettings();
  const nativeClient = await makeClient(settings);
  try {
    return await syncIndex({ chromeApi: chrome, nativeClient, dissolved });
  } finally {
    nativeClient.disconnect();
  }
}

async function handleUndo(m) {
  // Claim (remove) the entries first so a concurrent undo can't select and
  // double-reverse the same entry; restore only the ones that failed to reverse.
  const chosen = await claimUndoEntries(m.undoIds);
  const failed = [];
  // Undo in REVERSE apply order so later ops are reversed first — e.g. a folder
  // removed after its bookmarks moved out is recreated before those moves are
  // reversed. A shared idRemap redirects those moves to the recreated folder
  // (whose id changed on re-create).
  const idRemap = new Map();
  for (const entry of [...chosen].reverse()) {
    try { await reverseEntry(entry, chrome, idRemap); } catch { failed.push(entry); }
  }
  await restoreUndoEntries(failed);
  return { ok: true, undone: chosen.length - failed.length, failed: failed.length };
}

async function handleGetUndo() {
  return { ok: true, entries: await getUndoLog() };
}

async function handleCommand(m) {
  const settings = await getSettings();
  const nativeClient = await makeClient(settings);
  try {
    const items = await runCommand(m.instruction, { nativeClient, windowId: m.windowId ?? null, settings });
    await withLock('currentPlan', () => chrome.storage.local.set({ currentPlan: items }));
    return { ok: true, items };
  } finally {
    nativeClient.disconnect();
  }
}

// "Load agent suggestions": pull proposals.json from the host, map it to the
// current open tabs, and store the result as the current plan (same shapes as a
// normal scan, so review/apply/undo are unchanged). Carries the file's note back
// so the panel can surface who proposed it and why.
async function handleProposals(m) {
  const settings = await getSettings();
  const nativeClient = await makeClient(settings);
  try {
    const { items, note, from } = await loadProposals({ nativeClient, windowId: m.windowId ?? null, settings });
    await withLock('currentPlan', () => chrome.storage.local.set({ currentPlan: items }));
    return { ok: true, items, note, from };
  } finally {
    nativeClient.disconnect();
  }
}

// Build a plan over just the given tab ids and store it as the current plan
// (same shapes as a normal scan, so review/apply/undo are unchanged). buildPlan
// with onlyTabIds runs only the grouping phase over those tabs. Fewer than one
// tab returns a friendly message instead of running the backend.
async function sortTabIds(tabIds, emptyMessage) {
  if (!Array.isArray(tabIds) || tabIds.length < 1) return { ok: true, items: [], message: emptyMessage };
  const settings = await getSettings();
  const nativeClient = await makeClient(settings);
  try {
    const items = await buildPlan({ settings, nativeClient, onlyTabIds: tabIds });
    await withLock('currentPlan', () => chrome.storage.local.set({ currentPlan: items }));
    return { ok: true, items };
  } finally {
    nativeClient.disconnect();
  }
}

// "Sort group": regroup every tab currently in the given Chrome tab group.
async function handleSortGroup(m) {
  const tabs = await chrome.tabs.query({ groupId: m.groupId });
  const tabIds = tabs.map((t) => t.id).filter((id) => id != null);
  return sortTabIds(tabIds, 'That group has no tabs to sort.');
}

// "Sort selected tabs": regroup the tabs the user highlighted (shift/cmd-click)
// in the current window's tab strip.
async function handleSortSelected() {
  const tabs = await chrome.tabs.query({ highlighted: true, currentWindow: true });
  const tabIds = tabs.map((t) => t.id).filter((id) => id != null);
  return sortTabIds(tabIds, 'Select one or more tabs in the tab strip first.');
}

async function handleSaveSession(m) {
  const session = await saveCurrentWindowSession(m.name, { chrome, close: m.close !== false, windowId: m.windowId });
  return { ok: true, session };
}

async function handleRenameSession(m) {
  await mutateSessions((s) => renameSession(s, m.id, m.name));
  return { ok: true };
}

async function handleListSessions() {
  return { ok: true, sessions: await listSessions() };
}

async function handleRestoreSession(m) {
  const session = await restoreSession(m.id, { chrome });
  return { ok: true, session };
}

async function handleDeleteSession(m) {
  await mutateSessions((s) => removeSession(s, m.id));
  return { ok: true };
}

// The "Update index" button: push the current tab/group state to the host and
// report how many groups it wrote back.
async function handleSyncIndex() {
  const res = await syncCurrentIndex();
  return { ok: true, groups: res && res.groups };
}

// Park an open tab group: hand its tabs to the host, then close them. The group
// is reopenable from the index. Opens a native client around the call.
async function handleParkGroup(m) {
  const settings = await getSettings();
  const nativeClient = await makeClient(settings);
  try {
    const res = await parkGroup({ chromeApi: chrome, nativeClient, groupId: m.groupId });
    return { ok: true, ...res };
  } finally {
    nativeClient.disconnect();
  }
}

// Reopen a parked group by name into the given window, then sync the index.
async function handleOpenParked(m) {
  const settings = await getSettings();
  const nativeClient = await makeClient(settings);
  try {
    return await openParked({ chromeApi: chrome, nativeClient, name: m.name, windowId: m.windowId });
  } finally {
    nativeClient.disconnect();
  }
}

async function handleHealth() {  const settings = await getSettings();
  const client = await makeClient(settings);
  try { return { ok: true, health: await client.request({ type: 'health', adapter: settings.adapter }) }; }
  catch (err) { return { ok: true, health: { adapter: settings.adapter, ready: false, error: String((err && err.message) || err) } }; }
  finally { client.disconnect(); }
}

// Read the group descriptions the model sees, so the panel can show and edit
// them. Opens a native client around the host's 'groups-read'.
async function handleGroupsRead() {
  const settings = await getSettings();
  const client = await makeClient(settings);
  try {
    const { groups } = await client.request({ type: 'groups-read', adapter: settings.adapter });
    return { ok: true, groups: groups || [] };
  } finally {
    client.disconnect();
  }
}

// Set one group's description in the host's groups file via 'groups-write'.
async function handleGroupsWrite(m) {
  const settings = await getSettings();
  const client = await makeClient(settings);
  try {
    await client.request({ type: 'groups-write', adapter: settings.adapter, payload: { name: m.name, description: m.description } });
    return { ok: true };
  } finally {
    client.disconnect();
  }
}

const HANDLERS = {
  run: handleRun,
  cancel: handleCancel,
  setSettings: handleSetSettings,
  ignore: handleIgnore,
  listOpenTabs: handleListOpenTabs,
  focusTab: handleFocusTab,
  closeTabs: handleCloseTabs,
  getPlan: handleGetPlan,
  updatePlan: handleUpdatePlan,
  apply: handleApply,
  undo: handleUndo,
  getUndo: handleGetUndo,
  command: handleCommand,
  proposals: handleProposals,
  sortGroup: handleSortGroup,
  sortSelected: handleSortSelected,
  saveSession: handleSaveSession,
  renameSession: handleRenameSession,
  listSessions: handleListSessions,
  restoreSession: handleRestoreSession,
  deleteSession: handleDeleteSession,
  health: handleHealth,
  syncIndex: handleSyncIndex,
  parkGroup: handleParkGroup,
  openParked: handleOpenParked,
  groupsRead: handleGroupsRead,
  groupsWrite: handleGroupsWrite,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false; // ignore messages from anything but ourselves
  const handler = HANDLERS[message && message.cmd];
  if (!handler) { sendResponse({ ok: false, error: 'unknown command' }); return; }
  (async () => {
    try {
      sendResponse(await handler(message));
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();
  return true; // async response
});
