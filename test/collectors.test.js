import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSnapshot, collectTabs } from '../extension/lib/tab-collector.js';
import { flattenBookmarks, collectBookmarks, collectTree, isUnfiled, ROOT_IDS } from '../extension/lib/bookmark-collector.js';

test('collectTree returns folders with path, childCount, and root flags', async () => {
  const chromeApi = { bookmarks: { async getTree() { return [{ id: '0', children: [
    { id: '1', title: 'Bookmarks Bar', parentId: '0', index: 0, children: [
      { id: '10', title: 'Dev', parentId: '1', index: 0, children: [
        { id: '100', title: 'MDN', url: 'https://mdn.dev', parentId: '10', index: 0 },
      ] },
      { id: '11', title: 'Loose', url: 'https://x.com', parentId: '1', index: 1 },
    ] },
    { id: '2', title: 'Other Bookmarks', parentId: '0', index: 1, children: [] },
  ] }]; } } };
  const { bookmarks, folders, rootIds, barId, otherId } = await collectTree(chromeApi);
  const dev = folders.find((f) => f.id === '10');
  assert.deepEqual(dev.path, ['Bookmarks Bar', 'Dev']);
  assert.equal(dev.childCount, 1);
  assert.equal(folders.find((f) => f.id === '1').isRoot, true);
  assert.equal(folders.some((f) => f.id === '0'), false); // root '0' not emitted
  assert.equal(bookmarks.find((b) => b.id === '11').parentId, '1');
  assert.deepEqual([...rootIds].sort(), ['1', '2']);
  assert.equal(barId, '1');
  assert.equal(otherId, '2');
  assert.equal(isUnfiled({ parentId: '1' }), true);
  assert.equal(isUnfiled({ parentId: '10' }), false);
  assert.ok(ROOT_IDS.has('2'));
});

test('collectTree derives Edge-style roots where Other favourites != id 2', async () => {
  const chromeApi = { bookmarks: { async getTree() { return [{ id: '0', children: [
    { id: '1', title: 'Favourites bar', parentId: '0', index: 0, children: [{ id: 'a', title: 'barloose', url: 'https://b.com', parentId: '1', index: 0 }] },
    { id: '203', title: 'Other favourites', parentId: '0', index: 1, children: [{ id: 'c', title: 'otherloose', url: 'https://o.com', parentId: '203', index: 0 }] },
    { id: '722', title: 'Workspaces', parentId: '0', index: 2, children: [] },
  ] }]; } } };
  const { bookmarks, rootIds, barId, otherId } = await collectTree(chromeApi);
  assert.deepEqual([...rootIds].sort(), ['1', '203', '722']);
  assert.equal(barId, '1');
  assert.equal(otherId, '203'); // first non-bar root — where new folders go
  const other = bookmarks.find((b) => b.id === 'c');
  assert.equal(isUnfiled(other, rootIds), true);  // loose in Other favourites (203) counts as unfiled
  assert.equal(isUnfiled(other), false);          // the old bug: default Chrome ids miss it
});

const DAY = 86400000;

test('toSnapshot computes age and idle from activity', () => {
  const now = 10 * DAY;
  const tab = { id: 7, windowId: 1, index: 2, title: 'T', url: 'https://a.com', pinned: false, groupId: -1 };
  const activity = { 7: { firstSeen: 2 * DAY, lastActive: 6 * DAY } };
  const s = toSnapshot(tab, activity, now);
  assert.equal(s.tabId, 7);
  assert.equal(s.ageDays, 8);
  assert.equal(s.idleDays, 4);
});

test('collectTabs excludes non-http tabs', async () => {
  const chromeApi = { tabs: { async query() {
    return [
      { id: 1, url: 'https://a.com', windowId: 1, index: 0 },
      { id: 2, url: 'chrome://extensions', windowId: 1, index: 1 },
    ];
  } } };
  const tabs = await collectTabs(chromeApi, {}, 0);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].url, 'https://a.com');
});

test('collectTabs filters to a window when windowId is given', async () => {
  const chromeApi = { tabs: { async query() {
    return [
      { id: 1, url: 'https://a.com', windowId: 9, index: 0 },
      { id: 2, url: 'https://b.com', windowId: 7, index: 0 },
    ];
  } } };
  const tabs = await collectTabs(chromeApi, {}, 0, 9);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].windowId, 9);
});

test('toSnapshot defaults groupName to empty for existing callers', () => {
  const s = toSnapshot({ id: 1, url: 'https://a.com', groupId: -1 }, {}, 0);
  assert.equal(s.groupName, '');
});

test('collectTabs looks up the group title once per group and caches it', async () => {
  let calls = 0;
  const chromeApi = {
    tabs: { async query() {
      return [
        { id: 1, url: 'https://a.com', windowId: 1, index: 0, groupId: 5 },
        { id: 2, url: 'https://b.com', windowId: 1, index: 1, groupId: 5 },
        { id: 3, url: 'https://c.com', windowId: 1, index: 2, groupId: -1 },
      ];
    } },
    tabGroups: { async get(id) { calls += 1; assert.equal(id, 5); return { id, title: 'Dev' }; } },
  };
  const tabs = await collectTabs(chromeApi, {}, 0);
  assert.equal(tabs.find((t) => t.tabId === 1).groupName, 'Dev');
  assert.equal(tabs.find((t) => t.tabId === 2).groupName, 'Dev');
  assert.equal(tabs.find((t) => t.tabId === 3).groupName, '');
  assert.equal(calls, 1); // one lookup for the shared group, cached for the second tab
});

test('collectTabs uses empty groupName when tabGroups is missing', async () => {
  const chromeApi = { tabs: { async query() {
    return [{ id: 1, url: 'https://a.com', windowId: 1, index: 0, groupId: 5 }];
  } } };
  const tabs = await collectTabs(chromeApi, {}, 0);
  assert.equal(tabs[0].groupName, '');
});

test('collectTabs falls back to empty groupName when the lookup fails', async () => {
  const chromeApi = {
    tabs: { async query() { return [{ id: 1, url: 'https://a.com', windowId: 1, index: 0, groupId: 5 }]; } },
    tabGroups: { async get() { throw new Error('no such group'); } },
  };
  const tabs = await collectTabs(chromeApi, {}, 0);
  assert.equal(tabs[0].groupName, '');
});

test('flattenBookmarks yields leaves with folder path', () => {
  const tree = [{ id: '0', children: [
    { id: '1', title: 'Bar', children: [
      { id: '10', title: 'Dev', children: [
        { id: '100', title: 'MDN', url: 'https://mdn.dev', parentId: '10', index: 0, dateAdded: 5 },
      ] },
    ] },
  ] }];
  const flat = flattenBookmarks(tree);
  assert.equal(flat.length, 1);
  assert.deepEqual(flat[0].path, ['Bar', 'Dev']);
  assert.equal(flat[0].url, 'https://mdn.dev');
});

test('collectBookmarks reads the tree', async () => {
  const chromeApi = { bookmarks: { async getTree() {
    return [{ id: '0', children: [{ id: '1', title: 'X', url: 'https://x.com', parentId: '0', index: 0, dateAdded: 1 }] }];
  } } };
  const flat = await collectBookmarks(chromeApi);
  assert.equal(flat.length, 1);
});
