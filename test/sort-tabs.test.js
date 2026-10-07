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

function installSwChrome({ groupTabs = {}, highlighted = [], webTabs = null } = {}) {
  const stored = { local: {}, sync: {} };
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
  // Fake native port: on each posted request, reply ok with empty groups.
  function makePort() {
    const onMsg = listener();
    const onDisc = listener();
    return {
      onMessage: onMsg, onDisconnect: onDisc,
      postMessage(msg) { requests.push(msg); setTimeout(() => onMsg.fire({ id: msg.id, ok: true, result: { groups: [], stale: [], important: [], moves: [], ready: true } }), 0); },
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
