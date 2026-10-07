import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndexPayload, syncIndex } from '../extension/lib/index-sync.js';

// A fake chrome.* with a fixed list of tabs and tab groups. tabs.query({})
// returns them in the order given (window + tab order, as Chrome does), and
// tabGroups.get looks a group up by id, counting calls so we can assert the
// "once per group" caching.
function fakeChrome(tabs, groups = {}) {
  const getCalls = [];
  return {
    _getCalls: getCalls,
    tabs: { async query() { return tabs; } },
    tabGroups: {
      async get(id) {
        getCalls.push(id);
        if (!(id in groups)) throw new Error('no such group');
        return groups[id];
      },
    },
  };
}

function fakeClient(responder) {
  const sent = [];
  return {
    _sent: sent,
    async request(msg) { sent.push(msg); return responder ? responder(msg) : { ok: true, groups: 0 }; },
  };
}

test('buildIndexPayload groups tabs by group, in window + tab order', async () => {
  const chromeApi = fakeChrome(
    [
      { id: 1, windowId: 10, groupId: 100, title: 'Docs', url: 'https://docs' },
      { id: 2, windowId: 10, groupId: 100, title: 'API', url: 'https://api' },
      { id: 3, windowId: 10, groupId: -1, title: 'Loose', url: 'https://loose' },
      { id: 4, windowId: 11, groupId: 200, title: 'Play', url: 'https://play' },
    ],
    {
      100: { title: 'Work', color: 'blue' },
      200: { title: 'Fun', color: 'red' },
    },
  );
  const payload = await buildIndexPayload(chromeApi);
  assert.deepEqual(payload.groups, [
    { name: 'Work', color: 'blue', windowId: 10, tabs: [{ title: 'Docs', url: 'https://docs' }, { title: 'API', url: 'https://api' }] },
    { name: 'Fun', color: 'red', windowId: 11, tabs: [{ title: 'Play', url: 'https://play' }] },
  ]);
  assert.deepEqual(payload.ungrouped, [{ title: 'Loose', url: 'https://loose' }]);
  // tabGroups.get is called once per distinct group, not once per tab.
  assert.deepEqual(chromeApi._getCalls, [100, 200]);
});

test('buildIndexPayload skips non-http(s) tabs', async () => {
  const chromeApi = fakeChrome(
    [
      { id: 1, windowId: 1, groupId: 1, title: 'Keep', url: 'https://keep' },
      { id: 2, windowId: 1, groupId: 1, title: 'Settings', url: 'chrome://settings' },
      { id: 3, windowId: 1, groupId: -1, title: 'File', url: 'file:///tmp/x' },
      { id: 4, windowId: 1, groupId: -1, title: 'Site', url: 'http://site' },
    ],
    { 1: { title: 'G', color: 'green' } },
  );
  const payload = await buildIndexPayload(chromeApi);
  assert.deepEqual(payload.groups, [
    { name: 'G', color: 'green', windowId: 1, tabs: [{ title: 'Keep', url: 'https://keep' }] },
  ]);
  assert.deepEqual(payload.ungrouped, [{ title: 'Site', url: 'http://site' }]);
});

test('buildIndexPayload falls back to an empty name when the group lookup fails', async () => {
  const chromeApi = fakeChrome(
    [{ id: 1, windowId: 1, groupId: 99, title: 'T', url: 'https://t' }],
    {}, // no group 99 — tabGroups.get throws
  );
  const payload = await buildIndexPayload(chromeApi);
  assert.deepEqual(payload.groups, [
    { name: '', color: undefined, windowId: 1, tabs: [{ title: 'T', url: 'https://t' }] },
  ]);
  assert.deepEqual(payload.ungrouped, []);
});

test('syncIndex sends an index message with the payload and returns the host reply', async () => {
  const chromeApi = fakeChrome(
    [{ id: 1, windowId: 1, groupId: 1, title: 'T', url: 'https://t' }],
    { 1: { title: 'G', color: 'blue' } },
  );
  const client = fakeClient(() => ({ ok: true, groups: 1 }));
  const res = await syncIndex({ chromeApi, nativeClient: client });
  assert.deepEqual(res, { ok: true, groups: 1 });
  assert.equal(client._sent.length, 1);
  assert.equal(client._sent[0].type, 'index');
  assert.deepEqual(client._sent[0].payload.groups, [
    { name: 'G', color: 'blue', windowId: 1, tabs: [{ title: 'T', url: 'https://t' }] },
  ]);
});

test('syncIndex never throws and returns { ok: false } on error', async () => {
  const chromeApi = fakeChrome([{ id: 1, windowId: 1, groupId: 1, title: 'T', url: 'https://t' }], { 1: { title: 'G' } });
  const client = { async request() { throw new Error('host down'); } };
  const res = await syncIndex({ chromeApi, nativeClient: client });
  assert.deepEqual(res, { ok: false });
});

test('syncIndex returns { ok: false } when the client reply is empty', async () => {
  const chromeApi = fakeChrome([], {});
  const client = fakeClient(() => undefined);
  const res = await syncIndex({ chromeApi, nativeClient: client });
  assert.deepEqual(res, { ok: false });
});
