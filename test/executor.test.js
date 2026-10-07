import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyItem, ensureFolder, ProtectedTargetError } from '../extension/lib/executor.js';

function makeChrome() {
  const removed = [];
  const created = [];
  const moved = [];
  let nextBmId = 100;
  const folders = { '1': [] }; // bookmarks-bar children
  return {
    _removed: removed,
    _created: created,
    _moved: moved,
    tabs: {
      async get(id) { return { id, url: 'https://a.com' }; },
      async remove(id) { removed.push(id); },
      async group({ tabIds }) { this._grouped = tabIds; return 555; },
      async ungroup(ids) { this._ungrouped = ids; },
    },
    tabGroups: { async update(id, props) { this._groupUpdate = { id, props }; } },
    bookmarks: {
      async getChildren(parentId) { return folders[parentId] || []; },
      async create(node) {
        const id = String(nextBmId++);
        const created2 = { id, ...node };
        created.push(created2);
        (folders[node.parentId] ||= []).push(created2);
        folders[id] = [];
        return created2;
      },
      async remove(id) { removed.push(`bm:${id}`); },
      async get(id) { return [{ id }]; },
      async move(id, dest) { moved.push({ id, dest }); return { id, ...dest }; },
    },
  };
}

test('moveBookmark moves to an existing target and reverses to origin', async () => {
  const chrome = makeChrome();
  const item = { action: 'moveBookmark', data: { bookmarkId: '9', fromParentId: '2', fromIndex: 3, toParentId: '10', title: 't', url: 'https://x.com' } };
  const entry = await applyItem(item, { chrome });
  assert.deepEqual(chrome._moved.at(-1), { id: '9', dest: { parentId: '10' } });
  assert.equal(entry.action, 'moveBookmark');
  assert.deepEqual(entry.reverse, { bookmarkId: '9', parentId: '2', index: 3 });
});

test('moveBookmark creates the target folder from toFolderPath under the given root', async () => {
  const chrome = makeChrome();
  const item = { action: 'moveBookmark', data: { bookmarkId: '9', fromParentId: '1', fromIndex: 0, toFolderPath: ['Work'], toRootId: '2', title: 't', url: 'https://x.com' } };
  await applyItem(item, { chrome });
  assert.ok(chrome._created.some((c) => c.title === 'Work' && c.parentId === '2'));
  assert.equal(chrome._moved.at(-1).id, '9');
});

test('removeFolder removes an empty non-root folder and reverses by recreating it', async () => {
  const chrome = makeChrome();
  const f = await chrome.bookmarks.create({ parentId: '2', title: 'Empty' }); // folders[f.id] = []
  const item = { action: 'removeFolder', data: { folderId: f.id, parentId: '2', index: 0, title: 'Empty' } };
  const entry = await applyItem(item, { chrome });
  assert.ok(chrome._removed.includes(`bm:${f.id}`));
  assert.deepEqual(entry.reverse, { folderId: f.id, parentId: '2', index: 0, title: 'Empty' });
});

test('removeFolder refuses a root folder (no-op, skipped)', async () => {
  const chrome = makeChrome();
  const entry = await applyItem({ action: 'removeFolder', data: { folderId: '1', parentId: '0', index: 0, title: 'Bar' } }, { chrome });
  assert.equal(entry.skipped, true);
  assert.ok(!chrome._removed.includes('bm:1'));
});

test('removeFolder refuses a non-empty folder (no-op, skipped)', async () => {
  const chrome = makeChrome();
  const f = await chrome.bookmarks.create({ parentId: '2', title: 'Full' });
  await chrome.bookmarks.create({ parentId: f.id, title: 'child', url: 'https://c.com' });
  const entry = await applyItem({ action: 'removeFolder', data: { folderId: f.id, parentId: '2', index: 0, title: 'Full' } }, { chrome });
  assert.equal(entry.skipped, true);
  assert.ok(!chrome._removed.includes(`bm:${f.id}`));
});

test('moveBookmark throws when the target folder becomes protected between plan-build and apply (stale plan vs. live settings)', async () => {
  const item = { action: 'moveBookmark', data: { bookmarkId: '9', fromParentId: '2', fromIndex: 0, toParentId: '10', title: 't', url: 'https://x.com' } };
  const folders = [{ id: '10', parentId: '2', path: ['Other Bookmarks', 'Work'] }];

  // At plan-build time "Work" wasn't protected — applying with those (stale)
  // settings still succeeds.
  const chromeOk = makeChrome();
  const entry = await applyItem(item, { chrome: chromeOk, settings: { protectBookmarkBar: true, protectedFolders: [] }, folders });
  assert.equal(entry.action, 'moveBookmark');
  assert.deepEqual(chromeOk._moved.at(-1), { id: '9', dest: { parentId: '10' } });

  // The user protects "Work" before clicking Apply. The executor must re-check
  // LIVE settings/folders at apply time, not silently reuse the plan's snapshot.
  const chromeBlocked = makeChrome();
  await assert.rejects(
    () => applyItem(item, { chrome: chromeBlocked, settings: { protectBookmarkBar: true, protectedFolders: ['Work'] }, folders }),
    ProtectedTargetError,
  );
  assert.deepEqual(chromeBlocked._moved, []); // nothing actually moved
});

test('removeFolder throws when the folder becomes protected between plan-build and apply', async () => {
  const chrome = makeChrome();
  const f = await chrome.bookmarks.create({ parentId: '2', title: 'Work' });
  const folders = [{ id: f.id, parentId: '2', path: ['Other Bookmarks', 'Work'] }];
  const item = { action: 'removeFolder', data: { folderId: f.id, parentId: '2', index: 0, title: 'Work' } };
  await assert.rejects(
    () => applyItem(item, { chrome, settings: { protectBookmarkBar: true, protectedFolders: ['Work'] }, folders }),
    ProtectedTargetError,
  );
  assert.ok(!chrome._removed.includes(`bm:${f.id}`)); // nothing actually removed
});

test('moveBookmark and removeFolder are unaffected by protections when no settings/folders deps are given (existing callers)', async () => {
  const chrome = makeChrome();
  const moveItem = { action: 'moveBookmark', data: { bookmarkId: '9', fromParentId: '2', fromIndex: 0, toParentId: '10', title: 't', url: 'https://x.com' } };
  await applyItem(moveItem, { chrome }); // no settings/folders -> protection check skipped, as before
  assert.deepEqual(chrome._moved.at(-1), { id: '9', dest: { parentId: '10' } });
});

test('closeTab removes the tab and returns a reopen undo entry', async () => {
  const chrome = makeChrome();
  const item = { action: 'closeTab', data: { tabId: 3, url: 'https://a.com', title: 'A', windowId: 1, index: 2, pinned: false, bookmarkFirst: false } };
  const undo = await applyItem(item, { chrome });
  assert.deepEqual(chrome._removed, [3]);
  assert.equal(undo.action, 'closeTab');
  assert.equal(undo.reverse.url, 'https://a.com');
});

test('closeTab refuses to close a pinned tab (protected)', async () => {
  const removed = [];
  const chrome = {
    tabs: { async get(id) { return { id, url: 'https://a.com', pinned: true }; }, async remove(id) { removed.push(id); } },
    bookmarks: { async getChildren() { return []; }, async create(n) { return { id: '1', ...n }; } },
  };
  const item = { action: 'closeTab', data: { tabId: 3, url: 'https://a.com', title: 'A', windowId: 1, index: 0, pinned: false, bookmarkFirst: false } };
  await assert.rejects(() => applyItem(item, { chrome }), /pinned/i);
  assert.deepEqual(removed, []);
});

test('closeTab with bookmarkFirst saves before closing and records the bookmark for undo', async () => {
  const chrome = makeChrome();
  const item = { action: 'closeTab', data: { tabId: 3, url: 'https://a.com', title: 'A', windowId: 1, index: 2, pinned: false, bookmarkFirst: true } };
  const undo = await applyItem(item, { chrome });
  assert.equal(chrome._created.length, 3); // 2 folders + 1 bookmark
  assert.equal(chrome._created.at(-1).url, 'https://a.com');
  assert.equal(undo.reverse.savedBookmarkId, chrome._created.at(-1).id); // recorded so undo can delete it
});

test('groupTabs groups and titles the group', async () => {
  const chrome = makeChrome();
  const item = { action: 'groupTabs', data: { tabIds: [1, 2], groupName: 'Work', color: 'blue' } };
  const undo = await applyItem(item, { chrome });
  assert.deepEqual(chrome.tabs._grouped, [1, 2]);
  assert.equal(chrome.tabGroups._groupUpdate.props.title, 'Work');
  assert.deepEqual(undo.reverse.tabIds, [1, 2]);
});

// Mock focused on the groupTabs reuse path: the first tab reports a windowId,
// tabGroups.query returns `groups`, and tabs.group records every call.
function makeGroupChrome(groups) {
  const groupCalls = [];
  return {
    _groupCalls: groupCalls,
    tabs: {
      async get(id) { return { id, windowId: 7, url: 'https://a.com' }; },
      async group(arg) { groupCalls.push(arg); return 555; },
    },
    tabGroups: {
      async query({ windowId }) { this._queried = windowId; return groups; },
      async update(id, props) { this._groupUpdate = { id, props }; },
    },
  };
}

test('groupTabs reuses a matching group: tabs join it, no new group, no update', async () => {
  const chrome = makeGroupChrome([{ id: 42, title: 'Work' }]);
  const item = { action: 'groupTabs', data: { tabIds: [1, 2], groupName: 'Work', color: 'blue' } };
  const undo = await applyItem(item, { chrome });
  assert.equal(chrome.tabGroups._queried, 7);
  assert.deepEqual(chrome._groupCalls, [{ tabIds: [1, 2], groupId: 42 }]);
  assert.equal(chrome.tabGroups._groupUpdate, undefined);
  assert.deepEqual(undo.reverse.tabIds, [1, 2]);
});

test('groupTabs match ignores case and surrounding whitespace', async () => {
  const chrome = makeGroupChrome([{ id: 9, title: '  wOrK  ' }]);
  const item = { action: 'groupTabs', data: { tabIds: [3], groupName: 'Work', color: 'blue' } };
  await applyItem(item, { chrome });
  assert.deepEqual(chrome._groupCalls, [{ tabIds: [3], groupId: 9 }]);
  assert.equal(chrome.tabGroups._groupUpdate, undefined);
});

test('groupTabs with no matching group falls back to creating one', async () => {
  const chrome = makeGroupChrome([{ id: 9, title: 'Personal' }]);
  const item = { action: 'groupTabs', data: { tabIds: [1, 2], groupName: 'Work', color: 'blue' } };
  await applyItem(item, { chrome });
  assert.deepEqual(chrome._groupCalls, [{ tabIds: [1, 2] }]);
  assert.equal(chrome.tabGroups._groupUpdate.props.title, 'Work');
});

test('groupTabs falls back to creating one when tabGroups.query fails', async () => {
  const chrome = makeGroupChrome([]);
  chrome.tabGroups.query = async () => { throw new Error('no query'); };
  const item = { action: 'groupTabs', data: { tabIds: [1, 2], groupName: 'Work', color: 'blue' } };
  await applyItem(item, { chrome });
  assert.deepEqual(chrome._groupCalls, [{ tabIds: [1, 2] }]);
  assert.equal(chrome.tabGroups._groupUpdate.props.title, 'Work');
});

test('createBookmark builds folder path then creates the bookmark', async () => {
  const chrome = makeChrome();
  const item = { action: 'createBookmark', data: { url: 'https://b.com', title: 'B', folderPath: ['Dev', 'React'] } };
  const undo = await applyItem(item, { chrome });
  assert.equal(chrome._created.length, 3); // Dev, React, bookmark
  assert.equal(chrome._created[0].parentId, '2'); // defaults to Other Bookmarks (bar protected)
  assert.ok(undo.reverse.bookmarkId);
});

test('createBookmark honors protectBookmarkBar: false and targets barId', async () => {
  const chrome = makeChrome();
  const item = { action: 'createBookmark', data: { url: 'https://b.com', title: 'B', folderPath: ['Dev'] } };
  await applyItem(item, { chrome, settings: { protectBookmarkBar: false }, barId: 'bar-root', otherId: 'other-root' });
  assert.equal(chrome._created[0].parentId, 'bar-root');
});

test('createBookmark targets otherId when protectBookmarkBar is true', async () => {
  const chrome = makeChrome();
  const item = { action: 'createBookmark', data: { url: 'https://b.com', title: 'B', folderPath: ['Dev'] } };
  await applyItem(item, { chrome, settings: { protectBookmarkBar: true }, barId: 'bar-root', otherId: 'other-root' });
  assert.equal(chrome._created[0].parentId, 'other-root');
});

test('createBookmark honors explicit rootId in data', async () => {
  const chrome = makeChrome();
  const item = { action: 'createBookmark', data: { url: 'https://b.com', title: 'B', folderPath: ['Dev'], rootId: 'custom-root' } };
  await applyItem(item, { chrome, settings: { protectBookmarkBar: true }, barId: 'bar-root', otherId: 'other-root' });
  assert.equal(chrome._created[0].parentId, 'custom-root');
});

test('deleteBookmark removes and returns a recreate entry (url still matches)', async () => {
  const chrome = makeChrome();
  chrome.bookmarks.get = async (id) => [{ id, url: 'https://old.com', parentId: '1', index: 0, title: 'Old' }];
  const item = { action: 'deleteBookmark', data: { bookmarkId: '77', parentId: '1', index: 0, title: 'Old', url: 'https://old.com' } };
  const undo = await applyItem(item, { chrome });
  assert.deepEqual(chrome._removed, ['bm:77']);
  assert.equal(undo.reverse.url, 'https://old.com');
});

test('deleteBookmark refuses when the bookmark url no longer matches (edited since scan)', async () => {
  const chrome = makeChrome();
  chrome.bookmarks.get = async (id) => [{ id, url: 'https://EDITED.com', parentId: '1', index: 0, title: 'New' }];
  const item = { action: 'deleteBookmark', data: { bookmarkId: '77', parentId: '1', index: 0, title: 'Old', url: 'https://old.com' } };
  await assert.rejects(() => applyItem(item, { chrome }), /no longer matches/i);
  assert.deepEqual(chrome._removed, []); // nothing deleted
});

test('closeTab refuses to close a tab whose url no longer matches (id reuse guard)', async () => {
  const removed = [];
  const chrome = {
    tabs: { async get(id) { return { id, url: 'https://DIFFERENT.com' }; }, async remove(id) { removed.push(id); } },
    bookmarks: { async getChildren() { return []; }, async create(n) { return { id: '1', ...n }; } },
  };
  const item = { action: 'closeTab', data: { tabId: 3, url: 'https://a.com', title: 'A', windowId: 1, index: 0, pinned: false, bookmarkFirst: false } };
  await assert.rejects(() => applyItem(item, { chrome }), /stale|no longer matches/i);
  assert.deepEqual(removed, []); // nothing closed
});

test('closeTab proceeds when the url still matches', async () => {
  const removed = [];
  const chrome = {
    tabs: { async get(id) { return { id, url: 'https://a.com' }; }, async remove(id) { removed.push(id); } },
    bookmarks: { async getChildren() { return []; }, async create(n) { return { id: '1', ...n }; } },
  };
  const item = { action: 'closeTab', data: { tabId: 3, url: 'https://a.com', title: 'A', windowId: 1, index: 0, pinned: false, bookmarkFirst: false } };
  const undo = await applyItem(item, { chrome });
  assert.deepEqual(removed, [3]);
  assert.equal(undo.reverse.url, 'https://a.com');
});

test('applyItem stamps runId and a human label on the undo entry', async () => {
  const chrome = { tabs: { async get(id) { return { id, url: 'https://a.com' }; }, async remove() {} }, bookmarks: { async getChildren() { return []; }, async create(n) { return { id: '1', ...n }; } } };
  const item = { action: 'closeTab', data: { tabId: 3, url: 'https://a.com', title: 'A', windowId: 1, index: 0, pinned: false, bookmarkFirst: false } };
  const undo = await applyItem(item, { chrome, runId: 'run-1' });
  assert.equal(undo.runId, 'run-1');
  assert.match(undo.label, /Close tab.*A/);
});

test('discardTab suspends the tab', async () => {
  const discarded = [];
  const chrome = { tabs: { async discard(id) { discarded.push(id); } } };
  const undo = await applyItem({ action: 'discardTab', data: { tabId: 7, url: 'https://d.com', title: 'D' } }, { chrome });
  assert.deepEqual(discarded, [7]);
  assert.equal(undo.action, 'discardTab');
});

test('ensureFolder reuses an existing folder', async () => {
  const chrome = makeChrome();
  await ensureFolder(['Dev'], chrome);
  await ensureFolder(['Dev'], chrome);
  const devFolders = chrome._created.filter((c) => c.title === 'Dev');
  assert.equal(devFolders.length, 1); // created once, reused second time
});
