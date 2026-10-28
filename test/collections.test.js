// 0.11.0 — collections: parked groups sorted into named boxes ("Claude",
// "Video editing", "Health"…) that move as a whole when the page gets narrower.
// The AI suggests them, you click Go, then drag groups between them, rename,
// fold each one, or fold them all. The order and the collections are kept in
// chrome.storage.local, so a drag in the side panel repaints the new-tab page.
// Covers the helper's prompt and parser, the organize/collections task, and the
// board's rendering, drag, fold, rename and live sync, driven against the same
// tiny fake document the other board suites use (no jsdom in this repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectionsPrompt } from '../native-host/prompts.js';
import { parseCollectionsResult } from '../native-host/parse.js';
import { handle } from '../native-host/dispatch.js';

// ---- prompt -----------------------------------------------------------------

test('collections prompt lists each parked group inside the data fence and asks for collections JSON', () => {
  const p = buildCollectionsPrompt(
    [{ name: 'Claude Code help', tabs: [{ title: 'Docs', url: 'https://x' }] }, { name: 'Premiere help', tabCount: 4 }],
    ['Claude'],
  );
  assert.match(p, /BEGIN DATA/);
  assert.match(p, /GROUP Claude Code help \(1 tabs\)/);
  assert.match(p, /GROUP Premiere help \(4 tabs\)/);
  assert.match(p, /"collections"/);
  assert.match(p, /Claude/, 'the current collection names are offered so they can be kept');
  assert.ok(p.indexOf('Current collections') < p.indexOf('BEGIN DATA'), 'current names sit outside the data fence');
});

test('collections prompt without current collections says nothing about them', () => {
  const p = buildCollectionsPrompt([{ name: 'A', tabCount: 1 }]);
  assert.doesNotMatch(p, /Current collections/);
});

// ---- parser -----------------------------------------------------------------

test('parseCollectionsResult keeps only sent group names, canonical spelling, each group once', () => {
  const out = JSON.stringify({ collections: [
    { name: ' Claude ', groups: ['claude code help', 'Claude agents', 'Nope'] },
    { name: 'Video', groups: ['Premiere help', 'Claude agents'] },
    { name: 'Empty', groups: ['Ghost'] },
    { name: '', groups: ['Mac apps'] },
  ] });
  const r = parseCollectionsResult(out, ['Claude Code help', 'Claude agents', 'Premiere help', 'Mac apps']);
  assert.deepEqual(r, [
    { name: 'Claude', groups: ['Claude Code help', 'Claude agents'] },
    { name: 'Video', groups: ['Premiere help'] },
  ]);
});

test('parseCollectionsResult merges two collections with the same name and caps names at 40 characters', () => {
  const long = 'x'.repeat(80);
  const r = parseCollectionsResult(JSON.stringify({ collections: [
    { name: 'AI', groups: ['A'] }, { name: 'ai', groups: ['B'] }, { name: long, groups: ['C'] },
  ] }), ['A', 'B', 'C']);
  assert.deepEqual(r[0], { name: 'AI', groups: ['A', 'B'] });
  assert.equal(r[1].name.length, 40);
});

test('parseCollectionsResult tolerates junk', () => {
  assert.deepEqual(parseCollectionsResult('null', ['A']), []);
  assert.deepEqual(parseCollectionsResult('{"collections":"x"}', ['A']), []);
  assert.deepEqual(parseCollectionsResult('{"collections":[null,5,{"name":"X","groups":"A"}]}', ['A']), []);
});

// ---- dispatch -----------------------------------------------------------------

function fakeGetAdapter(cannedOutput, seen = {}) {
  return () => ({ name: 'fake', async run(prompt) { seen.prompt = prompt; return cannedOutput; }, async health() { return { version: 'test' }; } });
}

test('organize/collections parses against only the sent names and passes the current names to the prompt', async () => {
  const seen = {};
  const out = '{"collections":[{"name":"Travel","groups":["Trips","Hotels","Ghost"]}]}';
  const r = await handle(
    { type: 'organize', task: 'collections', payload: { groups: [{ name: 'Trips' }, { name: 'Hotels' }, { name: 'Work' }], current: ['Holidays'] } },
    { getAdapter: fakeGetAdapter(out, seen), loadGroups: () => '' },
  );
  assert.equal(r.task, 'collections');
  assert.deepEqual(r.collections, [{ name: 'Travel', groups: ['Trips', 'Hotels'] }]);
  assert.match(seen.prompt, /Holidays/);
});

test('health advertises the collections task', async () => {
  const r = await handle({ type: 'health', adapter: 'fake' }, { getAdapter: fakeGetAdapter('') });
  assert.ok(r.capabilities.tasks.includes('collections'));
});

// ---- board ------------------------------------------------------------------

import { renderBoard } from '../extension/board/board.js';
import { filterCards } from '../extension/newtab/newtab.js';

function makeEl(tag) {
  const el = {
    tagName: String(tag || '').toUpperCase(),
    children: [],
    className: '',
    value: '',
    open: false,
    style: {},
    listeners: {},
    parent: null,
    hidden: false,
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); if (v === '') this.children = []; },
    append(...kids) { for (const k of kids) { if (k) k.parent = this; } this.children.push(...kids); },
    appendChild(kid) { if (kid) kid.parent = this; this.children.push(kid); return kid; },
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { if (this.listeners.click) return this.listeners.click({ preventDefault() {}, stopPropagation() {} }); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, '');
      return walk(this).slice(1).filter((n) => String(n.className).split(/\s+/).includes(cls));
    },
  };
  return el;
}

function installFakeDocument() {
  globalThis.document = { createElement: (tag) => makeEl(tag), addEventListener() {}, removeEventListener() {} };
}

function walk(el, out = []) {
  if (!el) return out;
  out.push(el);
  for (const kid of el.children || []) walk(kid, out);
  return out;
}

const hasClass = (n, cls) => String(n.className || '').split(/\s+/).includes(cls);

function makeStorage(initial = {}) {
  let data = JSON.parse(JSON.stringify(initial));
  return {
    get: async (key) => (key in data ? { [key]: JSON.parse(JSON.stringify(data[key])) } : {}),
    set: async (obj) => { data = { ...data, ...JSON.parse(JSON.stringify(obj)) }; },
    peek: () => data,
  };
}

async function flush() {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

const g = (name) => ({ name, color: 'blue', tabCount: 1, tabs: [] });
const DATA = { open: [], parked: ['Claude help', 'Claude agents', 'Premiere help', 'DaVinci help', 'Mac apps'].map(g), descriptions: [] };

function makeSend(suggestion) {
  const sent = [];
  const send = (msg) => {
    sent.push(msg);
    if (msg.cmd === 'boardData') return Promise.resolve({ ok: true, ...DATA });
    if (msg.cmd === 'suggestCollections') return Promise.resolve(suggestion);
    return Promise.resolve({ ok: true });
  };
  return { send, sent };
}

const SAVED = [
  { id: 'c1', name: 'Claude', groups: ['claude agents', 'Claude help', 'Gone'] },
  { id: 'c2', name: 'Video', groups: ['Premiere help', 'DaVinci help'] },
];

// Each box on screen as { id, name, rows }, in order.
function boxes(container) {
  return walk(container).filter((n) => hasClass(n, 'boardCollection')).map((b) => ({
    id: b.dataset.collectionId,
    name: walk(b).find((n) => hasClass(n, 'boardCollectionName')).textContent,
    rows: (b.children || []).filter((c) => hasClass(c, 'boardRow--parked')).map((r) => r.dataset.parkedName),
    el: b,
  }));
}

const rowFor = (container, name) => walk(container).find((n) => hasClass(n, 'boardRow--parked') && n.dataset.parkedName === name);
const buttonText = (container, text) => walk(container).find((n) => n.tagName === 'BUTTON' && n.textContent === text);

async function render(storage, suggestion) {
  installFakeDocument();
  const container = makeEl('div');
  const { send, sent } = makeSend(suggestion);
  await renderBoard(container, { send, storage, chromeApi: {} });
  return { container, sent };
}

test('saved collections render as boxes in order, in-collection order kept, the rest in "Not in a collection"', async () => {
  const { container } = await render(makeStorage({ boardCollections: SAVED, boardParkedOrder: ['Mac apps'] }));
  const got = boxes(container).map(({ id, name, rows }) => ({ id, name, rows }));
  assert.deepEqual(got, [
    { id: 'c1', name: 'Claude', rows: ['Claude agents', 'Claude help'] },
    { id: 'c2', name: 'Video', rows: ['Premiere help', 'DaVinci help'] },
    { id: 'loose', name: 'Not in a collection', rows: ['Mac apps'] },
  ]);
  const section = walk(container).find((n) => hasClass(n, 'boardSection--parked'));
  assert.ok(hasClass(section, 'boardSection--collections'), 'the section is marked for the box layout');
});

test('without collections the rows stay straight in the Parked section, and the tools offer Suggest collections', async () => {
  const { container } = await render(makeStorage());
  assert.equal(boxes(container).length, 0);
  const section = walk(container).find((n) => hasClass(n, 'boardSection--parked'));
  assert.equal(section.children.filter((c) => hasClass(c, 'boardRow--parked')).length, 5);
  assert.ok(buttonText(container, 'Suggest collections…'));
  assert.ok(!buttonText(container, 'Fold all'), 'nothing to fold yet');
});

test('a folded box draws closed, and folding one saves it', async () => {
  const storage = makeStorage({ boardCollections: SAVED, boardCollectionsFolded: ['c2'] });
  const { container } = await render(storage);
  const [claude, video] = boxes(container);
  assert.equal(video.el.open, false);
  assert.equal(claude.el.open, true);
  claude.el.open = false;
  claude.el.listeners.toggle();
  await flush();
  assert.deepEqual(storage.peek().boardCollectionsFolded.sort(), ['c1', 'c2']);
});

test('Fold all folds every box, and then reads Unfold all', async () => {
  const storage = makeStorage({ boardCollections: SAVED });
  const { container } = await render(storage);
  await buttonText(container, 'Fold all').click();
  await flush();
  assert.deepEqual(storage.peek().boardCollectionsFolded, ['c1', 'c2', 'loose']);
  assert.ok(boxes(container).every((b) => b.el.open === false), 're-rendered folded');
  await buttonText(container, 'Unfold all').click();
  await flush();
  assert.deepEqual(storage.peek().boardCollectionsFolded, []);
});

const drag = (row) => row.listeners.dragstart({ dataTransfer: { setData() {} } });
const dropOn = (el) => el.listeners.drop({ preventDefault() {}, dataTransfer: {} });

test('dropping a row on a row in another collection moves it there, before the target', async () => {
  const storage = makeStorage({ boardCollections: SAVED });
  const { container } = await render(storage);
  drag(rowFor(container, 'Mac apps'));
  dropOn(rowFor(container, 'Premiere help'));
  await flush();
  assert.deepEqual(storage.peek().boardCollections[1].groups, ['Mac apps', 'Premiere help', 'DaVinci help']);
  assert.deepEqual(boxes(container)[1].rows, ['Mac apps', 'Premiere help', 'DaVinci help'], 're-rendered');
  assert.ok(!boxes(container).some((b) => b.id === 'loose'), 'nothing left loose');
});

test('dropping on a box title lands the group at its end and takes it out of its old box', async () => {
  const storage = makeStorage({ boardCollections: SAVED });
  const { container } = await render(storage);
  drag(rowFor(container, 'Claude help'));
  dropOn(walk(boxes(container)[1].el).find((n) => n.tagName === 'SUMMARY'));
  await flush();
  const [claude, video] = storage.peek().boardCollections;
  assert.deepEqual(video.groups, ['Premiere help', 'DaVinci help', 'Claude help']);
  assert.ok(!claude.groups.includes('Claude help'));
  assert.ok(claude.groups.includes('Gone'), 'a group that is not parked right now keeps its place');
});

test('dropping into Not in a collection takes the group out of its collection and saves the loose order', async () => {
  const storage = makeStorage({ boardCollections: SAVED });
  const { container } = await render(storage);
  drag(rowFor(container, 'DaVinci help'));
  dropOn(rowFor(container, 'Mac apps'));
  await flush();
  assert.deepEqual(storage.peek().boardCollections[1].groups, ['Premiere help']);
  assert.deepEqual(storage.peek().boardParkedOrder, ['DaVinci help', 'Mac apps']);
});

test('Suggest collections shows the AI\'s collections; Go saves them as boxes', async () => {
  const storage = makeStorage();
  const suggestion = { ok: true, collections: [{ name: 'Claude', groups: ['Claude help', 'Claude agents'] }, { name: 'Video', groups: ['Premiere help', 'DaVinci help'] }] };
  const { container, sent } = await render(storage, suggestion);
  await buttonText(container, 'Suggest collections…').click();
  await flush();
  assert.deepEqual(sent.find((m) => m.cmd === 'suggestCollections').current, []);
  const card = walk(container).find((n) => hasClass(n, 'boardCollectionProposal'));
  assert.ok(card, 'the suggestion card shows');
  assert.equal(walk(card).find((n) => hasClass(n, 'boardProposalHead')).textContent, 'The AI suggests 2 collections.');
  assert.equal(boxes(container).length, 0, 'nothing changes before Go');
  await buttonText(container, 'Go').click();
  await flush();
  const saved = storage.peek().boardCollections;
  assert.deepEqual(saved.map((c) => [c.name, c.groups]), [['Claude', ['Claude help', 'Claude agents']], ['Video', ['Premiere help', 'DaVinci help']]]);
  assert.ok(saved.every((c) => typeof c.id === 'string' && c.id), 'each gets an id');
  assert.ok(!walk(container).some((n) => hasClass(n, 'boardCollectionProposal')), 'the card is gone');
  assert.deepEqual(boxes(container).map((b) => b.name), ['Claude', 'Video', 'Not in a collection']);
});

test('Suggest collections again says Go replaces the current ones; Cancel keeps them', async () => {
  const storage = makeStorage({ boardCollections: SAVED });
  const { container, sent } = await render(storage, { ok: true, collections: [{ name: 'All', groups: ['Mac apps'] }] });
  await buttonText(container, 'Suggest collections again…').click();
  await flush();
  assert.deepEqual(sent.find((m) => m.cmd === 'suggestCollections').current, ['Claude', 'Video']);
  assert.match(walk(container).find((n) => hasClass(n, 'boardProposalHead')).textContent, /replaces your current ones/);
  await buttonText(container, 'Cancel').click();
  await flush();
  assert.deepEqual(storage.peek().boardCollections, SAVED);
});

test('a failed suggestion says why and can be dismissed', async () => {
  const { container } = await render(makeStorage(), undefined);
  await buttonText(container, 'Suggest collections…').click();
  await flush();
  assert.match(walk(container).find((n) => hasClass(n, 'boardProposalHead')).textContent, /couldn't suggest collections/);
  await buttonText(container, 'Dismiss').click();
  await flush();
  assert.ok(!walk(container).some((n) => hasClass(n, 'boardCollectionProposal')));
});

async function chooseBoxMenu(container, boxIndex, label) {
  const box = boxes(container)[boxIndex].el;
  walk(box).find((n) => n.tagName === 'BUTTON' && n.textContent === '⋯' && hasClass(n.parent, 'boardCollectionMenuWrap')).click();
  await walk(box).find((n) => n.tagName === 'BUTTON' && n.textContent === label).click();
  await flush();
}

test('Rename… opens a name field; Save keeps the trimmed name', async () => {
  const storage = makeStorage({ boardCollections: SAVED });
  const { container } = await render(storage);
  await chooseBoxMenu(container, 0, 'Rename…');
  const form = walk(container).find((n) => hasClass(n, 'boardCollectionRename'));
  assert.ok(form, 'the name field shows');
  form.children[0].value = '   Claude   stuff  ';
  form.listeners.submit({ preventDefault() {} });
  await flush();
  assert.equal(storage.peek().boardCollections[0].name, 'Claude stuff');
  assert.ok(!walk(container).some((n) => hasClass(n, 'boardCollectionRename')), 'the field closes');
});

test('Remove collection sends its groups back to Not in a collection', async () => {
  const storage = makeStorage({ boardCollections: SAVED });
  const { container } = await render(storage);
  await chooseBoxMenu(container, 1, 'Remove collection');
  assert.deepEqual(storage.peek().boardCollections.map((c) => c.id), ['c1']);
  assert.deepEqual(boxes(container).at(-1).rows, ['Premiere help', 'DaVinci help', 'Mac apps']);
});

test('New collection adds an empty box with a drop line and opens its name field', async () => {
  const storage = makeStorage({ boardCollections: SAVED });
  const { container } = await render(storage);
  await buttonText(container, 'New collection').click();
  await flush();
  const added = boxes(container)[2];
  assert.equal(added.name, 'New collection');
  assert.ok(walk(added.el).some((n) => hasClass(n, 'boardCollectionEmpty') && n.textContent === 'Drag groups here'));
  assert.ok(walk(added.el).some((n) => hasClass(n, 'boardCollectionRename')), 'ready to name');
});

test('Order ▸ A to Z sorts inside each collection too', async () => {
  const storage = makeStorage({ boardCollections: SAVED });
  const { container } = await render(storage);
  const btn = walk(container).find((n) => n.className === 'boardOrderBtn');
  btn.click();
  await walk(btn.parent).find((n) => n.tagName === 'BUTTON' && n.textContent === 'A to Z').click();
  await flush();
  assert.deepEqual(storage.peek().boardCollections[1].groups, ['DaVinci help', 'Premiere help']);
  assert.deepEqual(storage.peek().boardCollections[0].groups, ['claude agents', 'Claude help', 'Gone'], 'missing names stay at the end');
});

// ---- live sync between the side panel and the new-tab page ------------------

test('a change to the order or collections from the other window repaints; this page\'s own write does not', async () => {
  installFakeDocument();
  const storage = makeStorage({ boardCollections: SAVED });
  const listeners = [];
  const chromeApi = { storage: { onChanged: { addListener: (fn) => listeners.push(fn), removeListener() {} } } };
  let paints = 0;
  const send = (msg) => { if (msg.cmd === 'boardData') paints += 1; return Promise.resolve({ ok: true, ...DATA }); };
  const container = makeEl('div');
  const teardown = await renderBoard(container, { send, storage, chromeApi, debounceMs: 0 });
  assert.equal(listeners.length, 1, 'one storage listener');
  const before = paints;
  listeners[0]({ boardParkedOrder: { newValue: ['Mac apps', 'Claude help'] } }, 'local');
  await new Promise((r) => setTimeout(r, 5));
  await flush();
  assert.equal(paints, before + 1, 'the other window\'s drag repaints this board');
  listeners[0]({ boardParkedOrder: { newValue: ['Mac apps', 'Claude help'] } }, 'local');
  listeners[0]({ boardDescribeAsked: { newValue: {} } }, 'local');
  listeners[0]({ boardCollections: { newValue: [] } }, 'sync');
  await new Promise((r) => setTimeout(r, 5));
  await flush();
  assert.equal(paints, before + 1, 'the same value again, another key, or another area does not');
  teardown();
});

test('the new-tab filter hides a collection box with no matching groups', async () => {
  const { container } = await render(makeStorage({ boardCollections: SAVED }));
  filterCards(container, 'premiere');
  const [claude, video, loose] = boxes(container);
  assert.equal(claude.el.hidden, true);
  assert.equal(video.el.hidden, false);
  assert.equal(loose.el.hidden, true);
  filterCards(container, '');
  assert.ok(boxes(container).every((b) => b.el.hidden === false));
});
