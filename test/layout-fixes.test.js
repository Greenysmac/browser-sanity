// TASK 2 — small layout fixes from the user's screenshot. Covers:
//   1. the new-tab header lays out title → filter → "Open side panel" button,
//      in that DOM order, with the filter flexing to fill the row;
//   2. both the "Open now" and "Parked" new-tab sections are .boardSection
//      elements, so the shared auto-fill grid rule lays each out in columns and
//      truncates long names to one line;
//   3. the side-panel result card clears and hides after an apply (the plan
//      goes empty) and whenever the plan is empty;
//   4. the main side-panel view no longer renders a stray Settings section — the
//      Settings panel is hidden by default and revealed only in the gear's view,
//      while keeping the #settings element id the settings view depends on.
// Like the other side-panel/new-tab suites there is no jsdom, so the behavioural
// checks drive the modules with a tiny fake DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installChromeMock } from './helpers/chrome-mock.js';
import { initNewtab } from '../extension/newtab/newtab.js';
import { initMainPanel, updateResultCard } from '../extension/sidepanel/main-panel.js';

const newtabHtml = readFileSync(new URL('../extension/newtab/newtab.html', import.meta.url), 'utf8');
const newtabCss = readFileSync(new URL('../extension/newtab/newtab.css', import.meta.url), 'utf8');
const panelHtml = readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8');
const panelCss = readFileSync(new URL('../extension/sidepanel/sidepanel.css', import.meta.url), 'utf8');

// --- 1. the new-tab header order --------------------------------------------

test('the new-tab header orders title, then filter, then the Open side panel button', () => {
  const start = newtabHtml.indexOf('<header');
  const end = newtabHtml.indexOf('</header>');
  assert.ok(start !== -1 && end !== -1 && start < end, 'the header exists');
  const header = newtabHtml.slice(start, end);
  const title = header.indexOf('<h1>Browser Sanity</h1>');
  const filter = header.indexOf('id="search"');
  const button = header.indexOf('id="openPanel"');
  assert.ok(title !== -1 && filter !== -1 && button !== -1, 'all three controls are present');
  assert.ok(title < filter, 'the title comes before the filter');
  assert.ok(filter < button, 'the filter comes before the Open side panel button');
});

test('the filter field flexes to take the remaining width', () => {
  const i = newtabCss.indexOf('.search {');
  assert.ok(i !== -1, '.search rule exists');
  const rule = newtabCss.slice(newtabCss.indexOf('{', i) + 1, newtabCss.indexOf('}', i));
  assert.match(rule, /flex:\s*1/, 'the filter grows to fill the row');
});

// --- 2. both sections share the auto-fill column grid -----------------------

function block(css, selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i !== -1, `${selector} rule exists`);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

test('the shared .boardSection rule is an auto-fill column grid, one-line names', () => {
  const section = block(newtabCss, '.boardSection::details-content'); // grid lives on the content slot (real Chrome)
  assert.match(section, /display:\s*grid/, 'the section is a grid');
  assert.match(
    section,
    /grid-template-columns:\s*repeat\(\s*auto-fill\s*,\s*minmax\(\s*300px\s*,\s*1fr\s*\)\s*\)/,
    'columns fill the width at repeat(auto-fill, minmax(300px, 1fr))',
  );
  const name = block(newtabCss, '.boardName');
  assert.match(name, /text-overflow:\s*ellipsis/, 'long names truncate with an ellipsis');
  assert.match(name, /white-space:\s*nowrap/, 'names stay on one line');
});

// Parked groups read like a Kanban column on the new-tab page: CSS columns fill
// each column top to bottom before the next, so dragging a group moves it up or
// down a stack instead of left to right across a grid row.
test('the new-tab Parked section fills columns top to bottom, not grid rows', () => {
  const parked = block(newtabCss, '.boardSection--parked::details-content');
  assert.match(parked, /display:\s*block/, 'not a grid (a grid fills left to right)');
  assert.match(parked, /columns:\s*300px/, 'columns about 300px wide, like the Open now grid');
  const row = block(newtabCss, '.boardSection--parked .boardRow');
  assert.match(row, /break-inside:\s*avoid/, 'a group card never splits across two columns');
  const empty = block(newtabCss, '.boardSection--parked .boardEmpty');
  assert.match(empty, /column-span:\s*all/, 'the empty line spans every column');
});

// Fake DOM shared by the new-tab behavioural check (same minimal surface the
// other new-tab suites use).
function makeEl(tag) {
  const el = {
    tagName: String(tag || '').toUpperCase(),
    children: [],
    className: '',
    type: '',
    value: '',
    open: false,
    hidden: false,
    style: {},
    listeners: {},
    parent: null,
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); if (v === '') this.children = []; },
    append(...kids) { for (const k of kids) { if (k) k.parent = this; } this.children.push(...kids); },
    appendChild(kid) { if (kid) kid.parent = this; this.children.push(kid); return kid; },
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    dispatch(ev) { if (this.listeners[ev]) return this.listeners[ev](); },
    querySelectorAll(sel) { return walk(this).filter((n) => cls(n, sel)); },
    querySelector(sel) { return walk(this).find((n) => cls(n, sel)) || null; },
  };
  return el;
}
function cls(el, sel) { return sel.startsWith('.') && String(el.className || '').split(/\s+/).includes(sel.slice(1)); }
function walk(el, out = []) { if (!el) return out; out.push(el); for (const kid of el.children || []) walk(kid, out); return out; }

const FIXTURE = {
  ok: true,
  open: [{ groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 3 }],
  parked: [{ name: 'Reading', color: 'red', tabCount: 4, lastSeen: '2026-01-02T10:00:00.000Z' }],
  descriptions: [],
};

test('the Open now and Parked rows both render inside .boardSection grids', async () => {
  globalThis.document = { createElement: (tag) => makeEl(tag) };
  const container = makeEl('div');
  globalThis.chrome = { runtime: { sendMessage: (msg, cb) => cb(msg.cmd === 'boardData' ? FIXTURE : { ok: true }) } };
  await initNewtab({ container, note: makeEl('p'), search: makeEl('input') });
  const byName = (n) => walk(container).find((e) => e.className === 'boardName' && e.textContent === n);
  const inSection = (name) => {
    const row = byName(name) && byName(name).parent;
    return !!(row && row.parent && String(row.parent.className).split(/\s+/).includes('boardSection'));
  };
  assert.ok(inSection('Work'), 'the open-group row sits inside a .boardSection grid');
  assert.ok(inSection('Reading'), 'the parked-group row sits inside a .boardSection grid');
});

// --- 3 & 4. side-panel result card + no stray Settings section --------------

function panelEl(extra = {}) {
  const node = {
    attrs: {}, classes: new Set(), hidden: false, textContent: '', value: '', dataset: {},
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    classList: { add(c) { node.classes.add(c); }, remove(c) { node.classes.delete(c); }, toggle(c, f) { if (f) node.classes.add(c); else node.classes.delete(c); }, contains(c) { return node.classes.has(c); } },
    querySelectorAll: () => [],
    click() {},
    ...extra,
  };
  return node;
}

function panelHarness() {
  const els = {
    appVersion: panelEl(), modelsInUse: panelEl(),
    scopeSegment: panelEl({ querySelectorAll: () => [] }), scope: panelEl({ value: 'window' }),
    run: panelEl(), sortSelected: panelEl(), approveAll: panelEl(), resultApply: panelEl(),
    resultCard: panelEl({ hidden: false }), resultSummary: panelEl(), resultCount: panelEl(),
    reviewToggle: panelEl(), plan: panelEl(), planTools: panelEl(), planActions: panelEl(), summary: panelEl(),
  };
  globalThis.document = { body: { dataset: {} }, getElementById: (id) => els[id] || null };
  installChromeMock({ runtime: { id: 'ext', getManifest: () => ({}) } });
  return els;
}

test('the result card clears and hides after an apply empties the plan', () => {
  const els = panelHarness();
  initMainPanel();
  // A completed scan shows the card…
  updateResultCard([
    { action: 'groupTabs', data: { tabIds: [1, 2, 3] } },
    { action: 'closeTab', data: { tabId: 9 } },
  ]);
  assert.equal(els.resultCard.hidden, false, 'the card is shown while there is a plan');
  assert.ok(els.resultSummary.textContent.length > 0, 'the card has its summary line');

  // …and Apply drains the plan, so the next render hides and clears the card.
  updateResultCard([]);
  assert.equal(els.resultCard.hidden, true, 'the card hides once the plan is empty');
  assert.equal(els.resultSummary.textContent, '', 'the summary line is cleared');
  assert.equal(els.resultCount.textContent, '', 'the count is cleared');
});

test('the main view does not render a Settings section (gear only), keeping #settings', () => {
  // The redundant "Settings" header is gone from the main-view markup…
  assert.ok(!panelHtml.includes('class="toolsHead"'), 'no stray Settings header in the main view');
  // …but the Settings panel element the settings view toggles still exists…
  assert.ok(panelHtml.includes('id="settings"'), 'the #settings element is kept');
  // …and the CSS hides the Settings panel by default, revealing it only in the gear's view.
  assert.match(panelCss, /\.tools\s*\{\s*display:\s*none/, 'the Settings panel is hidden by default');
  assert.match(panelCss, /body\[data-view="settings"\]\s*\.tools\s*\{\s*display:\s*block/, 'the gear view reveals the Settings panel');
});
