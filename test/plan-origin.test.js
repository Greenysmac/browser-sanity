// TASK 4 — every suggestion card says what made it and when. Covers:
//   1. originLine formats "From <label>, <time>" (and clears to '' with no origin);
//   2. the service worker stamps a currentPlanOrigin whenever it writes the plan,
//      returns it from getPlan, and clears it when the plan is cleared/pruned;
//   3. the result card (main-panel), re-analyze card (tidy-view) and split card
//      (split-view) each render their From line from a given origin.
// Driven with the same hand-rolled chrome / fake-DOM harnesses the sibling
// suites use (no browser, no jsdom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originLine } from '../extension/sidepanel/viewmodel.js';
import { showTidyProposal } from '../extension/sidepanel/tidy-view.js';
import { showSplitProposal } from '../extension/sidepanel/split-view.js';

// A fixed instant so the formatted time is deterministic across machines.
const AT = new Date('2026-10-11T09:40:00').getTime();
const TIME = new Date(AT).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// ---- 1. originLine ----------------------------------------------------------

test('originLine formats "From <label>, <time>" from a { label, at }', () => {
  assert.equal(originLine({ label: 'Analyze: Put into my groups', at: AT }), `From Analyze: Put into my groups, ${TIME}`);
});

test('originLine is empty with no origin, no label, and omits the comma with no time', () => {
  assert.equal(originLine(null), '');
  assert.equal(originLine({ at: AT }), '', 'no label → nothing');
  assert.equal(originLine({ label: 'Command' }), 'From Command', 'no time → no trailing comma');
});

// ---- 2. service worker: origin stored, returned, and cleared ----------------

function listener() {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), fire: (...args) => fns.map((fn) => fn(...args)), fns };
}

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
    async remove(k) { for (const kk of (Array.isArray(k) ? k : [k])) delete stored[name][kk]; },
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

test('getPlan returns the stored origin alongside the items', async () => {
  const origin = { label: 'Analyze: Put into my groups', at: AT };
  const { dispatch } = installChrome({
    local: {
      currentPlan: [{ itemId: 'group-a', action: 'groupTabs', data: { tabIds: [1, 2] } }],
      currentPlanAt: Date.now() - HOUR,
      currentPlanOrigin: origin,
    },
    openTabs: [{ id: 1 }, { id: 2 }],
  });
  const res = await dispatch({ cmd: 'getPlan' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.origin, origin, 'the origin rides back with the plan');
});

test('getPlan clears the origin when a stale plan is dropped', async () => {
  const { dispatch, stored } = installChrome({
    local: {
      currentPlan: [{ itemId: 'close-1', action: 'closeTab', data: { tabId: 1 } }],
      currentPlanAt: Date.now() - 7 * HOUR,
      currentPlanOrigin: { label: 'Command', at: AT },
    },
    openTabs: [{ id: 1 }],
  });
  const res = await dispatch({ cmd: 'getPlan' });
  assert.equal(res.origin, null, 'a stale plan serves no origin');
  assert.equal(stored.local.currentPlanOrigin, null, 'the origin is cleared from storage');
});

test('getPlan clears the origin when pruning empties the plan', async () => {
  const { dispatch, stored } = installChrome({
    local: {
      currentPlan: [{ itemId: 'close-1', action: 'closeTab', data: { tabId: 1 } }], // tab gone
      currentPlanAt: Date.now() - HOUR,
      currentPlanOrigin: { label: 'Close duplicates', at: AT },
    },
    openTabs: [],
  });
  const res = await dispatch({ cmd: 'getPlan' });
  assert.deepEqual(res.items, [], 'the dead item is pruned');
  assert.equal(res.origin, null, 'pruning away the last item drops the origin');
  assert.equal(stored.local.currentPlanOrigin, null);
});

test('getPlan keeps the origin when pruning leaves some items', async () => {
  const origin = { label: 'Re-sort all groups', at: AT };
  const { dispatch } = installChrome({
    local: {
      currentPlan: [
        { itemId: 'close-1', action: 'closeTab', data: { tabId: 1 } }, // gone
        { itemId: 'group-b', action: 'groupTabs', data: { tabIds: [2] } }, // live
      ],
      currentPlanAt: Date.now() - HOUR,
      currentPlanOrigin: origin,
    },
    openTabs: [{ id: 2 }],
  });
  const res = await dispatch({ cmd: 'getPlan' });
  assert.deepEqual(res.items.map((i) => i.itemId), ['group-b']);
  assert.deepEqual(res.origin, origin, 'a surviving plan keeps its origin');
});

test('analyze clears both the plan and its origin', async () => {
  const { dispatch, stored } = installChrome({
    local: {
      currentPlan: [{ itemId: 'old', action: 'groupTabs', data: { tabIds: [1] } }],
      currentPlanAt: Date.now() - HOUR,
      currentPlanOrigin: { label: 'Command', at: AT },
    },
    openTabs: [{ id: 1, url: 'https://a.com', groupId: -1 }],
  });
  await dispatch({ cmd: 'analyze', windowId: null });
  assert.deepEqual(stored.local.currentPlan, []);
  assert.equal(stored.local.currentPlanOrigin, null, 'a fresh Analyze leaves no origin behind');
});

test('updatePlan keeps the existing origin while items remain and clears it when emptied', async () => {
  const origin = { label: 'Analyze: Suggest new groups', at: AT };
  const { dispatch, stored } = installChrome({
    local: {
      currentPlan: [{ itemId: 'a', action: 'groupTabs', data: { tabIds: [1, 2] } }],
      currentPlanAt: Date.now() - HOUR,
      currentPlanOrigin: origin,
    },
    openTabs: [{ id: 1 }, { id: 2 }],
  });
  await dispatch({ cmd: 'updatePlan', items: [{ itemId: 'a', action: 'groupTabs', data: { tabIds: [1] } }] });
  assert.deepEqual(stored.local.currentPlanOrigin, origin, 'editing the plan keeps what made it');
  await dispatch({ cmd: 'updatePlan', items: [] });
  assert.equal(stored.local.currentPlanOrigin, null, 'clearing the list clears the origin');
});

test('splitGroup stamps the proposal origin — board menu vs. the re-analyze card', async () => {
  // A fake-port chrome whose host answers index-read + organize/split.
  const stored = { local: {}, sync: {} };
  const area = (name) => ({
    async get(k) { return typeof k === 'string' ? { [k]: stored[name][k] } : (k == null ? { ...stored[name] } : Object.fromEntries(Object.keys(k).map((kk) => [kk, stored[name][kk] ?? k[kk]]))); },
    async set(o) { Object.assign(stored[name], o); },
    async remove(k) { for (const kk of (Array.isArray(k) ? k : [k])) delete stored[name][kk]; },
  });
  function makePort() {
    const onMsg = listener();
    return {
      onMessage: onMsg, onDisconnect: listener(),
      postMessage(msg) {
        let result = { ok: true };
        if (msg.type === 'organize' && msg.task === 'split') result = { task: 'split', groups: [{ name: 'Docs', description: 'd', tabIds: [11] }] };
        setTimeout(() => onMsg.fire({ id: msg.id, ok: true, result }), 0);
      },
      disconnect() {},
    };
  }
  globalThis.chrome = {
    runtime: { id: 'self', lastError: null, connectNative: () => makePort(), getURL: (p) => p },
    storage: { local: area('local'), sync: area('sync') },
    tabs: { async query(q) { return (q && q.groupId === 7) ? [{ id: 11, url: 'https://a', title: 'A' }] : []; } },
    tabGroups: { async get() { return { title: 'Work', color: 'blue' }; } },
  };
  const dispatch = (message) => new Promise((resolve) => swOnMessage(message, { id: 'self' }, resolve));

  const board = await dispatch({ cmd: 'splitGroup', groupId: 7, fromBoard: true });
  assert.equal(board.proposal.origin.label, 'Split this group: Work', 'the board menu labels it "Split this group: <name>"');
  assert.ok(board.proposal.origin.at > 0, 'and stamps when the proposal came back');

  const card = await dispatch({ cmd: 'splitGroup', groupId: 7 });
  assert.equal(card.proposal.origin.label, 'Split… on Work', 'the re-analyze card labels it "Split… on <name>"');
});

// ---- 3. the cards render their From line ------------------------------------
//
// A tiny fake document, same surface as the board/split/tidy suites use.

function makeEl(tag) {
  const el = {
    tagName: String(tag || '').toUpperCase(),
    children: [],
    className: '',
    type: '',
    checked: false,
    disabled: false,
    hidden: false,
    style: {},
    attrs: {},
    listeners: {},
    onclick: null,
    parent: null,
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); if (v === '') this.children = []; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    append(...kids) { for (const k of kids) { if (k) k.parent = this; } this.children.push(...kids.filter(Boolean)); },
    appendChild(kid) { if (kid) kid.parent = this; this.children.push(kid); return kid; },
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } },
    // insertAdjacentElement('afterend', p): drop p into the parent right after this node.
    insertAdjacentElement(_pos, child) {
      if (this.parent) {
        child.parent = this.parent;
        const i = this.parent.children.indexOf(this);
        this.parent.children.splice(i + 1, 0, child);
      }
      return child;
    },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { if (this.onclick) return this.onclick(); if (this.listeners.click) return this.listeners.click(); },
  };
  return el;
}
function installFakeDocument() {
  globalThis.document = { createElement: (tag) => makeEl(tag), addEventListener() {}, removeEventListener() {} };
}
function walk(el, out = []) { if (!el) return out; out.push(el); for (const kid of el.children || []) walk(kid, out); return out; }
function originText(card) { return (walk(card).find((n) => n.className === 'resultOrigin') || {}).textContent; }

test('the re-analyze card renders "From Re-analyze parked groups, <time>" from a given origin', () => {
  installFakeDocument();
  const card = makeEl('section');
  const summary = makeEl('p');
  card.appendChild(summary);
  const els = { card, summary, list: makeEl('ul'), apply: makeEl('button'), dismiss: makeEl('button') };
  showTidyProposal({ proposal: { merge: [], split: [] }, els, send: () => Promise.resolve({ ok: true }), origin: { label: 'Re-analyze parked groups', at: AT } });
  assert.equal(originText(card), `From Re-analyze parked groups, ${TIME}`);
});

test('the re-analyze card re-renders its From line without stacking', () => {
  installFakeDocument();
  const card = makeEl('section');
  const summary = makeEl('p');
  card.appendChild(summary);
  const els = { card, summary, list: makeEl('ul'), apply: makeEl('button'), dismiss: makeEl('button') };
  const show = () => showTidyProposal({ proposal: { merge: [], split: [] }, els, send: () => Promise.resolve({ ok: true }), origin: { label: 'Re-analyze parked groups', at: AT } });
  show();
  show();
  assert.equal(walk(card).filter((n) => n.className === 'resultOrigin').length, 1, 'only one From line after two paints');
});

test('the split card renders "From <proposal.origin.label>, <time>"', () => {
  installFakeDocument();
  const card = makeEl('section');
  const summary = makeEl('p');
  card.appendChild(summary);
  const els = { card, summary, review: makeEl('button'), reviewList: makeEl('ul'), apply: makeEl('button'), dismiss: makeEl('button') };
  const proposal = { kind: 'open', name: 'Work', tabCount: 1, subGroups: [], origin: { label: 'Split this group: Work', at: AT } };
  showSplitProposal({ proposal, els, send: () => Promise.resolve({ ok: true }) });
  assert.equal(originText(card), `From Split this group: Work, ${TIME}`);
});

test('the split card shows no From line when the proposal carries no origin', () => {
  installFakeDocument();
  const card = makeEl('section');
  const summary = makeEl('p');
  card.appendChild(summary);
  const els = { card, summary, review: makeEl('button'), reviewList: makeEl('ul'), apply: makeEl('button'), dismiss: makeEl('button') };
  showSplitProposal({ proposal: { kind: 'open', name: 'Work', tabCount: 1, subGroups: [] }, els, send: () => Promise.resolve({ ok: true }) });
  assert.equal(originText(card), undefined, 'no origin → no From line');
});
