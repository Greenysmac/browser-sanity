import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionForApply, applyItems, buildPlan, sliceForScan, projectTabsForHost, ignoreKey, applyIgnoreList, recordDecision, decisionRules } from '../extension/lib/orchestrator.js';

import { dedupeTabActions, finalizePlan, runCommand, selectOrganizeCandidates, projectBookmarksForHost, findEmptyFolders } from '../extension/lib/orchestrator.js';
import { applyWhitelist, applyFolderProtection } from '../extension/lib/protections.js';
import { applyItem } from '../extension/lib/executor.js';

test('findEmptyFolders proposes empty/emptied leaf folders; skips roots, non-empty, and folders with subfolders', () => {
  const folders = [
    { id: '1', parentId: '0', index: 0, title: 'Bar', path: ['Bar'], isRoot: true },
    { id: '10', parentId: '2', index: 0, title: 'EmptyNow', path: ['Other', 'EmptyNow'] },
    { id: '11', parentId: '2', index: 1, title: 'HasChild', path: ['Other', 'HasChild'] },
    { id: '12', parentId: '2', index: 2, title: 'EmptiedByMove', path: ['Other', 'EmptiedByMove'] },
    { id: '13', parentId: '2', index: 3, title: 'Parent', path: ['Other', 'Parent'] },
    { id: '14', parentId: '13', index: 0, title: 'Sub', path: ['Other', 'Parent', 'Sub'] },
  ];
  const bookmarks = [
    { id: 'a', parentId: '11' }, // HasChild stays non-empty
    { id: 'b', parentId: '12' }, // moved out below
  ];
  const moves = [{ action: 'moveBookmark', data: { bookmarkId: 'b', fromParentId: '12', toParentId: '20' } }];
  const out = findEmptyFolders(folders, bookmarks, moves);
  assert.deepEqual(out.map((i) => i.data.folderId).sort(), ['10', '12', '14']);
  assert.equal(out[0].action, 'removeFolder');
});
import { validatePlanItem } from '../extension/lib/plan.js';

test('selectOrganizeCandidates: match/additive = unfiled only, full = all', () => {
  const bms = [
    { id: '1', parentId: '2' },  // unfiled (Other Bookmarks root)
    { id: '2', parentId: '10' }, // filed
    { id: '3', parentId: '1' },  // unfiled (bar root)
  ];
  assert.deepEqual(selectOrganizeCandidates(bms, 'match').map((b) => b.id), ['1', '3']);
  assert.deepEqual(selectOrganizeCandidates(bms, 'additive').map((b) => b.id), ['1', '3']);
  assert.deepEqual(selectOrganizeCandidates(bms, 'full').map((b) => b.id), ['1', '2', '3']);
});

test('projectBookmarksForHost redacts urls and flattens the folder path', () => {
  const p = projectBookmarksForHost([{ id: '9', title: 'T', url: 'https://x.com/p?q=secret#h', path: ['Other Bookmarks', 'Dev'] }]);
  assert.equal(p[0].id, '9');
  assert.equal(p[0].folder, 'Other Bookmarks/Dev');
  assert.ok(!p[0].url.includes('secret')); // query redacted before egress
});

test('applyFolderProtection drops moves/removes touching the bar or whitelisted folders', () => {
  const folders = [
    { id: '1', parentId: '0', path: ['Bookmarks Bar'], isRoot: true },
    { id: '10', parentId: '2', path: ['Other Bookmarks', 'Work'] },
    { id: '20', parentId: '2', path: ['Other Bookmarks', 'Misc'] },
  ];
  const items = [
    { action: 'moveBookmark', data: { bookmarkId: 'a', fromParentId: '1', toParentId: '20' } }, // out of bar -> drop
    { action: 'moveBookmark', data: { bookmarkId: 'b', fromParentId: '2', toParentId: '10' } }, // into Work (protected) -> drop
    { action: 'moveBookmark', data: { bookmarkId: 'c', fromParentId: '2', toParentId: '20' } }, // allowed
    { action: 'removeFolder', data: { folderId: '10', parentId: '2', title: 'Work' } },          // protected -> drop
    { action: 'removeFolder', data: { folderId: '20', parentId: '2', title: 'Misc' } },          // allowed
    { action: 'closeTab', data: { url: 'https://x.com' } },                                      // untouched
  ];
  const out = applyFolderProtection(items, { protectBookmarkBar: true, protectedFolders: ['Work'], folders });
  assert.deepEqual(out.map((i) => i.data.bookmarkId || i.data.folderId || 'tab'), ['c', '20', 'tab']);
});

test('applyFolderProtection blocks new-folder moves into the bar or a protected path (projected)', () => {
  const folders = [
    { id: '1', parentId: '0', path: ['Bookmarks Bar'], isRoot: true },
    { id: '2', parentId: '0', path: ['Other Bookmarks'], isRoot: true },
  ];
  const items = [
    { action: 'moveBookmark', data: { bookmarkId: 'a', fromParentId: '2', toRootId: '1', toFolderPath: ['X'] } },      // into bar via root -> drop
    { action: 'moveBookmark', data: { bookmarkId: 'b', fromParentId: '2', toRootId: '2', toFolderPath: ['Work'] } },   // projected Other/Work protected -> drop
    { action: 'moveBookmark', data: { bookmarkId: 'c', fromParentId: '2', toRootId: '2', toFolderPath: ['Reading'] } },// ok
  ];
  const out = applyFolderProtection(items, { protectBookmarkBar: true, protectedFolders: ['Work'], folders });
  assert.deepEqual(out.map((i) => i.data.bookmarkId), ['c']);
});

test('applyFolderProtection allows moving out of the bar when protection is off', () => {
  const folders = [{ id: '1', parentId: '0', path: ['Bookmarks Bar'], isRoot: true }, { id: '20', parentId: '2', path: ['Other Bookmarks', 'Misc'] }];
  const out = applyFolderProtection(
    [{ action: 'moveBookmark', data: { bookmarkId: 'a', fromParentId: '1', toParentId: '20' } }],
    { protectBookmarkBar: false, protectedFolders: [], folders },
  );
  assert.equal(out.length, 1);
});

test('organize actions validate and are review-only in auto mode', () => {
  assert.equal(validatePlanItem({ itemId: 'm', action: 'moveBookmark', status: 'pending', data: {} }), true);
  assert.equal(validatePlanItem({ itemId: 'r', action: 'removeFolder', status: 'pending', data: {} }), true);
  const { autoApply, needsReview } = partitionForApply(
    [{ action: 'moveBookmark', data: {} }, { action: 'removeFolder', data: {} }, { action: 'closeTab', data: {} }],
    { automationMode: 'auto' },
  );
  assert.deepEqual(autoApply.map((i) => i.action), ['closeTab']);
  assert.equal(needsReview.length, 2);
});

test('runCommand applies whitelist + ignore-list via finalizePlan (safety controls hold on the command path)', async () => {
  const chromeApi = {
    storage: { local: { async get() { return {}; }, async set() {} } },
    tabs: { async query() { return [
      { id: 1, url: 'https://github.com/x', windowId: 1, index: 0 },
      { id: 2, url: 'https://other.com/y', windowId: 1, index: 1 },
    ]; } },
  };
  const nativeClient = { request: async () => ({ close: [{ tabId: 1, reason: 'a' }, { tabId: 2, reason: 'b' }], groups: [], important: [] }) };
  const settings = { adapter: 'claude', decisions: {}, whitelist: ['github.com'], ignore: [] };
  const items = await runCommand('close old tabs', { nativeClient, chromeApi, settings });
  const urls = items.filter((i) => i.action === 'closeTab').map((i) => i.data.url);
  assert.ok(!urls.some((u) => new URL(u).hostname === 'github.com'), 'whitelisted host dropped on command path');
  assert.ok(urls.some((u) => new URL(u).hostname === 'other.com'), 'non-whitelisted tab kept');
});

test('projectTabsForHost coarsens private/localhost URLs to origin only', () => {
  const out = projectTabsForHost([
    { tabId: 1, title: 'a', url: 'https://example.com/path?q=1#f', idleDays: 1 },
    { tabId: 2, title: 'b', url: 'http://192.168.1.1/admin/secret?token=x', idleDays: 1 },
    { tabId: 3, title: 'c', url: 'http://localhost:8080/private/id', idleDays: 1 },
  ]);
  assert.equal(out[0].url, 'https://example.com/path'); // public: query stripped, path kept
  assert.equal(out[1].url, 'http://192.168.1.1');       // private: origin only, path dropped
  assert.equal(out[2].url, 'http://localhost:8080');    // localhost: origin only
});

test('projectTabsForHost passes groupName through, defaulting to empty', () => {
  const out = projectTabsForHost([
    { tabId: 1, title: 'a', url: 'https://a.com', idleDays: 1, groupName: 'Dev' },
    { tabId: 2, title: 'b', url: 'https://b.com', idleDays: 1 },
  ]);
  assert.equal(out[0].groupName, 'Dev');
  assert.equal(out[1].groupName, '');
});

test('buildPlan preserves free/local results when an AI phase throws', async () => {
  const stored = {};
  const chromeApi = {
    storage: { local: { async get(k) { return typeof k === 'string' ? { [k]: stored[k] } : { ...stored }; }, async set(o) { Object.assign(stored, o); } } },
    tabs: { async query() { return [
      { id: 1, url: 'https://a.com', windowId: 1, index: 0, pinned: false },
      { id: 2, url: 'https://a.com', windowId: 1, index: 1, pinned: false }, // duplicate → local result
    ]; } },
    bookmarks: { async getTree() { return []; } },
    history: { async getVisits() { return []; } },
  };
  const nativeClient = { request: async () => { throw new Error('CLI crashed'); } };
  const settings = { adapter: 'claude', enabledFeatures: { dupeTabs: true, groupTabs: true, staleTabs: false, importantBookmarks: false, cleanBookmarks: false }, staleTabDays: 14, staleBookmarkDays: 180, deadLinkBatchSize: 200 };
  const items = await buildPlan({ settings, nativeClient, chromeApi, now: 1 });
  assert.ok(items.some((i) => i.action === 'closeTab'), 'local dupe-tab result preserved despite the group phase throwing');
});

test('applyWhitelist drops destructive actions on protected domains (and subdomains)', () => {
  const items = [
    { action: 'closeTab', data: { url: 'https://mail.google.com/x' } },
    { action: 'closeTab', data: { url: 'https://random.com' } },
    { action: 'deleteBookmark', data: { url: 'https://sub.github.com/y' } },
    { action: 'groupTabs', data: { tabIds: [1] } },
  ];
  const out = applyWhitelist(items, ['google.com', 'github.com']);
  assert.deepEqual(out.map((i) => i.data.url || 'group'), ['https://random.com', 'group']);
});

test('buildPlan excludes already-grouped tabs from group candidates (respects existing groups)', async () => {
  const stored = {};
  const chromeApi = {
    storage: { local: { async get(k) { return typeof k === 'string' ? { [k]: stored[k] } : { ...stored }; }, async set(o) { Object.assign(stored, o); } } },
    tabs: { async query() { return [
      { id: 1, url: 'https://a.com', windowId: 1, index: 0, groupId: 7 },   // already in a group
      { id: 2, url: 'https://b.com', windowId: 1, index: 1, groupId: -1 },
      { id: 3, url: 'https://c.com', windowId: 1, index: 2, groupId: -1 },
    ]; } },
    bookmarks: { async getTree() { return []; } },
    history: { async getVisits() { return []; } },
  };
  let groupPayload = null;
  const nativeClient = { request: async (m) => { if (m.task === 'group') groupPayload = m.payload; return { groups: [], stale: [], important: [] }; } };
  const settings = { adapter: 'claude', enabledFeatures: { groupTabs: true, staleTabs: false, importantBookmarks: false, cleanBookmarks: false, dupeTabs: false }, staleTabDays: 14, staleBookmarkDays: 180, deadLinkBatchSize: 200 };
  await buildPlan({ settings, nativeClient, chromeApi, now: 1 });
  const ids = groupPayload.tabs.map((t) => t.tabId).sort();
  assert.deepEqual(ids, [2, 3]); // the grouped tab (1) is excluded
});

test('buildPlan includes already-grouped tabs in group candidates when regroupExisting is on', async () => {
  const stored = {};
  const chromeApi = {
    storage: { local: { async get(k) { return typeof k === 'string' ? { [k]: stored[k] } : { ...stored }; }, async set(o) { Object.assign(stored, o); } } },
    tabs: { async query() { return [
      { id: 1, url: 'https://a.com', windowId: 1, index: 0, groupId: 7 },   // already in a group
      { id: 2, url: 'https://b.com', windowId: 1, index: 1, groupId: -1 },
      { id: 3, url: 'https://c.com', windowId: 1, index: 2, groupId: -1 },
    ]; } },
    bookmarks: { async getTree() { return []; } },
    history: { async getVisits() { return []; } },
  };
  let groupPayload = null;
  const nativeClient = { request: async (m) => { if (m.task === 'group') groupPayload = m.payload; return { groups: [], stale: [], important: [] }; } };
  const settings = { adapter: 'claude', regroupExisting: true, enabledFeatures: { groupTabs: true, staleTabs: false, importantBookmarks: false, cleanBookmarks: false, dupeTabs: false }, staleTabDays: 14, staleBookmarkDays: 180, deadLinkBatchSize: 200 };
  await buildPlan({ settings, nativeClient, chromeApi, now: 1 });
  const ids = groupPayload.tabs.map((t) => t.tabId).sort();
  assert.deepEqual(ids, [1, 2, 3]); // every tab sent, grouped included
});

test('buildPlan excludes pinned tabs from stale close candidates', async () => {
  const stored = {};
  const chromeApi = {
    storage: { local: { async get(k) { return typeof k === 'string' ? { [k]: stored[k] } : { ...stored }; }, async set(o) { Object.assign(stored, o); } } },
    tabs: { async query() { return [
      { id: 1, url: 'https://a.com', windowId: 1, index: 0, pinned: true, lastAccessed: 0 },
      { id: 2, url: 'https://b.com', windowId: 1, index: 1, pinned: false, lastAccessed: 0 },
    ]; } },
    bookmarks: { async getTree() { return []; } },
    history: { async getVisits() { return []; } },
  };
  let stalePayload = null;
  const nativeClient = { request: async (m) => { if (m.task === 'stale') stalePayload = m.payload; return { groups: [], stale: [], important: [] }; } };
  const settings = { adapter: 'claude', enabledFeatures: { groupTabs: false, staleTabs: true, importantBookmarks: false, cleanBookmarks: false, dupeTabs: false }, staleTabDays: 14, staleBookmarkDays: 180, deadLinkBatchSize: 200 };
  await buildPlan({ settings, nativeClient, chromeApi, now: 100 * 86400000 });
  assert.ok(stalePayload, 'stale task should run');
  const ids = stalePayload.tabs.map((t) => t.tabId);
  assert.ok(!ids.includes(1), 'pinned tab excluded from stale candidates');
  assert.ok(ids.includes(2), 'unpinned idle tab included');
});

test('dedupeTabActions keeps one close/discard per tab (dupe+stale collision)', () => {
  const items = [
    { itemId: 'dupe-close-5', action: 'closeTab', data: { tabId: 5 } },
    { itemId: 'close-5', action: 'closeTab', data: { tabId: 5 } },   // same tab, other source
    { itemId: 'close-6', action: 'closeTab', data: { tabId: 6 } },
    { itemId: 'group-0', action: 'groupTabs', data: { tabIds: [5, 6] } }, // untouched
  ];
  const out = dedupeTabActions(items);
  assert.deepEqual(out.map((i) => i.itemId), ['dupe-close-5', 'close-6', 'group-0']);
});

test('finalizePlan dedupes, validates, and applies the ignore list', () => {
  const items = [
    { itemId: 'close-5', action: 'closeTab', status: 'pending', data: { tabId: 5, url: 'https://a.com' } },
    { itemId: 'close-5b', action: 'closeTab', status: 'pending', data: { tabId: 5, url: 'https://a.com' } },
    { action: 'bogus' }, // dropped by validatePlanItem
  ];
  const out = finalizePlan(items, { ignore: [] });
  assert.equal(out.length, 1); // one valid close for tab 5
});

test('partitionForApply routes everything to review in review mode', () => {
  const items = [{ itemId: 'a' }, { itemId: 'b' }];
  const r = partitionForApply(items, { automationMode: 'review' });
  assert.equal(r.needsReview.length, 2);
  assert.equal(r.autoApply.length, 0);
});

test('partitionForApply auto-applies in auto mode', () => {
  const items = [{ itemId: 'a' }];
  const r = partitionForApply(items, { automationMode: 'auto' });
  assert.equal(r.autoApply.length, 1);
  assert.equal(r.needsReview.length, 0);
});

test('applyItems (as wired by handleApply) fails a moveBookmark whose target became protected after the plan was built, without moving it', async () => {
  const removed = [], moved = [];
  const chrome = {
    bookmarks: {
      async get(id) { return [{ id, parentId: '2', index: 0 }]; },
      async getChildren() { return []; },
      async create(n) { return { id: 'new', ...n }; },
      async move(id, dest) { moved.push({ id, dest }); return { id, ...dest }; },
      async remove(id) { removed.push(id); },
    },
  };
  const folders = [{ id: '10', parentId: '2', path: ['Other Bookmarks', 'Work'] }];
  const item = { itemId: 'm1', action: 'moveBookmark', data: { bookmarkId: '9', fromParentId: '2', fromIndex: 0, toParentId: '10', title: 't', url: 'https://x.com' } };
  const recorded = [];
  // Simulates handleApply: settings/folders are fetched fresh (here: post-change,
  // now protecting "Work"), not whatever was current when the plan was built.
  const settings = { protectBookmarkBar: true, protectedFolders: ['Work'] };
  const res = await applyItems([item], {
    runId: 'run-1',
    applyItem: (i) => applyItem(i, { chrome, runId: 'run-1', settings, folders }),
    recordUndo: async (entries) => { recorded.push(...entries); },
  });
  assert.deepEqual(res.applied, []);
  assert.deepEqual(res.failed, ['m1']);
  assert.deepEqual(moved, []); // nothing actually moved
  assert.equal(recorded.length, 0); // no undo recorded for a skipped/failed item
});

test('applyItems applies each item, records undo, and reports failures', async () => {
  const applied = [];
  const recorded = [];
  const items = [
    { itemId: 'ok', action: 'groupTabs', data: {} },
    { itemId: 'bad', action: 'groupTabs', data: {} },
  ];
  const deps = {
    applyItem: async (item) => {
      if (item.itemId === 'bad') throw new Error('fail');
      applied.push(item.itemId);
      return { undoId: 'u-' + item.itemId, ts: 1, action: item.action, reverse: {} };
    },
    recordUndo: async (entries) => { recorded.push(...entries); },
  };
  const res = await applyItems(items, deps);
  assert.deepEqual(applied, ['ok']);
  assert.deepEqual(res.applied, ['ok']);
  assert.deepEqual(res.failed, ['bad']);
  assert.equal(recorded.length, 1);
});

test('applyItems applies every groupTabs item before any close/suspend item, whatever the input order', async () => {
  const order = [];
  const items = [
    { itemId: 'close1', action: 'closeTab', data: {} },
    { itemId: 'group1', action: 'groupTabs', data: {} },
    { itemId: 'discard1', action: 'discardTab', data: {} },
    { itemId: 'group2', action: 'groupTabs', data: {} },
    { itemId: 'move1', action: 'moveBookmark', data: {} },
  ];
  const deps = {
    applyItem: async (item) => { order.push(item.itemId); return { undoId: 'u', ts: 1, action: item.action, reverse: {} }; },
    recordUndo: async () => {},
  };
  await applyItems(items, deps);
  // Both groups run first (in their original relative order), then everything
  // else (also in original relative order).
  assert.deepEqual(order, ['group1', 'group2', 'close1', 'discard1', 'move1']);
});

test('buildPlan includes the configured adapter in native requests', async () => {
  let seen = null;
  const stored = {};
  const chromeApi = {
    storage: { local: { async get(k) { return typeof k === 'string' ? { [k]: stored[k] } : { ...stored }; }, async set(o) { Object.assign(stored, o); } } },
    tabs: { async query() { return [{ id: 1, url: 'https://a.com', windowId: 1, index: 0 }]; } },
    bookmarks: { async getTree() { return []; } },
    history: { async getVisits() { return []; } },
  };
  const nativeClient = { request: async (m) => { seen = m; return { groups: [], stale: [], important: [] }; } };
  const settings = { adapter: 'kiro', enabledFeatures: { groupTabs: true, staleTabs: false, importantBookmarks: false, cleanBookmarks: false }, staleTabDays: 14, staleBookmarkDays: 180, deadLinkBatchSize: 200 };
  await buildPlan({ settings, nativeClient, chromeApi, now: 1 });
  assert.equal(seen.adapter, 'kiro');
});

test('buildPlan reconciles activity and persists it (drops closed tabs)', async () => {
  const stored = { tabActivity: { 1: { firstSeen: 0, lastActive: 0 }, 999: { firstSeen: 0, lastActive: 0 } } };
  const chromeApi = {
    storage: { local: {
      async get(k) { return typeof k === 'string' ? { [k]: stored[k] } : { ...stored }; },
      async set(obj) { Object.assign(stored, obj); },
    } },
    tabs: { async query() { return [{ id: 1, url: 'https://a.com', windowId: 1, index: 0, lastAccessed: 1000 }]; } },
    bookmarks: { async getTree() { return []; } },
    history: { async getVisits() { return []; } },
  };
  const nativeClient = { request: async () => ({ groups: [], stale: [], important: [] }) };
  const settings = { enabledFeatures: { groupTabs: false, staleTabs: false, importantBookmarks: false, cleanBookmarks: false }, staleTabDays: 14, staleBookmarkDays: 180 };
  await buildPlan({ settings, nativeClient, chromeApi, now: 2000 });
  assert.ok(!stored.tabActivity['999'], 'closed tab entry pruned');
  assert.ok(stored.tabActivity['1'], 'open tab kept');
});

test('deleteBookmark is never auto-applied, even in auto mode', () => {
  const items = [{ itemId: 'g', action: 'groupTabs' }, { itemId: 'd', action: 'deleteBookmark' }];
  const r = partitionForApply(items, { automationMode: 'auto' });
  assert.deepEqual(r.autoApply.map((i) => i.itemId), ['g']);
  assert.deepEqual(r.needsReview.map((i) => i.itemId), ['d']);
});

test('projectTabsForHost redacts query strings before sending to the model', () => {
  const out = projectTabsForHost([{ tabId: 1, title: 't', url: 'https://a.com/x?session=abc', idleDays: 2 }]);
  assert.equal(out[0].url, 'https://a.com/x');
});

test('buildPlan reports progress and honors cancel', async () => {
  const phases = [];
  const chromeApi = {
    storage: { local: { async get() { return {}; }, async set() {} } },
    tabs: { async query() { return [{ id: 1, url: 'https://a.com', windowId: 1, index: 0 }]; } },
    bookmarks: { async getTree() { return []; } },
    history: { async getVisits() { return []; } },
  };
  const nativeClient = { request: async () => ({ groups: [], stale: [], important: [] }) };
  const settings = { enabledFeatures: { groupTabs: true, staleTabs: false, importantBookmarks: false, cleanBookmarks: false }, staleTabDays: 14, staleBookmarkDays: 180, deadLinkBatchSize: 200 };
  const items = await buildPlan({ settings, nativeClient, chromeApi, now: 1, onProgress: (p, d, t) => phases.push([p, d, t]), shouldCancel: () => true });
  assert.ok(phases.length >= 1);
  assert.deepEqual(items, []); // cancelled before producing work
});

test('ignoreKey is stable per target and applyIgnoreList filters matches', () => {
  const closeItem = { action: 'closeTab', data: { url: 'https://a.com/x' } };
  const key = ignoreKey(closeItem);
  const items = [closeItem, { action: 'closeTab', data: { url: 'https://b.com' } }];
  const kept = applyIgnoreList(items, [key]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].data.url, 'https://b.com');
});

test('recordDecision + decisionRules surface repeated rejects as keep-rules', () => {
  let d = {};
  const item = { action: 'closeTab', data: { url: 'https://mail.google.com/x' } };
  d = recordDecision(d, item, 'reject');
  d = recordDecision(d, item, 'reject');
  const rules = decisionRules(d);
  assert.ok(rules.keep.includes('Do not suggest actions on https://mail.google.com/x'));
});

test('sliceForScan returns a batch and wraps the cursor', () => {
  const items = Array.from({ length: 5 }, (_, i) => i);
  let { slice, nextCursor } = sliceForScan(items, 0, 2);
  assert.deepEqual(slice, [0, 1]);
  assert.equal(nextCursor, 2);
  ({ slice, nextCursor } = sliceForScan(items, 4, 2));
  assert.deepEqual(slice, [4]);
  assert.equal(nextCursor, 0); // wrapped
});
