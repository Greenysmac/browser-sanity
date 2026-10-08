import { OTHER_ID } from './bookmark-collector.js';

const ACTIONS = new Set(['closeTab', 'groupTabs', 'parkTab', 'createBookmark', 'deleteBookmark', 'discardTab', 'moveBookmark', 'removeFolder']);

export function indexById(snapshots) {
  return new Map(snapshots.map((s) => [s.tabId, s]));
}

// Splits each model-returned group into one PlanItem per window, since
// chrome.tabs.group is per-window and cannot span windows. A window with
// fewer than 2 of the group's tabs is normally skipped — grouping a single tab
// is a pointless no-op. The exception: a single-tab item is kept when its name
// matches an existing open group in that window (`openNamesByWindow`) or a
// parked group (`parkedNames`), since joining an existing group is useful even
// for one tab. Name matching is trimmed/case-insensitive.
//
// When a group's name matches a parked group but NO open group of that name
// exists in the window, the result isn't a live tab group at all — the tabs
// belong in the parked record. Those windows emit one `parkTab` item per tab
// (file-and-close) instead of a single `groupTabs` item.
export function mapGroupResult(groups, tabsById, { openNamesByWindow = new Map(), parkedNames = [] } = {}) {
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
  const parkedSet = new Set(parkedNames.map(norm));
  const openSets = new Map();
  for (const [windowId, names] of openNamesByWindow) openSets.set(windowId, new Set((names || []).map(norm)));
  const items = [];
  groups.forEach((g, gi) => {
    const byWindow = new Map();
    for (const id of g.tabIds) {
      const t = tabsById.get(id);
      if (!t) continue;
      if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
      byWindow.get(t.windowId).push(t);
    }
    let wi = 0;
    for (const [windowId, members] of byWindow) {
      const name = norm(g.name);
      const matchesOpen = openSets.has(windowId) && openSets.get(windowId).has(name);
      const matchesParked = parkedSet.has(name);
      // A parked name with no open group in this window → file the tabs into the
      // parked record (one parkTab per tab) rather than form an open group.
      if (matchesParked && !matchesOpen) {
        for (const m of members) {
          items.push({
            itemId: `park-${gi}-${wi++}`,
            action: 'parkTab',
            status: 'pending',
            reason: `File into parked group "${g.name}"`,
            data: { tabId: m.tabId, url: m.url, title: m.title, groupName: g.name, windowId, index: m.index },
          });
        }
        continue;
      }
      if (members.length < 2 && !matchesOpen) continue; // single tab, no existing group to join
      items.push({
        itemId: `group-${gi}-${wi++}`,
        action: 'groupTabs',
        status: 'pending',
        reason: `Group "${g.name}" (${members.length} tabs)`,
        data: {
          groupName: g.name, color: g.color, windowId,
          tabIds: members.map((m) => m.tabId),
          members: members.map((m) => ({ tabId: m.tabId, title: m.title, url: m.url })),
        },
      });
    }
  });
  return items;
}

export function mapStaleResult(stale, tabsById, candidateIds = null) {
  return stale
    .map((s) => {
      if (candidateIds && !candidateIds.has(s.tabId)) return null;
      const t = tabsById.get(s.tabId);
      if (!t) return null;
      if (s.action === 'suspend') {
        return { itemId: `discard-${t.tabId}`, action: 'discardTab', status: 'pending', reason: s.reason || 'Idle — suspend to free memory', data: { tabId: t.tabId, url: t.url, title: t.title } };
      }
      return {
        itemId: `close-${t.tabId}`,
        action: 'closeTab',
        status: 'pending',
        reason: s.reason || `Idle ${t.idleDays} days`,
        data: {
          tabId: t.tabId, url: t.url, title: t.title,
          windowId: t.windowId, index: t.index, pinned: t.pinned,
          bookmarkFirst: !!s.suggestBookmark,
        },
      };
    })
    .filter(Boolean);
}

export function mapImportantResult(important, tabsById) {
  return important
    .map((i) => {
      const t = tabsById.get(i.tabId);
      if (!t) return null;
      return {
        itemId: `bm-${t.tabId}`,
        action: 'createBookmark',
        status: 'pending',
        reason: i.reason || 'Worth keeping',
        data: { tabId: t.tabId, url: t.url, title: t.title, folderPath: i.folderPath.length ? i.folderPath : ['Browser Organizer'] },
      };
    })
    .filter(Boolean);
}

// Maps model "moves" to moveBookmark items. `bookmarksById` is keyed by string
// bookmark id (the candidates sent to the model). match mode forbids new folders;
// new folders are created under `otherId` (the real "Other bookmarks" root,
// which differs between Chrome and Edge) so the bar stays untouched.
export function mapOrganizeResult(moves, bookmarksById, mode = 'additive', otherId = OTHER_ID, folderPathById = new Map()) {
  return (moves || [])
    .map((m) => {
      const b = bookmarksById.get(m.bookmarkId);
      if (!b) return null;
      const item = {
        itemId: `mv-${b.id}`,
        action: 'moveBookmark',
        status: 'pending',
        data: { bookmarkId: b.id, fromParentId: b.parentId, fromIndex: b.index, title: b.title, url: b.url },
      };
      let path, isNew = false;
      if (m.targetFolderId) {
        // The model must reference a real folder from the inventory we sent —
        // don't move a bookmark into an id the model invented/hallucinated.
        if (!folderPathById.has(m.targetFolderId)) return null;
        if (m.targetFolderId === b.parentId) return null; // already there → no-op
        item.data.toParentId = m.targetFolderId;
        path = folderPathById.get(m.targetFolderId) || 'folder';
      } else if (m.newFolderPath && m.newFolderPath.length && mode !== 'match') {
        item.data.toFolderPath = m.newFolderPath;
        item.data.toRootId = otherId;
        path = m.newFolderPath.join('/');
        isNew = true;
      } else {
        return null; // match mode + newFolderPath, or no usable destination
      }
      // The panel shows the leaf folder as a chip (full path on hover); the model's
      // free-text reason is dropped — the destination folder is the category.
      item.data.toPath = path;
      item.data.toLabel = path.split('/').filter(Boolean).pop() || path;
      item.data.toNew = isNew;
      item.reason = `Move to ${path}${isNew ? ' (new folder)' : ''}`; // concise text for exports/digest
      return item;
    })
    .filter(Boolean);
}

export function validatePlanItem(item) {
  return !!item
    && typeof item.itemId === 'string'
    && ACTIONS.has(item.action)
    && typeof item.status === 'string'
    && typeof item.data === 'object' && item.data !== null;
}
