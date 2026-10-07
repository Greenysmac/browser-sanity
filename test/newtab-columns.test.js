// TASK 3 — the new-tab page lays the compact board rows out in responsive
// columns (CSS grid, ~300px wide) under each section header, with the header
// holding only the title, the filter box and the "Open side panel" button.
// Covers:
//   1. the section is a CSS grid with auto-fill columns around 300px, so its
//      rows flow into columns, while the summary and empty line span full width;
//   2. the rendered rows sit inside the section's grid (as children of the
//      .boardSection), and the filter still hides the non-matching ones;
//   3. the header holds only the title, the filter and the Open side panel
//      button — nothing else.
// Like the other new-tab suite, there is no jsdom here, so the behavioural
// checks drive the module with a tiny fake document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initNewtab } from '../extension/newtab/newtab.js';

const css = readFileSync(new URL('../extension/newtab/newtab.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../extension/newtab/newtab.html', import.meta.url), 'utf8');

// --- fake DOM (same minimal surface the newtab suite uses) ------------------

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
    parent: null,
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) {
      this._text = String(v);
      if (v === '') this.children = [];
    },
    append(...kids) { for (const k of kids) { if (k) k.parent = this; } this.children.push(...kids); },
    appendChild(kid) { if (kid) kid.parent = this; this.children.push(kid); return kid; },
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    dispatch(ev) { if (this.listeners[ev]) return this.listeners[ev](); },
    querySelectorAll(sel) { return walk(this).filter((n) => matches(n, sel)); },
    querySelector(sel) { return walk(this).find((n) => matches(n, sel)) || null; },
  };
  return el;
}

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

// The declaration block for a selector, e.g. ".boardSection {\n ... \n}".
function block(selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i !== -1, `${selector} rule exists`);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  assert.ok(close !== -1, `${selector} rule closes`);
  return css.slice(open + 1, close);
}

// --- 1. the section is a column grid ----------------------------------------

test('the board section is a CSS grid of auto-fill columns about 300px wide', () => {
  const rule = block('.boardSection');
  assert.match(rule, /display:\s*grid/, 'the section is a grid');
  assert.match(rule, /grid-template-columns:\s*repeat\(\s*auto-fill\s*,\s*minmax\(\s*300px/, 'columns auto-fill at ~300px');
});

test('the summary and empty line span the full grid width', () => {
  assert.match(block('.boardSection > summary'), /grid-column:\s*1\s*\/\s*-1/, 'summary spans every column');
  assert.match(block('.boardEmpty'), /grid-column:\s*1\s*\/\s*-1/, 'the empty line spans every column');
});

// --- 2. rows render inside the grid and the filter still hides them ---------

test('rows render inside the section grid and the filter hides non-matching ones', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const search = makeEl('input');
  globalThis.chrome = { runtime: { sendMessage: (msg, cb) => cb(msg.cmd === 'boardData' ? FIXTURE : { ok: true }) } };
  await initNewtab({ container, note: makeEl('p'), search });

  // Every rendered row is a child of a .boardSection (the grid), not loose in
  // the container, so the grid lays them out as columns.
  const rows = container.querySelectorAll('.boardRow');
  assert.ok(rows.length >= 2, 'rows rendered');
  for (const row of rows) {
    assert.ok(row.parent && String(row.parent.className).split(/\s+/).includes('boardSection'), 'each row sits inside the section grid');
  }

  search.value = 'travel';
  search.dispatch('input');
  const byName = (n) => rows.find((c) => c.querySelector('.boardName').textContent === n);
  assert.equal(byName('Travel plans').hidden, false, 'the matching row stays visible');
  assert.equal(byName('Work').hidden, true, 'the non-matching row is hidden');
});

// --- 3. the header holds only the title, filter and Open side panel ---------

test('the page header holds only the title, the filter and the Open side panel button', () => {
  const start = html.indexOf('<header');
  const end = html.indexOf('</header>');
  assert.ok(start !== -1 && end !== -1 && start < end, 'the header exists');
  const header = html.slice(start, end);
  // The three expected controls are present.
  assert.match(header, /<h1>Browser Sanity<\/h1>/, 'the title is in the header');
  assert.match(header, /id="search"/, 'the filter box is in the header');
  assert.match(header, /id="openPanel"/, 'the Open side panel button is in the header');
  // and nothing else: exactly one element each, no stray controls.
  const tags = header.match(/<(h1|h2|input|button|a|select|textarea)\b/g) || [];
  assert.deepEqual(tags.sort(), ['<button', '<h1', '<input'], 'only the title, filter and button live in the header');
});
