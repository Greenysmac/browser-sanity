// TASK 1 — a new Analyze clears the old suggestions, and getPlan never serves a
// stale plan. Covers the service-worker side:
//   1. Analyze empties the stored plan (currentPlan -> []) and stamps it.
//   2. getPlan on a plan older than 6h returns [] and clears the store.
//   3. getPlan drops groupTabs/closeTab/parkTab/discardTab items whose tabs are
//      all gone (chrome.tabs.get fails), keeping the live ones.
//   4. getPlan leaves a fresh plan of still-open tabs untouched.
// Driven with a hand-rolled chrome mock and the worker's registered onMessage
// listener, matching the sort-tabs suite's approach (no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';

function listener() {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), fire: (...args) => fns.map((fn) => fn(...args)), fns };
}

// A placeholder chrome so the worker's load-time listener registrations don't
// throw; each test swaps in its own mock before dispatching.
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
const swOnMessage = bootOnMessage.fns[0];

// Install a chrome whose local storage starts with the given values, whose
// tabs.query({}) returns `openTabs`, and whose tabs.get resolves for the ids in
// `openTabs` and rejects otherwise (a vanished tab).
function installChrome({ local = {}, openTabs = [] } = {}) {
  const stored = { local: { ...local }, sync: {} };
  const liveIds = new Set(openTabs.map((t) => t.id));
  const area = (name) => ({
    async get(k) {
      if (typeof k === 'string') return { [k]: stored[name][k] };
      if (k == null) return { ...stored[name] };
      return Object.fromEntries(Object.keys(k).map((kk) => [kk, stored[name][kk] ?? k[kk]]));
    },
    async set(o) { Object.assign(stored[name], o); },
    async remove(k) { delete stored[name][k]; },
  });
  const chrome = {
    runtime: { id: 'self', lastError: null },
    storage: { local: area('local'), sync: area('sync') },
    tabs: {
      async query() { return openTabs; },
      async get(id) { if (liveIds.has(id)) return { id }; throw new Error('No tab with id'); },
    },
  };
  globalThis.chrome = chrome;
  const dispatch = (message) => new Promise((resolve) => {
    const ret = swOnMessage(message, { id: 'self' }, resolve);
    assert.equal(ret, true);
  });
  return { dispatch, stored };
}

const HOUR = 60 * 60 * 1000;

test('Analyze empties the stored plan and stamps when it was cleared', async () => {
  const { dispatch, stored } = installChrome({
    local: { currentPlan: [{ itemId: 'old', action: 'groupTabs', data: { tabIds: [1, 2] } }], currentPlanAt: Date.now() - HOUR },
    openTabs: [{ id: 1, url: 'https://a.com', groupId: -1 }, { id: 2, url: 'https://b.com', groupId: -1 }],
  });
  const res = await dispatch({ cmd: 'analyze', windowId: null });
  assert.equal(res.ok, true);
  assert.deepEqual(stored.local.currentPlan, [], 'the old plan is cleared');
  assert.ok(stored.local.currentPlanAt > 0, 'a fresh timestamp is written');
});

test('getPlan on a plan older than 6 hours returns empty and clears the store', async () => {
  const { dispatch, stored } = installChrome({
    local: {
      currentPlan: [{ itemId: 'close-1', action: 'closeTab', data: { tabId: 1 } }],
      currentPlanAt: Date.now() - 7 * HOUR,
    },
    openTabs: [{ id: 1 }],
  });
  const res = await dispatch({ cmd: 'getPlan' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.items, [], 'a stale plan comes back empty');
  assert.deepEqual(stored.local.currentPlan, [], 'the stale plan is cleared from storage');
});

test('getPlan drops items whose tabs have vanished and keeps the live ones', async () => {
  const { dispatch, stored } = installChrome({
    local: {
      currentPlan: [
        { itemId: 'close-1', action: 'closeTab', data: { tabId: 1 } },     // tab 1 gone
        { itemId: 'park-2', action: 'parkTab', data: { tabId: 2 } },       // tab 2 live
        { itemId: 'discard-3', action: 'discardTab', data: { tabId: 3 } }, // tab 3 gone
        { itemId: 'group-a', action: 'groupTabs', data: { tabIds: [1, 3] } },   // both gone -> drop
        { itemId: 'group-b', action: 'groupTabs', data: { tabIds: [1, 2] } },   // one live -> keep
        { itemId: 'bm', action: 'removeBookmark', data: { id: 'x' } },     // no tab -> keep
      ],
      currentPlanAt: Date.now() - HOUR,
    },
    openTabs: [{ id: 2 }],
  });
  const res = await dispatch({ cmd: 'getPlan' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.items.map((i) => i.itemId), ['park-2', 'group-b', 'bm']);
  assert.deepEqual(stored.local.currentPlan.map((i) => i.itemId), ['park-2', 'group-b', 'bm'], 'the pruned plan is written back');
});

test('getPlan leaves a fresh plan of still-open tabs untouched', async () => {
  const plan = [
    { itemId: 'close-1', action: 'closeTab', data: { tabId: 1 } },
    { itemId: 'group-a', action: 'groupTabs', data: { tabIds: [1, 2] } },
  ];
  const at = Date.now() - HOUR;
  const { dispatch, stored } = installChrome({
    local: { currentPlan: plan, currentPlanAt: at },
    openTabs: [{ id: 1 }, { id: 2 }],
  });
  const res = await dispatch({ cmd: 'getPlan' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.items.map((i) => i.itemId), ['close-1', 'group-a']);
  assert.equal(stored.local.currentPlanAt, at, 'a fresh, all-live plan is not rewritten');
});
