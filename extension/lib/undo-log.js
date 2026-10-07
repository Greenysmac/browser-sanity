import { withLock } from './mutex.js';

const MAX_ENTRIES = 2000;
const LOCK = 'undoLog';

export async function getUndoLog() {
  const { undoLog = [] } = await chrome.storage.local.get('undoLog');
  return undoLog;
}

export async function recordUndo(entries) {
  return withLock(LOCK, async () => {
    const log = await getUndoLog();
    const next = [...log, ...entries].slice(-MAX_ENTRIES);
    await chrome.storage.local.set({ undoLog: next });
  });
}

export function filterUndo(entries, now, retentionDays) {
  const cutoff = now - retentionDays * 86400000;
  return entries.filter((e) => e.ts >= cutoff);
}

export async function pruneUndo(now, retentionDays) {
  return withLock(LOCK, async () => {
    const log = await getUndoLog();
    await chrome.storage.local.set({ undoLog: filterUndo(log, now, retentionDays) });
  });
}

// Atomically remove the named entries from the log and return them, so a
// concurrent undo can't select (and double-reverse) the same entry.
export async function claimUndoEntries(ids) {
  return withLock(LOCK, async () => {
    const log = await getUndoLog();
    const idset = new Set(ids);
    const claimed = log.filter((e) => idset.has(e.undoId));
    if (claimed.length) await chrome.storage.local.set({ undoLog: log.filter((e) => !idset.has(e.undoId)) });
    return claimed;
  });
}

// Put back entries whose reversal failed, so the user can retry them.
export async function restoreUndoEntries(entries) {
  if (!entries.length) return;
  return withLock(LOCK, async () => {
    const log = await getUndoLog();
    await chrome.storage.local.set({ undoLog: [...entries, ...log].slice(-MAX_ENTRIES) });
  });
}

// `idRemap` maps an old (removed) folder id to the id of the folder recreated
// while undoing its removeFolder entry. Callers undoing a batch share one map and
// process entries in REVERSE apply order, so a folder is recreated before the
// moveBookmark that needs it is reversed.
export async function reverseEntry(entry, chromeApi = chrome, idRemap = new Map()) {
  switch (entry.action) {
    case 'closeTab': {
      const { url, windowId, index, pinned, savedBookmarkId } = entry.reverse;
      await chromeApi.tabs.create({ url, windowId, index, pinned, active: false });
      // Clean up the "Saved before closing" bookmark so undo is a true inverse.
      if (savedBookmarkId) { try { await chromeApi.bookmarks.remove(savedBookmarkId); } catch { /* already gone */ } }
      return;
    }
    case 'groupTabs': {
      // Old-style entries only recorded tabIds — just ungroup them, as before.
      const prevGroups = entry.reverse.prevGroups;
      if (!prevGroups) { await chromeApi.tabs.ungroup(entry.reverse.tabIds); return; }
      // Tabs that were ungrouped before grouping go back to ungrouped.
      const ungroupIds = prevGroups.filter((p) => p.groupId === -1).map((p) => p.tabId);
      if (ungroupIds.length) await chromeApi.tabs.ungroup(ungroupIds);
      // Tabs that came from a group return there: by groupId if it still exists,
      // otherwise into a fresh group recreated with the recorded title/color.
      const byGroup = new Map(); // original groupId -> { tabIds, title, color }
      for (const p of prevGroups) {
        if (p.groupId === -1) continue;
        if (!byGroup.has(p.groupId)) byGroup.set(p.groupId, { tabIds: [], title: p.title, color: p.color });
        byGroup.get(p.groupId).tabIds.push(p.tabId);
      }
      for (const [groupId, g] of byGroup) {
        const exists = await chromeApi.tabGroups.get(groupId).then(() => true).catch(() => false);
        if (exists) {
          await chromeApi.tabs.group({ tabIds: g.tabIds, groupId });
        } else {
          const newId = await chromeApi.tabs.group({ tabIds: g.tabIds });
          await chromeApi.tabGroups.update(newId, { title: g.title, color: g.color });
        }
      }
      return;
    }
    case 'createBookmark':
      await chromeApi.bookmarks.remove(entry.reverse.bookmarkId);
      return;
    case 'deleteBookmark': {
      const { parentId, index, title, url } = entry.reverse;
      // If the bookmark's folder was removed and recreated earlier this batch,
      // its id changed — recreate the bookmark in the new folder.
      const target = idRemap.get(parentId) ?? parentId;
      await chromeApi.bookmarks.create({ parentId: target, index, title, url });
      return;
    }
    case 'moveBookmark': {
      // If the bookmark's original folder was removed in the same batch and has
      // since been recreated, its id changed — move to the recreated folder.
      const parentId = idRemap.get(entry.reverse.parentId) ?? entry.reverse.parentId;
      await chromeApi.bookmarks.move(entry.reverse.bookmarkId, { parentId, index: entry.reverse.index });
      return;
    }
    case 'removeFolder': {
      // reverse null means the removal was skipped (root/non-empty) → nothing to undo.
      if (!entry.reverse) return;
      // If this folder's OWN parent was also removed and recreated earlier this
      // batch (nested folders), create it under the recreated parent.
      const target = idRemap.get(entry.reverse.parentId) ?? entry.reverse.parentId;
      const created = await chromeApi.bookmarks.create({ parentId: target, index: entry.reverse.index, title: entry.reverse.title });
      // Record old→new id so a moveBookmark/child reversed later this batch lands here.
      if (entry.reverse.folderId && created && created.id) idRemap.set(entry.reverse.folderId, created.id);
      return;
    }
    case 'discardTab':
      return; // discard is transparent; the tab reloads on next focus
    default:
      throw new Error(`Cannot reverse action: ${entry.action}`);
  }
}
