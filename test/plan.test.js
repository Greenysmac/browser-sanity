import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapGroupResult, mapStaleResult, mapImportantResult, validatePlanItem, indexById, mapOrganizeResult } from '../extension/lib/plan.js';

test('mapOrganizeResult maps existing-folder + new-folder moves and drops no-ops', () => {
  const byId = new Map([
    ['9', { id: '9', parentId: '2', index: 0, title: 'MDN', url: 'https://mdn.dev' }],
    ['8', { id: '8', parentId: '2', index: 1, title: 'React', url: 'https://react.dev' }],
    ['7', { id: '7', parentId: '5', index: 0, title: 'Kept', url: 'https://k.dev' }],
  ]);
  const moves = [
    { bookmarkId: '9', targetFolderId: '5', reason: 'docs' },      // existing folder
    { bookmarkId: '8', newFolderPath: ['Dev', 'React'] },          // new folder
    { bookmarkId: '7', targetFolderId: '5' },                      // no-op (already in 5)
    { bookmarkId: 'nope', targetFolderId: '5' },                   // unknown -> dropped
  ];
  const folderPathById = new Map([['5', 'Other Bookmarks/Dev']]);
  const out = mapOrganizeResult(moves, byId, 'additive', '2', folderPathById);
  assert.equal(out.length, 2);
  const nine = out.find((i) => i.data.bookmarkId === '9');
  assert.equal(nine.action, 'moveBookmark');
  assert.equal(nine.data.toParentId, '5');
  assert.deepEqual(nine.data.fromParentId, '2');
  assert.equal(nine.data.toLabel, 'Dev');                    // leaf folder name (chip)
  assert.equal(nine.data.toPath, 'Other Bookmarks/Dev');     // full path (tooltip)
  assert.equal(nine.data.toNew, false);
  assert.equal(nine.reason, 'Move to Other Bookmarks/Dev');
  const eight = out.find((i) => i.data.bookmarkId === '8');
  assert.deepEqual(eight.data.toFolderPath, ['Dev', 'React']);
  assert.equal(eight.data.toRootId, '2');
  assert.equal(eight.data.toLabel, 'React');
  assert.equal(eight.data.toNew, true);
  assert.match(eight.reason, /Move to Dev\/React \(new folder\)/);
});

test('mapOrganizeResult in match mode rejects new-folder moves', () => {
  const byId = new Map([['8', { id: '8', parentId: '2', index: 0, title: 'R', url: 'https://r.dev' }]]);
  const out = mapOrganizeResult([{ bookmarkId: '8', newFolderPath: ['Dev'] }], byId, 'match');
  assert.deepEqual(out, []);
});

const tabs = [
  { tabId: 1, title: 'A', url: 'https://a.com', windowId: 9, index: 0, pinned: false, idleDays: 40 },
  { tabId: 2, title: 'B', url: 'https://b.com', windowId: 9, index: 1, pinned: false, idleDays: 50 },
];
const byId = indexById(tabs);

test('mapGroupResult only emits a window when 2+ of the group tabs land there', () => {
  const tabs = [
    { tabId: 1, title: 'A', url: 'https://a.com', windowId: 9, index: 0, pinned: false, idleDays: 1 },
    { tabId: 2, title: 'B', url: 'https://b.com', windowId: 9, index: 1, pinned: false, idleDays: 1 },
    { tabId: 3, title: 'C', url: 'https://c.com', windowId: 7, index: 0, pinned: false, idleDays: 1 },
  ];
  const byId = indexById(tabs);
  const items = mapGroupResult([{ name: 'Work', color: 'blue', tabIds: [1, 2, 3] }], byId);
  assert.equal(items.length, 1); // window 7 has only 1 of the group's tabs, so it's dropped
  const w9 = items.find((i) => i.data.windowId === 9);
  assert.deepEqual(w9.data.tabIds.sort(), [1, 2]);
  assert.equal(w9.data.members.length, 2);
  assert.equal(w9.data.members[0].title, 'A');
  assert.equal(items.find((i) => i.data.windowId === 7), undefined);
});

test('mapGroupResult keeps a single-tab item only when the name matches an existing open or parked group', () => {
  const tabs = [
    { tabId: 1, title: 'A', url: 'https://a.com', windowId: 9, index: 0, pinned: false },
    { tabId: 2, title: 'B', url: 'https://b.com', windowId: 9, index: 1, pinned: false },
    { tabId: 3, title: 'C', url: 'https://c.com', windowId: 9, index: 2, pinned: false },
  ];
  const byId = indexById(tabs);
  const groups = [
    { name: 'Dev', color: 'blue', tabIds: [1] },      // matches an open group in window 9 → kept
    { name: 'Reading', color: 'red', tabIds: [2] },    // matches a parked group → kept
    { name: 'Brand New', color: 'green', tabIds: [3] },// no match → dropped (pointless single-tab group)
  ];
  const openNamesByWindow = new Map([[9, ['dev']]]); // case/space-insensitive match
  const items = mapGroupResult(groups, byId, { openNamesByWindow, parkedNames: ['  Reading '] });
  const names = items.map((i) => i.data.groupName).sort();
  assert.deepEqual(names, ['Dev', 'Reading']);
  // A single-tab join still carries its one tab.
  const dev = items.find((i) => i.data.groupName === 'Dev');
  assert.deepEqual(dev.data.tabIds, [1]);
  assert.equal(dev.data.windowId, 9);
});

test('mapGroupResult drops a single-tab open-group match in the wrong window', () => {
  const tabs = [{ tabId: 1, title: 'A', url: 'https://a.com', windowId: 5, index: 0, pinned: false }];
  const byId = indexById(tabs);
  // "Dev" is open in window 9, but the tab is in window 5 — the per-window match
  // fails, so a lone tab is not kept.
  const items = mapGroupResult([{ name: 'Dev', color: 'blue', tabIds: [1] }], byId, { openNamesByWindow: new Map([[9, ['Dev']]]) });
  assert.deepEqual(items, []);
});

test('mapStaleResult resolves tab details and dedupes missing tabs', () => {
  const items = mapStaleResult([
    { tabId: 1, reason: 'old', suggestBookmark: true },
    { tabId: 99, reason: 'gone', suggestBookmark: false },
  ], byId);
  assert.equal(items.length, 1);
  assert.equal(items[0].action, 'closeTab');
  assert.equal(items[0].data.tabId, 1);
  assert.equal(items[0].data.url, 'https://a.com');
  assert.equal(items[0].data.bookmarkFirst, true);
});

test('mapImportantResult builds createBookmark items', () => {
  const items = mapImportantResult([{ tabId: 2, folderPath: ['Dev'], reason: 'ref' }], byId);
  assert.equal(items[0].action, 'createBookmark');
  assert.deepEqual(items[0].data.folderPath, ['Dev']);
  assert.equal(items[0].data.url, 'https://b.com');
});

test('validatePlanItem rejects malformed items', () => {
  assert.equal(validatePlanItem({ itemId: 'x', action: 'closeTab', status: 'pending', data: {} }), true);
  assert.equal(validatePlanItem({ action: 'nope' }), false);
  assert.equal(validatePlanItem(null), false);
});

test('mapStaleResult drops tabIds outside the candidate set (injection guard)', () => {
  const tabs = [
    { tabId: 1, title: 'A', url: 'https://a.com', windowId: 9, index: 0, pinned: false, idleDays: 40 },
    { tabId: 2, title: 'B', url: 'https://b.com', windowId: 9, index: 1, pinned: false, idleDays: 5 },
  ];
  const byId = indexById(tabs);
  const candidateIds = new Set([1]); // only tab 1 was sent as a candidate
  const items = mapStaleResult([{ tabId: 1, reason: 'old' }, { tabId: 2, reason: 'injected' }], byId, candidateIds);
  assert.equal(items.length, 1);
  assert.equal(items[0].data.tabId, 1);
});

test('mapStaleResult emits discardTab for suspend disposition', () => {
  const tabs = [{ tabId: 5, title: 'Docs', url: 'https://d.com', windowId: 1, index: 0, pinned: false, idleDays: 30 }];
  const byId = indexById(tabs);
  const items = mapStaleResult([{ tabId: 5, reason: 'keep but idle', action: 'suspend' }], byId, new Set([5]));
  assert.equal(items[0].action, 'discardTab');
  assert.equal(items[0].data.tabId, 5);
});

test('mapOrganizeResult drops a move to a targetFolderId not in the inventory', () => {
  const byId = new Map([['9', { id: '9', parentId: '2', index: 0, title: 'MDN', url: 'https://mdn.dev' }]]);
  // Model returns a folder id that was never sent — must not become a move.
  const folderPathById = new Map([['5', 'Other Bookmarks/Dev']]);
  const out = mapOrganizeResult([{ bookmarkId: '9', targetFolderId: '999' }], byId, 'additive', '2', folderPathById);
  assert.deepEqual(out, []);
});

// --- TASK 1: parkTab vs groupTabs for parked/open names ----------------------

test('mapGroupResult emits parkTab for a parked name (no open group) and groupTabs for an open one', () => {
  const tabs = [
    { tabId: 1, title: 'H1', url: 'https://h1.com', windowId: 9, index: 0, pinned: false },
    { tabId: 2, title: 'H2', url: 'https://h2.com', windowId: 9, index: 1, pinned: false },
    { tabId: 3, title: 'W1', url: 'https://w1.com', windowId: 9, index: 2, pinned: false },
    { tabId: 4, title: 'W2', url: 'https://w2.com', windowId: 9, index: 3, pinned: false },
  ];
  const byId = indexById(tabs);
  const groups = [
    { name: 'Hearing research', color: 'red', tabIds: [1, 2] }, // parked, no open group → parkTab x2
    { name: 'Work', color: 'blue', tabIds: [3, 4] },            // open group → groupTabs
  ];
  const openNamesByWindow = new Map([[9, ['Work']]]);
  const items = mapGroupResult(groups, byId, { openNamesByWindow, parkedNames: ['  hearing research  '] });
  const parks = items.filter((i) => i.action === 'parkTab');
  const grouped = items.filter((i) => i.action === 'groupTabs');
  assert.equal(parks.length, 2);
  assert.equal(grouped.length, 1);
  // One parkTab per tab, carrying the destination parked group name + where it was.
  assert.deepEqual(parks.map((p) => p.data.tabId).sort(), [1, 2]);
  assert.ok(parks.every((p) => p.data.groupName === 'Hearing research'));
  assert.equal(parks[0].data.windowId, 9);
  assert.equal(parks[0].data.url, 'https://h1.com');
  assert.equal(parks[0].data.index, 0);
  assert.ok(parks.every((p) => p.status === 'pending'));
  // The open-group match is still a single groupTabs item with both tabs.
  assert.equal(grouped[0].data.groupName, 'Work');
  assert.deepEqual(grouped[0].data.tabIds.sort(), [3, 4]);
});

test('mapGroupResult prefers an open group over a parked record of the same name (groupTabs, not parkTab)', () => {
  const tabs = [{ tabId: 1, title: 'A', url: 'https://a.com', windowId: 9, index: 0, pinned: false }];
  const byId = indexById(tabs);
  // "Reading" is both parked and open in window 9 — the open group wins, so a
  // single-tab join is a groupTabs item, not a parkTab.
  const items = mapGroupResult([{ name: 'Reading', color: 'red', tabIds: [1] }], byId, {
    openNamesByWindow: new Map([[9, ['Reading']]]), parkedNames: ['Reading'],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].action, 'groupTabs');
  assert.deepEqual(items[0].data.tabIds, [1]);
});
