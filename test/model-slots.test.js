// Two model slots: makeClient(settings, job) attaches the right model per job.
// Big jobs (full Analyze run, typed commands) use bigModel; quick jobs
// (sortSelected, sortGroup, describe) use quickModel. For the claude adapter the
// slot's model is injected as '--model <name>' into the request's cli extraArgs
// (unless the user already set --model); for the openai adapter it becomes
// config.model (falling back to openaiModel when the slot is empty). The harness
// imports the real service worker and inspects the native messages it posts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../extension/lib/storage.js';

function listener() {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), fire: (...args) => fns.map((fn) => fn(...args)), fns };
}

// Boot the worker once with a placeholder chrome so its load-time listener
// registrations don't throw; each test swaps in its own chrome before dispatch.
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

// A chrome mock with the given settings seeded into storage.sync, a fake native
// port that records every posted request, and enough tabs/windows for the run,
// sortSelected and describe paths. `requests` holds the merged outgoing messages.
function installSwChrome(settings = {}) {
  const stored = { local: {}, sync: { settings } };
  const requests = [];
  const area = (name) => ({
    async get(k) { return typeof k === 'string' ? { [k]: stored[name][k] } : (k == null ? { ...stored[name] } : Object.fromEntries(Object.keys(k).map((kk) => [kk, stored[name][kk] ?? k[kk]]))); },
    async set(o) { Object.assign(stored[name], o); },
    async remove(k) { delete stored[name][k]; },
  });
  function makePort() {
    const onMsg = listener();
    const onDisc = listener();
    return {
      onMessage: onMsg, onDisconnect: onDisc,
      postMessage(msg) { requests.push(msg); setTimeout(() => onMsg.fire({ id: msg.id, ok: true, result: { groups: [], stale: [], important: [], moves: [], descriptions: [], ready: true } }), 0); },
      disconnect() {},
    };
  }
  const tabs = [
    { id: 1, url: 'https://a.com', title: 'A', windowId: 1, index: 0, groupId: -1 },
    { id: 2, url: 'https://b.com', title: 'B', windowId: 1, index: 1, groupId: -1 },
  ];
  const chrome = {
    runtime: { id: 'self', lastError: null, connectNative: () => makePort(), getURL: (p) => p },
    storage: { local: area('local'), sync: area('sync') },
    tabs: {
      async query(q) {
        if (q && q.highlighted) return tabs;
        if (q && 'groupId' in q) return tabs;
        return tabs;
      },
    },
    tabGroups: { async get() { return { title: '' }; } },
    windows: { async getLastFocused() { return { id: 1 }; } },
  };
  globalThis.chrome = chrome;
  const dispatch = (message) => new Promise((resolve) => {
    const ret = swOnMessage(message, { id: 'self' }, resolve);
    assert.equal(ret, true);
  });
  return { dispatch, requests };
}

// The cli extraArgs string the host would receive for the first native request.
function firstCliExtraArgs(requests) {
  const req = requests.find((r) => r.cli);
  return req && req.cli.extraArgs;
}
function firstConfigModel(requests) {
  const req = requests.find((r) => r.config);
  return req && req.config.model;
}

test('claude big job (full Analyze run) carries --model <bigModel>', async () => {
  const { dispatch, requests } = installSwChrome({ adapter: 'claude', bigModel: 'big-m', quickModel: 'quick-m' });
  await dispatch({ cmd: 'run' });
  assert.equal(firstCliExtraArgs(requests), '--model big-m');
});

test('claude quick job (sortSelected) carries --model <quickModel>', async () => {
  const { dispatch, requests } = installSwChrome({ adapter: 'claude', bigModel: 'big-m', quickModel: 'quick-m' });
  await dispatch({ cmd: 'sortSelected' });
  assert.equal(firstCliExtraArgs(requests), '--model quick-m');
});

test('claude typed command is a big job and carries --model <bigModel>', async () => {
  const { dispatch, requests } = installSwChrome({ adapter: 'claude', bigModel: 'big-m', quickModel: 'quick-m' });
  await dispatch({ cmd: 'command', instruction: 'tidy up' });
  assert.equal(firstCliExtraArgs(requests), '--model big-m');
});

test('claude describe is a quick job and carries --model <quickModel>', async () => {
  const { dispatch, requests } = installSwChrome({ adapter: 'claude', bigModel: 'big-m', quickModel: 'quick-m' });
  await dispatch({ cmd: 'describe', groups: [{ name: 'G', groupId: 7 }] });
  assert.equal(firstCliExtraArgs(requests), '--model quick-m');
});

test('a user-supplied --model in claude extra flags wins over the slot model', async () => {
  const { dispatch, requests } = installSwChrome({
    adapter: 'claude', bigModel: 'big-m', quickModel: 'quick-m',
    advancedCli: { extraArgs: { claude: '--model user-pick' } },
  });
  await dispatch({ cmd: 'run' });
  assert.equal(firstCliExtraArgs(requests), '--model user-pick'); // slot model NOT appended
});

test('an empty claude slot leaves the extra flags untouched', async () => {
  const { dispatch, requests } = installSwChrome({ adapter: 'claude', bigModel: '', quickModel: 'quick-m' });
  await dispatch({ cmd: 'run' }); // big slot empty
  assert.equal(firstCliExtraArgs(requests), '');
});

test('openai big job sets config.model to bigModel', async () => {
  const { dispatch, requests } = installSwChrome({ adapter: 'openai', bigModel: 'big-oa', quickModel: 'quick-oa', openaiModel: 'fallback' });
  await dispatch({ cmd: 'run' });
  assert.equal(firstConfigModel(requests), 'big-oa');
});

test('openai quick job sets config.model to quickModel', async () => {
  const { dispatch, requests } = installSwChrome({ adapter: 'openai', bigModel: 'big-oa', quickModel: 'quick-oa', openaiModel: 'fallback' });
  await dispatch({ cmd: 'sortSelected' });
  assert.equal(firstConfigModel(requests), 'quick-oa');
});

test('openai empty slot falls back to the configured openaiModel', async () => {
  const { dispatch, requests } = installSwChrome({ adapter: 'openai', bigModel: '', quickModel: '', openaiModel: 'fallback' });
  await dispatch({ cmd: 'run' });
  assert.equal(firstConfigModel(requests), 'fallback');
});

test('fresh-install defaults: slot models and the new feature set', () => {
  assert.equal(DEFAULTS.bigModel, 'claude-sonnet-5-5');
  assert.equal(DEFAULTS.quickModel, 'claude-haiku-4-5');
  assert.equal(DEFAULTS.regroupExisting, true); // top-level, not an enabledFeatures key
  assert.deepEqual(DEFAULTS.enabledFeatures, {
    groupTabs: true, dupeTabs: true, staleTabs: false,
    importantBookmarks: false, cleanBookmarks: false, organizeBookmarks: false, deadLinkScan: false,
  });
});
