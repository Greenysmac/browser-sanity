// Task 3: "Split this group…" — the board menu item and 30+ badge, the service
// worker's splitGroup command (building the right request for open and parked
// groups and mapping fake ids back), the split proposal result card text, and
// Apply issuing the right commands in order (nothing before Apply). The board
// and split-view run against the same tiny fake document the board tests use;
// the service worker runs against the same fake-port chrome the sort-tabs tests
// use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoard } from '../extension/board/board.js';
import { splitSummaryText, showSplitProposal } from '../extension/sidepanel/split-view.js';

// --- a minimal fake document (same surface as board.test.js) ----------------

function makeEl(tag) {
  const el = {
    tagName: String(tag || '').toUpperCase(),
    children: [],
    className: '',
    type: '',
    rows: 0,
    value: '',
    open: false,
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
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { if (this.onclick) return this.onclick(); if (this.listeners.click) return this.listeners.click(); },
  };
  return el;
}

function installFakeDocument() {
  const docListeners = {};
  globalThis.document = {
    createElement: (tag) => makeEl(tag),
    addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || new Set()).add(fn); },
    removeEventListener(ev, fn) { if (docListeners[ev]) docListeners[ev].delete(fn); },
  };
}

function walk(el, out = []) {
  if (!el) return out;
  out.push(el);
  for (const kid of el.children || []) walk(kid, out);
  return out;
}
function allText(el) { return walk(el).map((n) => n.textContent).filter(Boolean); }
function byClass(el, cls) { return walk(el).filter((n) => n.className === cls); }

function openRowMenu(container, name) {
  const nameEl = walk(container).find((n) => n.className === 'boardName' && n.textContent === name);
  const row = nameEl && nameEl.parent;
  const menuBtn = (row.children || []).find((c) => c.className === 'boardMenuBtn');
  menuBtn.click();
  return row;
}
function menuItemLabels(row) {
  const menu = (row.children || []).find((c) => c.className === 'boardMenu');
  return (menu.children || []).map((li) => (li.children[0] && li.children[0].textContent));
}
function clickMenuItem(row, label) {
  const menu = (row.children || []).find((c) => c.className === 'boardMenu');
  const li = (menu.children || []).find((l) => l.children[0] && l.children[0].textContent === label);
  return li.children[0].click();
}

function makeSend(boardData, onSplit) {
  const sent = [];
  const send = (msg) => {
    sent.push(msg);
    if (msg.cmd === 'boardData') return Promise.resolve({ ok: true, ...boardData });
    if (msg.cmd === 'splitGroup' && onSplit) return Promise.resolve(onSplit(msg));
    return Promise.resolve({ ok: true });
  };
  return { send, sent };
}

const FIXTURE = {
  open: [
    { groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 40, webTabCount: 40 },
    { groupId: 8, name: 'Small', color: 'red', windowId: 1, tabCount: 3, webTabCount: 3 },
  ],
  parked: [
    { name: 'Travel', color: 'green', tabCount: 31, lastSeen: '2026-01-02T10:00:00.000Z' },
    { name: 'Tiny', color: 'grey', tabCount: 2, lastSeen: '2026-01-02T10:00:00.000Z' },
  ],
  descriptions: [],
};

// --- board: menu item + 30+ badge ------------------------------------------

test('open and parked rows both offer "Split this group…"', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  assert.ok(menuItemLabels(openRowMenu(container, 'Work')).includes('Split this group…'), 'open row has Split');
  assert.ok(menuItemLabels(openRowMenu(container, 'Travel')).includes('Split this group…'), 'parked row has Split');
});

test('a row with more than 30 tabs shows a "30+" badge; a small one does not', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const badges = byClass(container, 'boardSplitHint');
  assert.equal(badges.length, 2, 'exactly the two crowded rows (Work: 40, Travel: 31) are badged');
  assert.ok(badges.every((b) => b.textContent === '30+'));
  // The small open group (3) and small parked group (2) carry no badge.
  assert.ok(allText(container).includes('3 tabs'));
  assert.ok(!byClass(container, 'boardSplitHint').some((b) => b.parent && b.parent.children.some((c) => c.textContent === '3 tabs')));
});

test('choosing Split sends splitGroup with the groupId (open) or name (parked) and hands the proposal on', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const proposals = [];
  const onSplit = (msg) => ({ ok: true, proposal: { kind: msg.groupId != null ? 'open' : 'parked', name: 'X', tabCount: 1, subGroups: [] } });
  const { send, sent } = makeSend(FIXTURE, onSplit);
  await renderBoard(container, { send, onSplitProposal: (p) => proposals.push(p) });

  await clickMenuItem(openRowMenu(container, 'Work'), 'Split this group…');
  const openMsg = sent.find((m) => m.cmd === 'splitGroup' && m.groupId === 7);
  assert.ok(openMsg, 'open split sends groupId');
  assert.equal(openMsg.name, undefined, 'open split carries no name');

  await clickMenuItem(openRowMenu(container, 'Travel'), 'Split this group…');
  const parkedMsg = sent.find((m) => m.cmd === 'splitGroup' && m.name === 'Travel');
  assert.ok(parkedMsg, 'parked split sends name');
  assert.equal(parkedMsg.groupId, undefined, 'parked split carries no groupId');

  assert.equal(proposals.length, 2, 'each Split handed a proposal to the panel');
  assert.deepEqual(proposals.map((p) => p.kind), ['open', 'parked']);
});

// --- split-view: result card text + Review + Apply order --------------------

const PROPOSAL_OPEN = {
  kind: 'open',
  name: 'Work',
  groupId: 7,
  color: 'blue',
  tabCount: 5,
  subGroups: [
    { name: 'Docs', description: 'reading', tabs: [{ tabId: 11, title: 'A', url: 'https://a' }, { tabId: 12, title: 'B', url: 'https://b' }] },
    { name: 'Code', description: 'repos', tabs: [{ tabId: 13, title: 'C', url: 'https://c' }] },
  ],
};

const PROPOSAL_PARKED = {
  kind: 'parked',
  name: 'Travel',
  groupId: null,
  color: 'green',
  tabCount: 3,
  subGroups: [
    { name: 'Flights', description: 'air', tabs: [{ title: 'F1', url: 'https://f1' }] },
    { name: 'Hotels', description: 'stay', tabs: [{ title: 'H1', url: 'https://h1' }, { title: 'H2', url: 'https://h2' }] },
  ],
};

test('the result card summary reads "Split <name> (<n> tabs) into <m> groups"', () => {
  assert.equal(splitSummaryText(PROPOSAL_OPEN), 'Split Work (5 tabs) into 2 groups');
  assert.equal(splitSummaryText(PROPOSAL_PARKED), 'Split Travel (3 tabs) into 2 groups');
});

// Build the split card's element bag the way sidepanel.js wires it.
function makeSplitEls() {
  return {
    card: makeEl('section'),
    summary: makeEl('p'),
    review: makeEl('button'),
    reviewList: makeEl('ul'),
    apply: makeEl('button'),
  };
}

function makeRecordingSend() {
  const sent = [];
  return { sent, send: (m) => { sent.push(m); return Promise.resolve({ ok: true }); } };
}

test('Review lists each sub-group with name, count, description and tab titles; nothing is sent until Apply', () => {
  installFakeDocument();
  const els = makeSplitEls();
  const { sent, send } = makeRecordingSend();
  showSplitProposal({ proposal: PROPOSAL_OPEN, els, send });

  assert.equal(els.summary.textContent, 'Split Work (5 tabs) into 2 groups');
  assert.equal(els.card.hidden, false, 'card is shown');
  assert.equal(els.reviewList.hidden, true, 'review list hidden until Review clicked');

  const texts = allText(els.reviewList);
  assert.ok(texts.includes('Docs'), 'sub-group name');
  assert.ok(texts.includes(' (2 tabs)'), 'sub-group count');
  assert.ok(texts.includes('reading'), 'sub-group description');
  assert.ok(texts.includes('A') && texts.includes('B') && texts.includes('C'), 'tab titles');

  els.review.click();
  assert.equal(els.reviewList.hidden, false, 'Review reveals the list');

  assert.equal(sent.length, 0, 'nothing is sent before Apply');
});

test('Apply for an open group issues groupTabs per sub-group then groupsSplit', async () => {
  installFakeDocument();
  const els = makeSplitEls();
  const { sent, send } = makeRecordingSend();
  let done = 0;
  showSplitProposal({ proposal: PROPOSAL_OPEN, els, send, onDone: () => { done += 1; } });
  await els.apply.click();

  const cmds = sent.map((m) => m.cmd);
  assert.deepEqual(cmds, ['groupTabs', 'groupTabs', 'groupsSplit'], 'one groupTabs per sub-group, then groupsSplit');
  // Each groupTabs carries the sub-group name, the parent's color, and its ids.
  assert.deepEqual(sent[0].item.data, { groupName: 'Docs', color: 'blue', tabIds: [11, 12] });
  assert.deepEqual(sent[1].item.data, { groupName: 'Code', color: 'blue', tabIds: [13] });
  // groupsSplit records the sub-group lines (name + description) under the parent.
  assert.equal(sent[2].name, 'Work');
  assert.deepEqual(sent[2].groups, [
    { name: 'Docs', description: 'reading' },
    { name: 'Code', description: 'repos' },
  ]);
  assert.equal(els.card.hidden, true, 'card hides after Apply');
  assert.equal(done, 1, 'onDone fired to refresh the board');
});

test('Apply for a parked group sends splitParked then groupsSplit', async () => {
  installFakeDocument();
  const els = makeSplitEls();
  const { sent, send } = makeRecordingSend();
  showSplitProposal({ proposal: PROPOSAL_PARKED, els, send });
  await els.apply.click();

  const cmds = sent.map((m) => m.cmd);
  assert.deepEqual(cmds, ['splitParked', 'groupsSplit'], 'splitParked first, then groupsSplit');
  assert.equal(sent[0].name, 'Travel');
  assert.deepEqual(sent[0].groups, [
    { name: 'Flights', description: 'air', urls: ['https://f1'] },
    { name: 'Hotels', description: 'stay', urls: ['https://h1', 'https://h2'] },
  ]);
  assert.equal(sent[1].name, 'Travel');
  assert.deepEqual(sent[1].groups, [
    { name: 'Flights', description: 'air' },
    { name: 'Hotels', description: 'stay' },
  ]);
});

// --- service worker: splitGroup builds the request and maps ids back --------

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

// A fake-port chrome whose native host answers index-read (for parked splits)
// and organize/split (echoing a fixed sub-group split), recording every request.
function installSwChrome({ groupTabs = {}, index = { groups: [] }, splitGroups = [] } = {}) {
  const stored = { local: {}, sync: {} };
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
      postMessage(msg) {
        requests.push(msg);
        let result = { ok: true };
        if (msg.type === 'index-read') result = index;
        else if (msg.type === 'organize' && msg.task === 'split') result = { task: 'split', groups: splitGroups };
        setTimeout(() => onMsg.fire({ id: msg.id, ok: true, result }), 0);
      },
      disconnect() {},
    };
  }
  const chrome = {
    runtime: { id: 'self', lastError: null, connectNative: () => makePort(), getURL: (p) => p },
    storage: { local: area('local'), sync: area('sync') },
    tabs: {
      async query(q) { if (q && 'groupId' in q) return groupTabs[q.groupId] || []; return []; },
    },
    tabGroups: { async get(id) { return { title: id === 7 ? 'Work' : '', color: 'blue' }; } },
  };
  globalThis.chrome = chrome;
  const dispatch = (message) => new Promise((resolve) => {
    const ret = swOnMessage(message, { id: 'self' }, resolve);
    assert.equal(ret, true);
  });
  return { dispatch, requests, stored };
}

test('splitGroup for an open group sends the live web tabs and returns an open proposal', async () => {
  const { dispatch, requests } = installSwChrome({
    groupTabs: { 7: [
      { id: 11, url: 'https://a', title: 'A' },
      { id: 12, url: 'https://b', title: 'B' },
      { id: 13, url: 'chrome://newtab', title: 'tab' }, // non-web: excluded
    ] },
    splitGroups: [{ name: 'Docs', description: 'd', tabIds: [11] }, { name: 'Code', description: 'c', tabIds: [12] }],
  });
  const res = await dispatch({ cmd: 'splitGroup', groupId: 7 });
  assert.equal(res.ok, true);
  const splitReq = requests.find((r) => r.type === 'organize' && r.task === 'split');
  assert.ok(splitReq, 'a split task was requested');
  assert.equal(splitReq.payload.groupName, 'Work');
  assert.deepEqual(splitReq.payload.tabs.map((t) => t.tabId), [11, 12], 'only the two http tabs are sent');
  assert.equal(res.proposal.kind, 'open');
  assert.equal(res.proposal.color, 'blue');
  assert.equal(res.proposal.tabCount, 2);
  assert.deepEqual(res.proposal.subGroups.map((g) => g.name), ['Docs', 'Code']);
  // ids map back to live tabs (tabId kept for the open apply path).
  assert.deepEqual(res.proposal.subGroups[0].tabs, [{ tabId: 11, title: 'A', url: 'https://a' }]);
});

test('splitGroup for a parked group reads the index, uses fake ids, and maps them back to title/url', async () => {
  const { dispatch, requests } = installSwChrome({
    index: { groups: [{ name: 'Travel', color: 'green', status: 'parked', tabs: [
      { title: 'F1', url: 'https://f1' },
      { title: 'H1', url: 'https://h1' },
    ] }] },
    // The model splits by the fake sequential ids 1 and 2.
    splitGroups: [{ name: 'Flights', description: 'air', tabIds: [1] }, { name: 'Hotels', description: 'stay', tabIds: [2] }],
  });
  const res = await dispatch({ cmd: 'splitGroup', name: 'Travel' });
  assert.equal(res.ok, true);
  const splitReq = requests.find((r) => r.type === 'organize' && r.task === 'split');
  assert.ok(splitReq, 'a split task was requested');
  assert.deepEqual(splitReq.payload.tabs.map((t) => t.tabId), [1, 2], 'fake sequential ids are sent');
  assert.equal(res.proposal.kind, 'parked');
  assert.equal(res.proposal.tabCount, 2);
  // Fake ids are mapped back to the parked tabs' title/url (no live tabId kept).
  assert.deepEqual(res.proposal.subGroups[0].tabs, [{ title: 'F1', url: 'https://f1' }]);
  assert.deepEqual(res.proposal.subGroups[1].tabs, [{ title: 'H1', url: 'https://h1' }]);
});

test('splitGroup stores the proposal so the panel can read it on open, then clear it', async () => {
  const { dispatch } = installSwChrome({
    groupTabs: { 7: [{ id: 11, url: 'https://a', title: 'A' }] },
    splitGroups: [{ name: 'Docs', description: 'd', tabIds: [11] }],
  });
  await dispatch({ cmd: 'splitGroup', groupId: 7 });
  const got = await dispatch({ cmd: 'getSplitProposal' });
  assert.equal(got.ok, true);
  assert.equal(got.proposal.name, 'Work');
  await dispatch({ cmd: 'clearSplitProposal' });
  const after = await dispatch({ cmd: 'getSplitProposal' });
  assert.equal(after.proposal, null, 'cleared after the panel reads it');
});
