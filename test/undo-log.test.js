import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeMock } from './helpers/chrome-mock.js';
import { recordUndo, getUndoLog, filterUndo, pruneUndo, reverseEntry, claimUndoEntries, restoreUndoEntries } from '../extension/lib/undo-log.js';

const DAY = 86400000;
beforeEach(() => installChromeMock());

test('claimUndoEntries removes and returns matching entries (so they cannot be re-reversed)', async () => {
  await recordUndo([{ undoId: 'a', ts: 1, action: 'closeTab', reverse: {} }, { undoId: 'b', ts: 2, action: 'groupTabs', reverse: {} }]);
  const claimed = await claimUndoEntries(['a']);
  assert.deepEqual(claimed.map((e) => e.undoId), ['a']);
  assert.deepEqual((await getUndoLog()).map((e) => e.undoId), ['b']); // 'a' removed
  assert.deepEqual(await claimUndoEntries(['a']), []); // already claimed → nothing
});

test('restoreUndoEntries puts failed reversals back', async () => {
  await claimUndoEntries([]); // no-op
  await restoreUndoEntries([{ undoId: 'x', ts: 1, action: 'closeTab', reverse: {} }]);
  assert.deepEqual((await getUndoLog()).map((e) => e.undoId), ['x']);
});

test('concurrent recordUndo calls do not lose entries (serialized writes)', async () => {
  await Promise.all([
    recordUndo([{ undoId: 'c1', ts: 1, action: 'closeTab', reverse: {} }]),
    recordUndo([{ undoId: 'c2', ts: 2, action: 'closeTab', reverse: {} }]),
    recordUndo([{ undoId: 'c3', ts: 3, action: 'closeTab', reverse: {} }]),
  ]);
  assert.deepEqual((await getUndoLog()).map((e) => e.undoId).sort(), ['c1', 'c2', 'c3']);
});

test('recordUndo appends and getUndoLog reads back', async () => {
  await recordUndo([{ undoId: 'a', ts: 1, action: 'closeTab', reverse: {} }]);
  await recordUndo([{ undoId: 'b', ts: 2, action: 'groupTabs', reverse: {} }]);
  const log = await getUndoLog();
  assert.deepEqual(log.map((e) => e.undoId), ['a', 'b']);
});

test('filterUndo drops entries older than retention', () => {
  const now = 10 * DAY;
  const entries = [{ ts: 2 * DAY }, { ts: 9 * DAY }];
  const kept = filterUndo(entries, now, 7);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].ts, 9 * DAY);
});

test('pruneUndo persists the filtered log', async () => {
  await recordUndo([{ undoId: 'old', ts: 1, action: 'closeTab', reverse: {} }]);
  await pruneUndo(30 * DAY, 7);
  const log = await getUndoLog();
  assert.equal(log.length, 0);
});

test('reverseEntry closeTab reopens the tab and deletes the safety bookmark', async () => {
  const calls = [];
  const chrome = {
    tabs: { async create(x) { calls.push(['create', x]); } },
    bookmarks: { async remove(id) { calls.push(['bmRemove', id]); } },
  };
  await reverseEntry({ action: 'closeTab', reverse: { url: 'https://a', windowId: 1, index: 0, pinned: false, savedBookmarkId: '99' } }, chrome);
  assert.deepEqual(calls, [['create', { url: 'https://a', windowId: 1, index: 0, pinned: false, active: false }], ['bmRemove', '99']]);
});

test('reverseEntry dispatches by action', async () => {
  const calls = [];
  const chrome = {
    tabs: { async create(x) { calls.push(['create', x]); }, async ungroup(x) { calls.push(['ungroup', x]); } },
    bookmarks: { async create(x) { calls.push(['bmCreate', x]); }, async remove(x) { calls.push(['bmRemove', x]); } },
  };
  await reverseEntry({ action: 'closeTab', reverse: { url: 'https://a', windowId: 1, index: 0, pinned: false } }, chrome);
  await reverseEntry({ action: 'groupTabs', reverse: { tabIds: [1, 2] } }, chrome);
  await reverseEntry({ action: 'createBookmark', reverse: { bookmarkId: '5' } }, chrome);
  await reverseEntry({ action: 'deleteBookmark', reverse: { parentId: '1', index: 0, title: 'T', url: 'https://a' } }, chrome);
  assert.deepEqual(calls.map((c) => c[0]), ['create', 'ungroup', 'bmRemove', 'bmCreate']);
});

test('reverseEntry handles discardTab as a no-op', async () => {
  await reverseEntry({ action: 'discardTab', reverse: {} }, {}); // must not throw
  assert.ok(true);
});

// Models tabGroups.get: resolves for ids in `existing`, rejects otherwise (vanished group).
function makeGroupRestoreChrome(existing = []) {
  const existset = new Set(existing);
  const calls = [];
  return {
    _calls: calls,
    tabs: {
      async ungroup(ids) { calls.push(['ungroup', ids]); },
      async group(arg) { calls.push(['group', arg]); return 999; },
    },
    tabGroups: {
      async get(id) { if (!existset.has(id)) throw new Error('no such group'); return { id, title: 'live', color: 'blue' }; },
      async update(id, props) { calls.push(['update', id, props]); },
    },
  };
}

test('reverseEntry groupTabs returns tabs to a still-existing group by id', async () => {
  const chrome = makeGroupRestoreChrome([42]);
  await reverseEntry({ action: 'groupTabs', reverse: { tabIds: [1, 2], prevGroups: [{ tabId: 1, groupId: 42, title: 'Work', color: 'blue' }, { tabId: 2, groupId: 42, title: 'Work', color: 'blue' }] } }, chrome);
  assert.deepEqual(chrome._calls, [['group', { tabIds: [1, 2], groupId: 42 }]]);
});

test('reverseEntry groupTabs recreates a vanished group with its recorded title and color', async () => {
  const chrome = makeGroupRestoreChrome([]); // group 42 is gone
  await reverseEntry({ action: 'groupTabs', reverse: { tabIds: [1], prevGroups: [{ tabId: 1, groupId: 42, title: 'Work', color: 'red' }] } }, chrome);
  assert.deepEqual(chrome._calls, [
    ['group', { tabIds: [1] }],
    ['update', 999, { title: 'Work', color: 'red' }],
  ]);
});

test('reverseEntry groupTabs ungroups tabs that were previously ungrouped', async () => {
  const chrome = makeGroupRestoreChrome([]);
  await reverseEntry({ action: 'groupTabs', reverse: { tabIds: [1, 2], prevGroups: [{ tabId: 1, groupId: -1 }, { tabId: 2, groupId: -1 }] } }, chrome);
  assert.deepEqual(chrome._calls, [['ungroup', [1, 2]]]);
});

test('reverseEntry groupTabs handles an old-style entry (only tabIds) by ungrouping', async () => {
  const chrome = makeGroupRestoreChrome([]);
  await reverseEntry({ action: 'groupTabs', reverse: { tabIds: [1, 2] } }, chrome);
  assert.deepEqual(chrome._calls, [['ungroup', [1, 2]]]);
});

test('reverseEntry moveBookmark moves back; removeFolder recreates (and no-ops on skip)', async () => {
  const calls = [];
  const chrome = {
    bookmarks: {
      async move(id, dest) { calls.push(['move', id, dest]); },
      async create(x) { calls.push(['create', x]); },
    },
  };
  await reverseEntry({ action: 'moveBookmark', reverse: { bookmarkId: '9', parentId: '2', index: 3 } }, chrome);
  await reverseEntry({ action: 'removeFolder', reverse: { parentId: '2', index: 0, title: 'Empty' } }, chrome);
  await reverseEntry({ action: 'removeFolder', reverse: null }, chrome); // skipped removal → nothing
  assert.deepEqual(calls, [
    ['move', '9', { parentId: '2', index: 3 }],
    ['create', { parentId: '2', index: 0, title: 'Empty' }],
  ]);
});

test('reverseEntry remaps a bookmark move into a folder recreated in the same batch', async () => {
  const calls = [];
  const chrome = {
    bookmarks: {
      async move(id, dest) { calls.push(['move', id, dest]); },
      async create(x) { calls.push(['create', x]); return { id: 'newF', ...x }; },
    },
  };
  const idRemap = new Map();
  // Reverse-apply order: recreate the folder first (new id), then reverse the move.
  await reverseEntry({ action: 'removeFolder', reverse: { folderId: 'oldF', parentId: '2', index: 0, title: 'Cloud' } }, chrome, idRemap);
  await reverseEntry({ action: 'moveBookmark', reverse: { bookmarkId: '9', parentId: 'oldF', index: 0 } }, chrome, idRemap);
  assert.deepEqual(calls, [
    ['create', { parentId: '2', index: 0, title: 'Cloud' }],
    ['move', '9', { parentId: 'newF', index: 0 }], // oldF remapped to the recreated folder
  ]);
});

test('reverseEntry remaps a nested removed folder (and its bookmark) into the recreated parent', async () => {
  let n = 0;
  const created = [];
  const chrome = {
    bookmarks: { async create(x) { const id = `new${++n}`; created.push({ parentId: x.parentId, id }); return { id, ...x }; } },
  };
  const idRemap = new Map();
  // Outer folder A and inner folder B (parent A) were both removed; reverse recreates
  // A first (new id), then B must land under the RECREATED A, then a bookmark under B.
  await reverseEntry({ action: 'removeFolder', reverse: { folderId: 'A', parentId: '2', index: 0, title: 'Outer' } }, chrome, idRemap);
  await reverseEntry({ action: 'removeFolder', reverse: { folderId: 'B', parentId: 'A', index: 0, title: 'Inner' } }, chrome, idRemap);
  await reverseEntry({ action: 'deleteBookmark', reverse: { parentId: 'B', index: 0, title: 'Doc', url: 'https://d' } }, chrome, idRemap);
  assert.equal(created[0].parentId, '2');    // outer recreated under root
  assert.equal(created[1].parentId, 'new1'); // inner recreated under the recreated outer (A → new1)
  assert.equal(created[2].parentId, 'new2'); // bookmark recreated under the recreated inner (B → new2)
});
