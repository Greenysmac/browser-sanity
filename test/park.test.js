import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parkGroup, openParked } from '../extension/lib/park.js';

// A fake chrome.* that tracks created/removed/grouped tabs and group updates.
// tabs.query({ groupId }) returns the tabs belonging to that group; tabGroups.get
// looks a group up by id.
function fakeChrome({ group = {}, groupTabs = [], failRemove = false } = {}) {
  let nextId = 1000;
  const removed = [];
  const created = [];
  const grouped = [];
  const groupUpdates = [];
  return {
    _removed: removed,
    _created: created,
    _grouped: grouped,
    _groupUpdates: groupUpdates,
    tabs: {
      async query() { return groupTabs; },
      async create(opts) { const t = { id: nextId++, ...opts }; created.push(t); return t; },
      async remove(ids) { if (failRemove) throw new Error('remove failed'); removed.push(...(Array.isArray(ids) ? ids : [ids])); },
      async group({ tabIds }) { const id = nextId++; grouped.push({ tabIds, groupId: id }); return id; },
    },
    tabGroups: {
      async get() { if (!group) throw new Error('no group'); return group; },
      async update(id, opts) { groupUpdates.push({ id, ...opts }); },
      async query() { return []; },
    },
  };
}

function fakeClient(responder) {
  const sent = [];
  return {
    _sent: sent,
    async request(msg) { sent.push(msg); return responder ? responder(msg) : { ok: true }; },
  };
}

test('parkGroup sends park then closes the group\'s http(s) tabs', async () => {
  const chromeApi = fakeChrome({
    group: { title: 'Work', color: 'blue' },
    groupTabs: [
      { id: 1, url: 'https://a', title: 'A' },
      { id: 2, url: 'https://b', title: 'B' },
      { id: 3, url: 'chrome://settings', title: 'S' }, // skipped
    ],
  });
  const client = fakeClient(() => ({ ok: true }));
  const res = await parkGroup({ chromeApi, nativeClient: client, groupId: 42 });
  assert.equal(res.ok, true);
  assert.equal(client._sent.length, 1);
  assert.equal(client._sent[0].type, 'park');
  assert.deepEqual(client._sent[0].payload.group, {
    name: 'Work', color: 'blue', tabs: [{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }],
  });
  // Only the http(s) tabs are closed.
  assert.deepEqual(chromeApi._removed, [1, 2]);
});

test('parkGroup closes nothing when the helper fails', async () => {
  const chromeApi = fakeChrome({
    group: { title: 'Work', color: 'blue' },
    groupTabs: [{ id: 1, url: 'https://a', title: 'A' }],
  });
  const client = fakeClient(() => ({ ok: false, error: 'host down' }));
  await assert.rejects(() => parkGroup({ chromeApi, nativeClient: client, groupId: 42 }), /host down/);
  assert.deepEqual(chromeApi._removed, []); // nothing closed
});

test('openParked recreates tabs, group, title and color from the index', async () => {
  const chromeApi = fakeChrome({});
  const client = fakeClient((msg) => {
    if (msg.type === 'index-read') {
      return { groups: [{ name: 'Work', color: 'red', status: 'parked', tabs: [{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }] }], ungrouped: [] };
    }
    return { ok: true, groups: 1 }; // the index sync
  });
  const res = await openParked({ chromeApi, nativeClient: client, name: 'Work', windowId: 7 });
  assert.deepEqual(res, { ok: true, opened: 2 });
  // Tabs recreated in order, in the target window, inactive.
  assert.deepEqual(chromeApi._created.map((t) => ({ windowId: t.windowId, url: t.url, active: t.active })), [
    { windowId: 7, url: 'https://a', active: false },
    { windowId: 7, url: 'https://b', active: false },
  ]);
  // Grouped together, then titled and colored.
  assert.equal(chromeApi._grouped.length, 1);
  assert.deepEqual(chromeApi._groupUpdates, [{ id: chromeApi._grouped[0].groupId, title: 'Work', color: 'red' }]);
  // Index synced afterwards so the group shows as open.
  assert.ok(client._sent.some((m) => m.type === 'index'));
});

test('openParked matches the parked name trimmed and case-insensitively', async () => {
  const chromeApi = fakeChrome({});
  const client = fakeClient((msg) => (msg.type === 'index-read'
    ? { groups: [{ name: 'Work', color: 'green', tabs: [{ title: 'A', url: 'https://a' }] }], ungrouped: [] }
    : { ok: true }));
  const res = await openParked({ chromeApi, nativeClient: client, name: '  work  ', windowId: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.opened, 1);
});

test('openParked falls back to grey for an unknown color', async () => {
  const chromeApi = fakeChrome({});
  const client = fakeClient((msg) => (msg.type === 'index-read'
    ? { groups: [{ name: 'Work', color: 'chartreuse', tabs: [{ title: 'A', url: 'https://a' }] }], ungrouped: [] }
    : { ok: true }));
  await openParked({ chromeApi, nativeClient: client, name: 'Work', windowId: 1 });
  assert.equal(chromeApi._groupUpdates[0].color, 'grey');
});

test('openParked returns an error result for an unknown name without throwing', async () => {
  const chromeApi = fakeChrome({});
  const client = fakeClient((msg) => (msg.type === 'index-read' ? { groups: [{ name: 'Other', tabs: [] }], ungrouped: [] } : { ok: true }));
  const res = await openParked({ chromeApi, nativeClient: client, name: 'Missing', windowId: 1 });
  assert.equal(res.ok, false);
  assert.match(res.error, /Missing/);
  assert.deepEqual(chromeApi._created, []); // nothing opened
});
