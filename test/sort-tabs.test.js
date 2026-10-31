import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../extension/lib/orchestrator.js';
// --- buildPlan onlyTabIds (sort-just-these mode) ---------------------------

function makeChrome(tabs, overrides = {}) {
  const stored = {};
  return {
    storage: { local: {
      async get(k) { return typeof k === 'string' ? { [k]: stored[k] } : { ...stored }; },
      async set(o) { Object.assign(stored, o); },
    } },
    tabs: { async query() { return tabs; } },
    bookmarks: { async getTree() { return []; } },
    history: { async getVisits() { return []; } },
    ...overrides,
  };
}

const SORT_SETTINGS = {
  adapter: 'claude',
  enabledFeatures: { groupTabs: true, staleTabs: true, importantBookmarks: true, cleanBookmarks: true, dupeTabs: true, organizeBookmarks: true },
  staleTabDays: 14, staleBookmarkDays: 180, deadLinkBatchSize: 200,
};

test('buildPlan with onlyTabIds keeps just those tabs and runs grouping over all of them', async () => {
  const chromeApi = makeChrome([
    { id: 1, url: 'https://a.com', windowId: 1, index: 0, groupId: 7 },   // already grouped
    { id: 2, url: 'https://b.com', windowId: 1, index: 1, groupId: -1 },
    { id: 3, url: 'https://c.com', windowId: 1, index: 2, groupId: -1 },
  ]);
  const seen = [];
  const nativeClient = { request: async (m) => { if (m.task) seen.push(m.task); if (m.task === 'group') seen.push(m.payload.tabs.map((t) => t.tabId).sort()); return { groups: [], stale: [], important: [], moves: [] }; } };
  await buildPlan({ settings: SORT_SETTINGS, nativeClient, chromeApi, now: 1, onlyTabIds: [1, 2] });
  // Only the grouping phase ran, and it saw exactly tabs 1 and 2 (including the
  // already-grouped tab 1, like regroupExisting). The index-read request (no
  // task) that gathers parked names for single-tab joins is ignored here.
  assert.deepEqual(seen, ['group', [1, 2]]);
});

test('buildPlan with onlyTabIds skips the stale/important/bookmark phases', async () => {
  const chromeApi = makeChrome([
    { id: 1, url: 'https://a.com', windowId: 1, index: 0, groupId: -1, lastAccessed: 0 },
    { id: 2, url: 'https://a.com', windowId: 1, index: 1, groupId: -1, lastAccessed: 0 }, // duplicate
  ]);
  const tasks = [];
  const nativeClient = { request: async (m) => { if (m.task) tasks.push(m.task); return { groups: [], stale: [], important: [], moves: [] }; } };
  // now far in the future so both tabs would be "stale" if that phase ran
  const items = await buildPlan({ settings: SORT_SETTINGS, nativeClient, chromeApi, now: 100 * 86400000, onlyTabIds: [1, 2] });
  assert.deepEqual(tasks, ['group']); // stale/important/organize-bookmarks never requested (index-read carries no task)
  assert.ok(!items.some((i) => i.action === 'closeTab'), 'no dupe-tab or stale close items produced');
});

test("buildPlan honors an explicit groupMode 'suggest' even with onlyTabIds (which otherwise defaults to 'mine')", async () => {
  const chromeApi = makeChrome([
    { id: 1, url: 'https://a.com', windowId: 1, index: 0, groupId: -1 },
    { id: 2, url: 'https://b.com', windowId: 1, index: 1, groupId: -1 },
  ]);
  let mode = null;
  const nativeClient = { request: async (m) => { if (m.task === 'group') mode = m.payload.mode; return { groups: [], stale: [], important: [], moves: [] }; } };
  await buildPlan({ settings: SORT_SETTINGS, nativeClient, chromeApi, now: 1, onlyTabIds: [1, 2], groupMode: 'suggest' });
  assert.equal(mode, 'suggest', "explicit 'suggest' wins over the onlyTabIds default of 'mine'");

  // And an explicit 'mine' still works; the onlyTabIds default is unchanged when
  // no groupMode is given.
  mode = null;
  await buildPlan({ settings: SORT_SETTINGS, nativeClient, chromeApi, now: 1, onlyTabIds: [1, 2], groupMode: 'mine' });
  assert.equal(mode, 'mine');
  mode = null;
  await buildPlan({ settings: SORT_SETTINGS, nativeClient, chromeApi, now: 1, onlyTabIds: [1, 2] });
  assert.equal(mode, 'mine', 'onlyTabIds with no groupMode still defaults to mine');
});

// --- service-worker handlers (sortGroup / sortSelected) --------------------

// A full-enough chrome mock to import the service worker (which registers many
// listeners at module load) and drive its onMessage handler. The fake native
// port answers 'organize/group' with no groups and records the request so we
// can assert which tab ids reached buildPlan. The worker's handlers read the
// live globalThis.chrome, so each test swaps in its own mock and reuses the one
// imported module (listeners register once).
function listener() {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), fire: (...args) => fns.map((fn) => fn(...args)), fns };
}

// Set a placeholder chrome before importing so the worker's load-time listener
// registrations don't throw; makeChromeForSw() replaces it per test.
const bootOnMessage = listener();
function bootChrome() {
  const noop = listener();
  return {
    runtime: { id: 'self', onConnect: noop, onInstalled: noop, onStartup: noop, onMessage: bootOnMessage },
    action: { onClicked: noop }, alarms: { onAlarm: noop, async create() {} },
    commands: { onCommand: noop }, omnibox: { onInputEntered: noop },
    notifications: { onClicked: noop }, storage: { onChanged: noop },
    tabs: { onActivated: noop, onUpdated: noop, onRemoved: noop },
  };
}
globalThis.chrome = bootChrome();
const sw = await import('../extension/background/service-worker.js');
void sw;
const swOnMessage = bootOnMessage.fns[0]; // the worker's registered onMessage listener

function installSwChrome({ groupTabs = {}, highlighted = [], webTabs = null, groups = null, groupFails = false, initialLocal = null, indexGroups = null, collections = null } = {}) {
  const stored = { local: {}, sync: {} };
  if (initialLocal) Object.assign(stored.local, initialLocal);
  const requests = [];
  // Every tab the mock knows about, so buildPlan's own tabs.query({}) sees them
  // (it collects all tabs, then filters to onlyTabIds). `webTabs`, when given,
  // is the full set tabs.query({}) returns (used by the analyze/close-dup paths).
  const allTabs = webTabs
    ? webTabs.map((t, i) => ({ windowId: 1, index: i, groupId: -1, ...t }))
    : [...Object.values(groupTabs).flat(), ...highlighted].map((t, i) => ({ windowId: 1, index: i, ...t }));
  const area = (name) => ({
    async get(k) { return typeof k === 'string' ? { [k]: stored[name][k] } : (k == null ? { ...stored[name] } : Object.fromEntries(Object.keys(k).map((kk) => [kk, stored[name][kk] ?? k[kk]]))); },
    async set(o) { Object.assign(stored[name], o); },
    async remove(k) { delete stored[name][k]; },
  });
  // Fake native port: on each posted request, reply ok with empty groups by
  // default. When `groups` is given, a grouping request answers with them (so a
  // test can assert on the mapped plan); when `groupFails` is set the grouping
  // request errors, to exercise the failure path.
  function makePort() {
    const onMsg = listener();
    const onDisc = listener();
    return {
      onMessage: onMsg, onDisconnect: onDisc,
      postMessage(msg) {
        requests.push(msg);
        setTimeout(() => {
          if (msg.task === 'group' && groupFails) { onMsg.fire({ id: msg.id, ok: false, error: 'grouping failed' }); return; }
          const result = { groups: [], stale: [], important: [], moves: [], ready: true };
          if (msg.task === 'group' && groups) result.groups = groups;
          if (msg.type === 'index-read' && indexGroups) result.groups = indexGroups;
          if (msg.task === 'collections') result.collections = collections || [];
          onMsg.fire({ id: msg.id, ok: true, result });
        }, 0);
      },
      disconnect() {},
    };
  }
  const chrome = {
    runtime: { id: 'self', lastError: null, connectNative: () => makePort(), getURL: (p) => p },
    storage: { local: area('local'), sync: area('sync') },
    tabs: {
      async query(q) {
        if (q && 'groupId' in q) return groupTabs[q.groupId] || [];
        if (q && q.highlighted) return highlighted;
        return allTabs; // tabs.query({}) — buildPlan collects all, then filters to onlyTabIds
      },
    },
    tabGroups: { async get() { return { title: '' }; } },
  };
  globalThis.chrome = chrome;
  const dispatch = (message) => new Promise((resolve) => {
    const ret = swOnMessage(message, { id: 'self' }, resolve);
    assert.equal(ret, true); // async response path
  });
  return { dispatch, requests };
}

test('sortGroup collects every tab in the given group and sorts just those', async () => {
  const { dispatch, requests } = installSwChrome({
    groupTabs: { 7: [{ id: 11, url: 'https://a.com' }, { id: 12, url: 'https://b.com' }] },
  });
  const res = await dispatch({ cmd: 'sortGroup', groupId: 7 });
  assert.equal(res.ok, true);
  const groupReq = requests.find((r) => r.task === 'group');
  assert.ok(groupReq, 'a grouping request was made');
  assert.deepEqual(groupReq.payload.tabs.map((t) => t.tabId).sort(), [11, 12]);
});

test('sortSelected uses the highlighted tabs of the current window', async () => {
  const { dispatch, requests } = installSwChrome({
    highlighted: [{ id: 21, url: 'https://x.com' }, { id: 22, url: 'https://y.com' }],
  });
  const res = await dispatch({ cmd: 'sortSelected' });
  assert.equal(res.ok, true);
  const groupReq = requests.find((r) => r.task === 'group');
  assert.ok(groupReq, 'a grouping request was made');
  assert.deepEqual(groupReq.payload.tabs.map((t) => t.tabId).sort(), [21, 22]);
});

test('sortSelected with fewer than one tab returns a friendly message and never runs the backend', async () => {
  const { dispatch, requests } = installSwChrome({ highlighted: [] });
  const res = await dispatch({ cmd: 'sortSelected' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.items, []);
  assert.match(res.message, /select/i);
  assert.equal(requests.length, 0, 'no native request made for an empty selection');
});

test('sortGroup with an empty group returns a friendly message instead of running', async () => {
  const { dispatch, requests } = installSwChrome({ groupTabs: { 7: [] } });
  const res = await dispatch({ cmd: 'sortGroup', groupId: 7 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.items, []);
  assert.match(res.message, /no tabs/i);
  assert.equal(requests.length, 0);
});

// --- Analyze / grouping-choice / close-duplicates (TASK 3) -----------------

test('Analyze counts loose and duplicate tabs and makes no helper call', async () => {
  const { dispatch, requests } = installSwChrome({
    webTabs: [
      { id: 1, url: 'https://a.com', groupId: -1 },            // loose
      { id: 2, url: 'https://b.com', groupId: -1 },            // loose
      { id: 3, url: 'https://c.com', groupId: 7 },             // already grouped
      { id: 4, url: 'https://a.com', groupId: -1, lastAccessed: 0 }, // duplicate of 1 (loose)
    ],
  });
  const res = await dispatch({ cmd: 'analyze', windowId: null });
  assert.equal(res.ok, true);
  assert.equal(res.loose, 3);       // tabs 1, 2, 4 are ungrouped
  assert.equal(res.duplicates, 1);  // 4 duplicates 1
  assert.equal(requests.length, 0, 'Analyze never opens the native host');
});

test("the 'Put into my groups' choice runs the grouping in mode 'mine'", async () => {
  const { dispatch, requests } = installSwChrome({
    webTabs: [{ id: 1, url: 'https://a.com', groupId: -1 }, { id: 2, url: 'https://b.com', groupId: -1 }],
  });
  const res = await dispatch({ cmd: 'run', windowId: null, groupMode: 'mine', features: { groupTabs: true, staleTabs: false, importantBookmarks: false, cleanBookmarks: false, organizeBookmarks: false, dupeTabs: false } });
  assert.equal(res.ok, true);
  const groupReq = requests.find((r) => r.task === 'group');
  assert.ok(groupReq, 'a grouping request was made');
  assert.equal(groupReq.payload.mode, 'mine');
});

test("the 'Suggest new groups' choice runs the grouping in mode 'suggest'", async () => {
  const { dispatch, requests } = installSwChrome({
    webTabs: [{ id: 1, url: 'https://a.com', groupId: -1 }, { id: 2, url: 'https://b.com', groupId: -1 }],
  });
  const res = await dispatch({ cmd: 'run', windowId: null, groupMode: 'suggest', features: { groupTabs: true, staleTabs: false, importantBookmarks: false, cleanBookmarks: false, organizeBookmarks: false, dupeTabs: false } });
  assert.equal(res.ok, true);
  const groupReq = requests.find((r) => r.task === 'group');
  assert.ok(groupReq, 'a grouping request was made');
  assert.equal(groupReq.payload.mode, 'suggest');
});

test("Re-sort all groups sends every web tab in scope once, in mode 'mine'", async () => {
  const { dispatch, requests } = installSwChrome({
    webTabs: [
      { id: 1, url: 'https://a.com', groupId: 7 },   // already grouped
      { id: 2, url: 'https://b.com', groupId: -1 },
      { id: 3, url: 'https://c.com', groupId: -1 },
    ],
  });
  const res = await dispatch({ cmd: 'run', windowId: null, regroupAll: true, features: { groupTabs: true, staleTabs: false, importantBookmarks: false, cleanBookmarks: false, organizeBookmarks: false, dupeTabs: false } });
  assert.equal(res.ok, true);
  const groupReqs = requests.filter((r) => r.task === 'group');
  assert.equal(groupReqs.length, 1, 'exactly one grouping request');
  assert.deepEqual(groupReqs[0].payload.tabs.map((t) => t.tabId).sort(), [1, 2, 3]); // grouped + loose
  assert.equal(groupReqs[0].payload.mode, 'mine');
});

test('Close duplicates finds duplicate tabs without any helper call', async () => {
  const { dispatch, requests } = installSwChrome({
    webTabs: [
      { id: 1, url: 'https://a.com', groupId: -1, lastAccessed: 10 },
      { id: 2, url: 'https://a.com', groupId: -1, lastAccessed: 0 }, // duplicate of 1
      { id: 3, url: 'https://b.com', groupId: -1 },
    ],
  });
  const res = await dispatch({ cmd: 'closeDuplicates', windowId: null });
  assert.equal(res.ok, true);
  assert.equal(res.items.length, 1, 'one close item for the duplicate');
  assert.equal(res.items[0].action, 'closeTab');
  assert.equal(res.items[0].data.tabId, 2);
  assert.equal(requests.length, 0, 'Close duplicates never opens the native host');
});

// --- Suggest collections (0.11.0) -----------------------------------------

test('suggestCollections sends the parked groups (not open ones) and the current collection names', async () => {
  const { dispatch, requests } = installSwChrome({
    indexGroups: [
      { name: 'Claude help', status: 'parked', tabs: [{ title: 'Docs', url: 'https://a' }] },
      { name: 'Work', status: 'open', tabs: [] },
      { name: 'Premiere help', status: 'parked', tabs: [] },
    ],
    collections: [{ name: 'Claude', groups: ['Claude help'] }],
  });
  const res = await dispatch({ cmd: 'suggestCollections', current: ['Claude'] });
  assert.equal(res.ok, true);
  assert.deepEqual(res.collections, [{ name: 'Claude', groups: ['Claude help'] }]);
  const req = requests.find((r) => r.task === 'collections');
  assert.ok(req, 'one collections request');
  assert.deepEqual(req.payload.groups.map((g) => g.name), ['Claude help', 'Premiere help']);
  assert.deepEqual(req.payload.current, [{ name: 'Claude', groups: [] }]);
});

test('suggestCollections leaves out groups already in a collection, and skips the AI when none are left', async () => {
  const indexGroups = [
    { name: 'Claude help', status: 'parked', tabs: [] },
    { name: 'Premiere help', status: 'parked', tabs: [] },
  ];
  const one = installSwChrome({ indexGroups, collections: [] });
  await one.dispatch({ cmd: 'suggestCollections', current: [{ name: 'Claude', groups: ['claude help'] }] });
  const req = one.requests.find((r) => r.task === 'collections');
  assert.deepEqual(req.payload.groups.map((g) => g.name), ['Premiere help']);
  assert.deepEqual(req.payload.current, [{ name: 'Claude', groups: ['claude help'] }]);

  const two = installSwChrome({ indexGroups, collections: [] });
  const res = await two.dispatch({ cmd: 'suggestCollections', current: [{ name: 'All', groups: ['Claude help', 'Premiere help'] }] });
  assert.deepEqual(res, { ok: true, collections: [] });
  assert.ok(!two.requests.some((r) => r.task === 'collections'), 'no model call');
});

// --- Suggest new groups for the leftovers (TASK 2) -------------------------

// isSomedayItem matches only groupTabs items named "Someday" (trimmed, case-
// insensitive); everything else — including a Someday close/park item or a
// differently-named group — is left alone.
test('isSomedayItem matches only groupTabs items named Someday (trimmed, case-insensitive)', () => {
  const { isSomedayItem } = sw;
  assert.equal(isSomedayItem({ action: 'groupTabs', data: { groupName: 'Someday' } }), true);
  assert.equal(isSomedayItem({ action: 'groupTabs', data: { groupName: '  someday ' } }), true);
  assert.equal(isSomedayItem({ action: 'groupTabs', data: { groupName: 'SOMEDAY' } }), true);
  assert.equal(isSomedayItem({ action: 'groupTabs', data: { groupName: 'Someday reading' } }), false);
  assert.equal(isSomedayItem({ action: 'closeTab', data: { groupName: 'Someday' } }), false);
  assert.equal(isSomedayItem({ action: 'groupTabs', data: { groupName: 'Work' } }), false);
  assert.equal(isSomedayItem(null), false);
});

test('suggestLeftovers replaces only the Someday items with the newly suggested groups, keeping the rest', async () => {
  const initialPlan = [
    { itemId: 'g-work', action: 'groupTabs', status: 'pending', reason: 'Work', data: { groupName: 'Work', tabIds: [10, 11] } },
    { itemId: 'g-someday', action: 'groupTabs', status: 'pending', reason: 'Someday', data: { groupName: 'Someday', tabIds: [1, 2] } },
    { itemId: 'close-9', action: 'closeTab', status: 'pending', reason: 'dupe', data: { tabId: 9 } },
  ];
  const { dispatch, requests } = installSwChrome({
    // The two leftover tabs the re-sort will look at.
    webTabs: [
      { id: 1, url: 'https://news.com', groupId: -1 },
      { id: 2, url: 'https://sports.com', groupId: -1 },
    ],
    // The model's suggested groups for them (two tabs each is kept by mapGroupResult).
    groups: [{ name: 'News', tabIds: [1, 2] }],
    initialLocal: { currentPlan: initialPlan, currentPlanAt: Date.now() },
  });
  const res = await dispatch({ cmd: 'suggestLeftovers', tabIds: [1, 2] });
  assert.equal(res.ok, true);
  // The grouping ran in 'leftovers' mode (new names only, never Someday) over
  // exactly the two leftover tabs. Plain 'suggest' still sees the groups file's
  // "fits none goes in Someday" rule and sent them straight back (found on
  // Jeff's tabs, 2026-10-15).
  const groupReq = requests.find((r) => r.task === 'group');
  assert.ok(groupReq, 'a grouping request was made');
  assert.equal(groupReq.payload.mode, 'leftovers');
  assert.deepEqual(groupReq.payload.tabs.map((t) => t.tabId).sort(), [1, 2]);
  // The Someday item is gone; Work and the close item are untouched; the new
  // "News" group is in the plan.
  const names = res.items.map((it) => (it.data && it.data.groupName) || it.action);
  assert.ok(names.includes('Work'), 'Work kept');
  assert.ok(res.items.some((it) => it.action === 'closeTab' && it.data.tabId === 9), 'close item kept');
  assert.ok(!res.items.some((it) => sw.isSomedayItem(it)), 'the Someday item is replaced');
  assert.ok(res.items.some((it) => (it.data && it.data.groupName) === 'News'), 'the suggested group is spliced in');
  // The origin is stamped for the result card's From line.
  assert.equal(res.origin.label, 'Suggest new groups for leftovers');
});

test('suggestLeftovers leaves the plan as it was when the grouping fails', async () => {
  const initialPlan = [
    { itemId: 'g-someday', action: 'groupTabs', status: 'pending', reason: 'Someday', data: { groupName: 'Someday', tabIds: [1, 2] } },
    { itemId: 'close-9', action: 'closeTab', status: 'pending', reason: 'dupe', data: { tabId: 9 } },
  ];
  const { dispatch } = installSwChrome({
    webTabs: [{ id: 1, url: 'https://news.com', groupId: -1 }, { id: 2, url: 'https://sports.com', groupId: -1 }],
    groupFails: true,
    initialLocal: { currentPlan: initialPlan, currentPlanAt: Date.now() },
  });
  const res = await dispatch({ cmd: 'suggestLeftovers', tabIds: [1, 2] });
  assert.equal(res.ok, false, 'the handler reports failure');
  // The stored plan is unchanged — the Someday item is still there.
  const { currentPlan } = await chrome.storage.local.get({ currentPlan: [] });
  assert.deepEqual(currentPlan, initialPlan, 'the plan is left exactly as it was on failure');
});

test("the leftovers prompt asks for new names and rules out Someday", async () => {
  const { buildGroupPrompt } = await import('../native-host/prompts.js');
  const p = buildGroupPrompt([{ tabId: 1, title: 'a', url: 'https://a', groupName: '' }], 'MY GROUPS: - Someday: later', { mode: 'leftovers' });
  assert.match(p, /NEW, specific group names/);
  assert.match(p, /Never use Someday/);
  assert.doesNotMatch(buildGroupPrompt([], '', { mode: 'mine' }), /NEW, specific group names/);
});

test('leftovers keep single-tab groups; other modes still drop a lone new group', async () => {
  const { mapGroupResult } = await import('../extension/lib/plan.js');
  const byId = new Map([[1, { tabId: 1, windowId: 9, index: 0, title: 'a', url: 'https://a' }]]);
  const groups = [{ name: 'Blender pipelines', color: 'blue', tabIds: [1] }];
  assert.equal(mapGroupResult(groups, byId, { allowSingles: true }).length, 1);
  assert.equal(mapGroupResult(groups, byId).length, 0);
});
