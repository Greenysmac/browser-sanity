// No leftovers (Jeff, 2026-10-11: "On restart/new run, there shouldn't be any
// leftover"). A browser restart (onStartup) or an extension reload/update
// (onInstalled) clears the stored plan, split proposal and re-analyze flag, and
// a stored split proposal is served only within two minutes of being made.
// Driven with a hand-rolled chrome mock and the worker's registered listeners.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function listener() {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), fns };
}

const onMessage = listener();
const onInstalled = listener();
const onStartup = listener();
const noop = listener();
globalThis.chrome = {
  runtime: { id: 'self', onConnect: noop, onInstalled, onStartup, onMessage },
  action: { onClicked: noop }, alarms: { onAlarm: noop, async create() {} },
  commands: { onCommand: noop }, omnibox: { onInputEntered: noop },
  notifications: { onClicked: noop }, storage: { onChanged: noop },
  tabs: { onActivated: noop, onUpdated: noop, onRemoved: noop },
};
await import('../extension/background/service-worker.js');

function installChrome(local) {
  const stored = { local: { ...local }, sync: {} };
  const area = (name) => ({
    async get(k) {
      if (typeof k === 'string') return { [k]: stored[name][k] };
      if (k == null) return { ...stored[name] };
      return Object.fromEntries(Object.keys(k).map((kk) => [kk, stored[name][kk] ?? k[kk]]));
    },
    async set(o) { Object.assign(stored[name], o); },
    async remove(k) { for (const key of [].concat(k)) delete stored[name][key]; },
  });
  globalThis.chrome = {
    runtime: { id: 'self', lastError: null },
    storage: { local: area('local'), sync: area('sync') },
    alarms: { async create() {} },
    tabs: { async query() { return []; } },
  };
  return stored;
}

const LEFTOVERS = {
  currentPlan: [{ itemId: 'a', type: 'groupTabs' }],
  currentPlanAt: Date.now(),
  splitProposal: { kind: 'parked', name: 'Someday', subGroups: [], createdAt: Date.now() },
  pendingReanalyze: Date.now(),
  settings: { adapter: 'claude' },
};

test('an extension reload or update clears every stored suggestion', async () => {
  const stored = installChrome(LEFTOVERS);
  await Promise.all(onInstalled.fns.map((fn) => fn({ reason: 'update' })));
  for (const k of ['currentPlan', 'currentPlanAt', 'splitProposal', 'pendingReanalyze']) {
    assert.equal(stored.local[k], undefined, `${k} cleared`);
  }
});

test('a browser restart clears every stored suggestion', async () => {
  const stored = installChrome(LEFTOVERS);
  await Promise.all(onStartup.fns.map((fn) => fn()));
  for (const k of ['currentPlan', 'currentPlanAt', 'splitProposal', 'pendingReanalyze']) {
    assert.equal(stored.local[k], undefined, `${k} cleared`);
  }
});

const ask = (message) => new Promise((resolve) => {
  for (const fn of onMessage.fns) fn(message, { id: 'self' }, resolve);
});

test('a fresh split proposal is served for the new-tab hand-off', async () => {
  installChrome({ splitProposal: { name: 'Someday', createdAt: Date.now() - 30 * 1000 } });
  const res = await ask({ cmd: 'getSplitProposal' });
  assert.equal(res.proposal && res.proposal.name, 'Someday');
});

test('an old or undated split proposal is dropped, not shown', async () => {
  let stored = installChrome({ splitProposal: { name: 'Someday', createdAt: Date.now() - 10 * 60 * 1000 } });
  assert.equal((await ask({ cmd: 'getSplitProposal' })).proposal, null);
  assert.equal(stored.local.splitProposal, undefined);
  stored = installChrome({ splitProposal: { name: 'Someday' } });
  assert.equal((await ask({ cmd: 'getSplitProposal' })).proposal, null);
  assert.equal(stored.local.splitProposal, undefined);
});

test('the worker never uses import(), which Chrome refuses in a service worker', () => {
  const src = fs.readFileSync(new URL('../extension/background/service-worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /await import\(/);
});

test('the panel drops the stored split proposal once it shows one', () => {
  const src = fs.readFileSync(new URL('../extension/sidepanel/sidepanel.js', import.meta.url), 'utf8');
  assert.match(src, /showSplitProposal\(\{[^}]*\}\);\s*send\(\{ cmd: 'clearSplitProposal' \}\);/);
});
