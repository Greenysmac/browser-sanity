// New-tab board tests. Like the board/settings-view tests, the page has no
// jsdom harness, so this installs a tiny fake document covering just the DOM
// surface the newtab module and renderBoard touch: createElement, textContent/
// value/style/hidden, append(Child), addEventListener, and querySelector(All)
// with the handful of selectors used ('.boardCard', '.boardName'). A fake send
// answers 'boardData' and records dispatched commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initNewtab, filterCards, openSidePanel } from '../extension/newtab/newtab.js';

const manifestPath = fileURLToPath(new URL('../extension/manifest.json', import.meta.url));

// The top-level manifest keys as committed before this task added the override.
// The task only adds "chrome_url_overrides" and changes nothing else, so the
// current manifest's keys must equal exactly these plus that one new key.
const COMMITTED_KEYS = [
  'manifest_version', 'default_locale', 'name', 'version', 'version_name',
  'description', 'minimum_chrome_version', 'key', 'icons', 'permissions',
  'optional_host_permissions', 'background', 'action', 'side_panel',
  'omnibox', 'commands',
];

// --- fake DOM ---------------------------------------------------------------

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
    listeners: {},
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) {
      this._text = String(v);
      if (v === '') this.children = [];
    },
    append(...kids) { this.children.push(...kids); },
    appendChild(kid) { this.children.push(kid); return kid; },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    dispatch(ev) { if (this.listeners[ev]) return this.listeners[ev](); },
    querySelectorAll(sel) { return walk(this).filter((n) => matches(n, sel)); },
    querySelector(sel) { return walk(this).find((n) => matches(n, sel)) || null; },
  };
  return el;
}

// Only the simple class selectors renderBoard + newtab use.
function matches(el, sel) {
  if (sel.startsWith('.')) return String(el.className || '').split(/\s+/).includes(sel.slice(1));
  return false;
}

function walk(el, out = []) {
  if (!el) return out;
  out.push(el);
  for (const kid of el.children || []) walk(kid, out);
  return out;
}

function installFakeDocument() {
  globalThis.document = { createElement: (tag) => makeEl(tag) };
}

const FIXTURE = {
  ok: true,
  open: [
    { groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 3 },
    { groupId: 8, name: 'Travel plans', color: 'green', windowId: 1, tabCount: 2 },
  ],
  parked: [{ name: 'Reading', color: 'red', tabCount: 4, lastSeen: '2026-01-02T10:00:00.000Z' }],
  descriptions: [],
};

// --- tests ------------------------------------------------------------------

test('manifest has the newtab override and its other keys are unchanged', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(manifest.chrome_url_overrides, { newtab: 'newtab/newtab.html' });
  const keys = Object.keys(manifest).filter((k) => k !== 'chrome_url_overrides');
  assert.deepEqual(keys.sort(), [...COMMITTED_KEYS].sort(), 'the pre-existing keys are untouched');
});

test('initNewtab renders the board into its container with a fake send', async () => {
  installFakeDocument();
  const container = makeEl('div');
  globalThis.chrome = { runtime: { sendMessage: (msg, cb) => cb(msg.cmd === 'boardData' ? FIXTURE : { ok: true }) } };
  await initNewtab({ container, note: makeEl('p'), search: makeEl('input') });
  const texts = walk(container).map((n) => n.textContent);
  assert.ok(texts.includes('Open now'), 'open section rendered');
  assert.ok(texts.includes('Work'), 'open group name rendered');
  assert.ok(texts.includes('Reading'), 'parked group name rendered');
});

test('the filter hides non-matching cards and restores them when cleared', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const note = makeEl('p');
  const search = makeEl('input');
  globalThis.chrome = { runtime: { sendMessage: (msg, cb) => cb(msg.cmd === 'boardData' ? FIXTURE : { ok: true }) } };
  await initNewtab({ container, note, search });

  search.value = 'travel';
  search.dispatch('input');
  const cards = container.querySelectorAll('.boardCard');
  const byName = (n) => cards.find((c) => c.querySelector('.boardName').textContent === n);
  assert.equal(byName('Travel plans').hidden, false, 'matching card stays visible');
  assert.equal(byName('Work').hidden, true, 'non-matching card is hidden');
  assert.equal(byName('Reading').hidden, true, 'non-matching parked card is hidden');

  search.value = '';
  search.dispatch('input');
  assert.ok(cards.every((c) => c.hidden === false), 'clearing the filter shows every card');
});

test('filterCards matches on group name case-insensitively', () => {
  installFakeDocument();
  const container = makeEl('div');
  const mk = (name) => {
    const card = makeEl('div'); card.className = 'boardCard';
    const nm = makeEl('span'); nm.className = 'boardName'; nm.textContent = name;
    card.append(nm); return card;
  };
  container.append(mk('Work'), mk('Travel plans'));
  filterCards(container, 'WORK');
  const [work, travel] = container.querySelectorAll('.boardCard');
  assert.equal(work.hidden, false);
  assert.equal(travel.hidden, true);
});

test('helper-unreachable shows the note and still lists the open groups', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const note = makeEl('p');
  note.hidden = true;
  // Service worker never replies to boardData (host down): sendMessage's
  // callback fires with undefined. The open groups come from the live tab strip.
  globalThis.chrome = {
    runtime: { sendMessage: (msg, cb) => cb(msg.cmd === 'boardData' ? undefined : { ok: true }) },
    tabGroups: { query: async () => [{ id: 7, title: 'Work', color: 'blue', windowId: 1 }] },
    tabs: { query: async () => [{}, {}] },
  };
  await initNewtab({ container, note, search: makeEl('input') });
  assert.equal(note.hidden, false, 'the helper note is revealed');
  const texts = walk(container).map((n) => n.textContent);
  assert.ok(texts.includes('Work'), 'open group still rendered without the helper');
  assert.ok(texts.includes('Nothing parked yet'), 'parked section is empty without the helper');
});

test('helper reachable keeps the note hidden', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const note = makeEl('p');
  note.hidden = false;
  globalThis.chrome = { runtime: { sendMessage: (msg, cb) => cb(msg.cmd === 'boardData' ? FIXTURE : { ok: true }) } };
  await initNewtab({ container, note, search: makeEl('input') });
  assert.equal(note.hidden, true, 'the note stays hidden when the helper answered');
});

test('the Open side panel button opens the side panel for this window', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const panelBtn = makeEl('button');
  const panelNote = makeEl('p');
  panelNote.hidden = true;
  const opened = [];
  globalThis.chrome = {
    runtime: { sendMessage: (msg, cb) => cb(msg.cmd === 'boardData' ? FIXTURE : { ok: true }) },
    windows: { getCurrent: async () => ({ id: 42 }) },
    sidePanel: { open: async (opts) => { opened.push(opts); } },
  };
  await initNewtab({ container, note: makeEl('p'), search: makeEl('input'), panelBtn, panelNote });
  await panelBtn.dispatch('click');
  assert.deepEqual(opened, [{ windowId: 42 }], 'sidePanel.open called with the window id');
  assert.equal(panelNote.hidden, true, 'no fallback note on success');
});

test('Sort this group sends sortGroup then opens the side panel', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const sent = [];
  const opened = [];
  globalThis.chrome = {
    runtime: { sendMessage: (msg, cb) => { sent.push(msg.cmd); cb(msg.cmd === 'boardData' ? FIXTURE : { ok: true }); } },
    windows: { getCurrent: async () => ({ id: 5 }) },
    sidePanel: { open: async (opts) => { opened.push(opts); } },
  };
  await initNewtab({ container, note: makeEl('p'), search: makeEl('input'), panelBtn: makeEl('button'), panelNote: makeEl('p') });

  const sortBtn = walk(container).find((n) => n.textContent === 'Sort this group');
  assert.ok(sortBtn, 'the sort button rendered');
  await sortBtn.dispatch('click');
  assert.ok(sent.includes('sortGroup'), 'sortGroup command was sent');
  assert.deepEqual(opened, [{ windowId: 5 }], 'the side panel opened after sorting');
});

test('a side-panel open failure shows the fallback note', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const panelBtn = makeEl('button');
  const panelNote = makeEl('p');
  panelNote.hidden = true;
  globalThis.chrome = {
    runtime: { sendMessage: (msg, cb) => cb(msg.cmd === 'boardData' ? FIXTURE : { ok: true }) },
    windows: { getCurrent: async () => ({ id: 1 }) },
    sidePanel: { open: async () => { throw new Error('user gesture required'); } },
  };
  await initNewtab({ container, note: makeEl('p'), search: makeEl('input'), panelBtn, panelNote });
  await panelBtn.dispatch('click');
  assert.equal(panelNote.hidden, false, 'the fallback note is revealed');
});

test('openSidePanel returns false when sidePanel is missing', async () => {
  assert.equal(await openSidePanel({}), false, 'no sidePanel API');
  assert.equal(await openSidePanel({ sidePanel: {} }), false, 'no open()');
});
