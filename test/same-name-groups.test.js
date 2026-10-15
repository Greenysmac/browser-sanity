// An open group named like a parked group is one group, part live and part
// saved. A new live "Claude skills and plugins" (3 tabs) used to replace the
// parked record of that name (24 tabs) on the next index sync, dropping the
// parked tabs (2026-10-14). Now the parked half rides along as parkedTabs and
// comes back whole when the group is parked or closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeIndex, readIndex, parkGroup } from '../native-host/index-file.js';
import { openParked } from '../extension/lib/park.js';

const T = (n) => ({ title: `t${n}`, url: `https://e.com/${n}` });
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => T(a + i));

function tmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-same-'));
  return { BROWSER_SANITY_INDEX_DIR: dir };
}
function seedParked(env, name, tabs) {
  fs.writeFileSync(path.join(env.BROWSER_SANITY_INDEX_DIR, 'index.json'),
    JSON.stringify({ updated: 'x', groups: [{ name, tabs, status: 'parked', lastSeen: '2026-10-11T00:00:00Z' }], ungrouped: [] }));
}
const entry = (env, name) => readIndex({ env }).groups.find((g) => g.name === name);

test('a live group named like a parked one keeps the parked tabs as parkedTabs', () => {
  const env = tmpEnv();
  seedParked(env, 'Claude skills and plugins', range(1, 24));
  writeIndex({ groups: [{ name: 'Claude skills and plugins', tabs: [T(1), T(30), T(31)] }] }, { env });
  const g = entry(env, 'Claude skills and plugins');
  assert.equal(g.status, 'open');
  assert.deepEqual(g.tabs.map((t) => t.url), [T(1), T(30), T(31)].map((t) => t.url));
  assert.equal(g.parkedTabs.length, 23, 'the 23 parked tabs not open stay saved');
  // A second sync keeps them.
  writeIndex({ groups: [{ name: 'Claude skills and plugins', tabs: [T(30), T(31)] }] }, { env });
  assert.equal(entry(env, 'Claude skills and plugins').parkedTabs.length, 23);
});

test('when the live half closes, the group is parked whole again', () => {
  const env = tmpEnv();
  seedParked(env, 'X', range(1, 5));
  writeIndex({ groups: [{ name: 'X', tabs: [T(9)] }] }, { env });
  writeIndex({ groups: [] }, { env });
  const g = entry(env, 'X');
  assert.equal(g.status, 'parked');
  assert.equal(g.tabs.length, 6);
  assert.equal(g.parkedTabs, undefined);
});

test('parking the live half folds the saved half back in', () => {
  const env = tmpEnv();
  seedParked(env, 'X', range(1, 5));
  writeIndex({ groups: [{ name: 'X', tabs: [T(9)] }] }, { env });
  parkGroup({ name: 'X', tabs: [T(9), T(10)] }, { env });
  const g = entry(env, 'X');
  assert.equal(g.status, 'parked');
  assert.deepEqual(g.tabs.map((t) => t.url).sort(), [...range(1, 5), T(9), T(10)].map((t) => t.url).sort());
});

test('an ordinary open group never resurrects tabs closed in it', () => {
  const env = tmpEnv();
  writeIndex({ groups: [{ name: 'Work', tabs: [T(1), T(2)] }] }, { env });
  writeIndex({ groups: [{ name: 'Work', tabs: [T(2)] }] }, { env });
  const g = entry(env, 'Work');
  assert.deepEqual(g.tabs.map((t) => t.url), [T(2).url]);
  assert.equal(g.parkedTabs, undefined);
});

test('Add back on an open group opens only its saved half, into that group', async () => {
  const created = [];
  const grouped = [];
  const chromeApi = {
    tabs: { create: async ({ url }) => { created.push(url); return { id: created.length }; }, group: async (o) => { grouped.push(o); return 1; }, query: async () => [] },
    tabGroups: { update: async () => {}, query: async () => [] },
  };
  const nativeClient = { request: async (m) => (m.type === 'index-read'
    ? { groups: [{ name: 'X', status: 'open', tabs: [T(9)], parkedTabs: [T(1), T(2)] }] }
    : { ok: true }) };
  const res = await openParked({ chromeApi, nativeClient, name: 'X', groupId: 42 });
  assert.equal(res.ok, true);
  assert.deepEqual(created, [T(1).url, T(2).url]);
  assert.equal(grouped[0].groupId, 42);
});

test('the board offers an open group\'s saved half as its parked twin', () => {
  const src = fs.readFileSync(new URL('../extension/background/service-worker.js', import.meta.url), 'utf8');
  assert.match(src, /g\.status === 'open' && Array\.isArray\(g\.parkedTabs\)/);
});
