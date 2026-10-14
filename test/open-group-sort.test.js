// "Put into my groups" returned nothing whenever the window already had an open
// group: the orchestrator passes each window's open-group names as a Set, and
// mapGroupResult called .map on it. The error was swallowed, so the panel said
// "Nothing to do" with 27 loose tabs on screen (found 2026-10-13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapGroupResult } from '../extension/lib/plan.js';
import { buildPlan } from '../extension/lib/orchestrator.js';

const tab = (tabId, groupId = -1) => ({ tabId, windowId: 9, index: tabId, title: `t${tabId}`, url: `https://e.com/${tabId}`, groupId, groupName: groupId === -1 ? '' : 'Claude skills and plugins' });

test('mapGroupResult takes a Set of open-group names per window (the real shape)', () => {
  const byId = new Map([[1, tab(1)], [2, tab(2)], [3, tab(3)]]);
  const items = mapGroupResult(
    [{ name: 'Claude skills and plugins', color: 'purple', tabIds: [1] }, { name: 'Reddit moderation', color: 'orange', tabIds: [2, 3] }],
    byId,
    { openNamesByWindow: new Map([[9, new Set(['Claude skills and plugins'])]]), parkedNames: ['Reddit moderation'] },
  );
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.data.groupName), ['Claude skills and plugins', 'Reddit moderation']);
  assert.equal(items[0].data.parkedMatch, undefined, 'joins the open group');
  assert.equal(items[1].data.parkedMatch, true, 'parked name, no open group: live group flagged parkedMatch');
});

function fakeChrome(tabs) {
  const store = {};
  return {
    tabs: { query: async () => tabs.map((t) => ({ id: t.tabId, windowId: t.windowId, index: t.index, title: t.title, url: t.url, groupId: t.groupId })) },
    tabGroups: { get: async () => ({ title: 'Claude skills and plugins' }) },
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } },
  };
}

const SETTINGS = { enabledFeatures: { groupTabs: true }, decisions: {}, adapter: 'claude', staleTabDays: 14 };
const FEATURES = { groupTabs: true, staleTabs: false, importantBookmarks: false, cleanBookmarks: false, organizeBookmarks: false, dupeTabs: false };

test('buildPlan sorts loose tabs when the window already has an open group', async () => {
  const tabs = [tab(1, 77), tab(2), tab(3), tab(4)];
  const nativeClient = { request: async (m) => (m.type === 'index-read'
    ? { groups: [{ name: 'Reddit moderation', status: 'parked' }] }
    : { groups: [{ name: 'Claude skills and plugins', color: 'purple', tabIds: [2] }, { name: 'Reddit moderation', color: 'orange', tabIds: [3, 4] }] }) };
  const items = await buildPlan({ settings: SETTINGS, nativeClient, chromeApi: fakeChrome(tabs), windowId: 9, groupMode: 'mine', features: FEATURES });
  assert.deepEqual(items.filter((i) => i.action === 'groupTabs').map((i) => i.data.groupName).sort(), ['Claude skills and plugins', 'Reddit moderation']);
});

test('a failed grouping phase is reported as a warning, not "nothing to do"', async () => {
  const warnings = [];
  const nativeClient = { request: async (m) => { if (m.type === 'index-read') return { groups: [] }; throw new Error('model timed out'); } };
  const items = await buildPlan({ settings: SETTINGS, nativeClient, chromeApi: fakeChrome([tab(2), tab(3)]), windowId: 9, groupMode: 'mine', features: FEATURES, onWarning: (w) => warnings.push(w) });
  assert.equal(items.length, 0);
  assert.deepEqual(warnings, ["Couldn't sort your tabs: model timed out"]);
});
