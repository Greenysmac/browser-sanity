// TASK 5 — the redesigned main panel: one Sort card and one result line.
// Covers:
//   1. the top-to-bottom order of the parts in the static HTML
//      (header → sort card → result card → board → board actions → More tools);
//   2. planSummaryLine's text from a sample plan (tabs into groups + duplicates);
//   3. modelsInUseLine's "endpoint default" fallback for empty slots;
//   4. Review toggles the detailed suggestion list (reviewHidden class);
//   5. the "Selected tabs" segment routes the Sort button to sortSelected;
//   6. the header version text comes from the manifest (version_name preferred).
// Like the other side-panel suites, this drives the module with a hand-rolled
// fake DOM (no jsdom in this repo) rather than a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installChromeMock } from './helpers/chrome-mock.js';
import { planSummaryLine, modelsInUseLine } from '../extension/sidepanel/viewmodel.js';
import { initMainPanel, updateResultCard, isSelectedMode } from '../extension/sidepanel/main-panel.js';

const html = readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8');

// ---- 1. Order of the parts in the HTML --------------------------------------

test('the main panel parts appear top-to-bottom in order', () => {
  const idx = (needle) => {
    const i = html.indexOf(needle);
    assert.ok(i !== -1, `${needle} exists`);
    return i;
  };
  const header = idx('class="appHeader"');
  const version = idx('id="appVersion"');
  const sortCard = idx('id="sortCard"');
  const resultCard = idx('id="resultCard"');
  const board = idx('id="board"');
  const boardActions = idx('class="boardActions"');
  const moreTools = idx('id="moreTools"');
  assert.ok(header < version, 'version chip sits in the header');
  assert.ok(version < sortCard, 'header before the sort card');
  assert.ok(sortCard < resultCard, 'sort card before the result card');
  assert.ok(resultCard < board, 'result card before the board');
  assert.ok(board < boardActions, 'board before the board actions');
  assert.ok(boardActions < moreTools, 'board actions before More tools');
});

test('the segmented control offers the three scopes and the Sort button keeps id="run"', () => {
  assert.ok(html.includes('data-scope="window"'), 'This window segment');
  assert.ok(html.includes('data-scope="all"'), 'All windows segment');
  assert.ok(html.includes('data-scope="selected"'), 'Selected tabs segment');
  assert.ok(/<button[^>]*id="run"[^>]*>/.test(html), 'Sort button keeps id="run"');
});

test('Update index and Agent suggestions are the secondary buttons under the board', () => {
  const boardActions = html.indexOf('class="boardActions"');
  const after = html.slice(boardActions, boardActions + 400);
  assert.ok(after.includes('id="updateIndex"'), 'updateIndex under the board');
  assert.ok(after.includes('id="loadProposals"'), 'loadProposals under the board');
});

test('the command box and Open tabs live inside the closed <details> "More tools"', () => {
  const m = html.match(/<details[^>]*id="moreTools"[^>]*>/);
  assert.ok(m, 'moreTools details tag exists');
  assert.ok(!/\bopen\b/.test(m[0]), 'More tools is collapsed by default');
  const start = html.indexOf('id="moreTools"');
  const end = html.indexOf('</details>', html.indexOf('id="tabsPanel"'));
  const inside = html.slice(start, end);
  assert.ok(inside.includes('id="commandPanel"'), 'command box inside More tools');
  assert.ok(inside.includes('id="tabsPanel"'), 'Open tabs inside More tools');
});

// ---- 2 & 3. Pure summary / models lines -------------------------------------

test('planSummaryLine reports tabs moved into groups and duplicates closed', () => {
  const plan = [
    { action: 'groupTabs', data: { tabIds: Array.from({ length: 400 }, (_, i) => i) } },
    { action: 'groupTabs', data: { tabIds: Array.from({ length: 12 }, (_, i) => 400 + i) } },
    ...Array.from({ length: 37 }, (_, i) => ({ action: 'closeTab', data: { tabId: i } })),
  ];
  // 400 + 12 = 412 tabs across 2 groups... build a 14-group variant to match the spec wording.
  const groups = Array.from({ length: 14 }, (_, g) => ({ action: 'groupTabs', data: { tabIds: Array.from({ length: g === 0 ? 412 - 13 : 1 }, () => 0) } }));
  const closes = Array.from({ length: 37 }, (_, i) => ({ action: 'closeTab', data: { tabId: i } }));
  assert.equal(planSummaryLine([...groups, ...closes]), 'Move 412 tabs into 14 groups, close 37 duplicates');
  // The simple two-group case still reads cleanly.
  assert.equal(planSummaryLine(plan), 'Move 412 tabs into 2 groups, close 37 duplicates');
});

test('planSummaryLine omits a zero clause and is empty for an empty plan', () => {
  assert.equal(planSummaryLine([]), '');
  assert.equal(planSummaryLine([{ action: 'groupTabs', data: { tabIds: [1, 2] } }]), 'Move 2 tabs into 1 group');
  assert.equal(planSummaryLine([{ action: 'closeTab', data: { tabId: 1 } }]), 'close 1 duplicate');
});

test('modelsInUseLine names both slots and falls back to "endpoint default"', () => {
  assert.equal(modelsInUseLine('Sonnet 5.5', 'Haiku 4.5'), 'Big sorts: Sonnet 5.5 · Quick jobs: Haiku 4.5');
  assert.equal(modelsInUseLine('', ''), 'Big sorts: endpoint default · Quick jobs: endpoint default');
  assert.equal(modelsInUseLine('Opus', ''), 'Big sorts: Opus · Quick jobs: endpoint default');
});

// ---- Fake DOM harness --------------------------------------------------------

function el(extra = {}) {
  const node = {
    attrs: {},
    classes: new Set(),
    hidden: false,
    textContent: '',
    value: '',
    dataset: {},
    children: [],
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    classList: {
      add: (c) => node.classes.add(c),
      remove: (c) => node.classes.delete(c),
      toggle: (c, force) => { if (force) node.classes.add(c); else node.classes.delete(c); },
      contains: (c) => node.classes.has(c),
    },
    click() { if (this.listeners.click) this.listeners.click({ preventDefault() {}, stopImmediatePropagation() {} }); },
    ...extra,
  };
  return node;
}

function makeHarness({ manifest = {}, settings = {} } = {}) {
  const seg = (scope) => el({ dataset: { scope } });
  const segBtns = [seg('window'), seg('all'), seg('selected')];
  const scopeSegment = el({ querySelectorAll: () => segBtns });
  let sortSelectedClicks = 0;
  const sortSelected = el({ click() { sortSelectedClicks++; } });
  let approveAllClicks = 0;
  const approveAll = el({ click() { approveAllClicks++; } });

  const els = {
    appVersion: el(),
    modelsInUse: el(),
    scopeSegment,
    scope: el({ value: 'window' }),
    run: el(),
    sortSelected,
    approveAll,
    resultApply: el(),
    resultCard: el({ hidden: true }),
    resultSummary: el(),
    reviewToggle: el(),
    plan: el(),
    planTools: el(),
    planActions: el(),
    summary: el(),
  };
  globalThis.document = { getElementById: (id) => els[id] || null };
  installChromeMock({
    runtime: { id: 'ext', getManifest: () => manifest },
  });
  globalThis.chrome._store.sync.settings = settings;
  return { els, segBtns, info: () => ({ sortSelectedClicks, approveAllClicks }) };
}

// ---- 4. Review toggles the suggestion list -----------------------------------

test('Review toggles the detailed suggestion list, hidden by default', async () => {
  const { els } = makeHarness();
  initMainPanel();
  // Initially hidden: the list, its toolbar, actions, and summary carry reviewHidden.
  for (const id of ['plan', 'planTools', 'planActions', 'summary']) {
    assert.ok(els[id].classes.has('reviewHidden'), `${id} hidden before Review`);
  }
  assert.equal(els.reviewToggle.getAttribute('aria-expanded'), 'false');

  els.reviewToggle.listeners.click();
  for (const id of ['plan', 'planTools', 'planActions', 'summary']) {
    assert.ok(!els[id].classes.has('reviewHidden'), `${id} shown after Review`);
  }
  assert.equal(els.reviewToggle.getAttribute('aria-expanded'), 'true');

  els.reviewToggle.listeners.click();
  assert.ok(els.plan.classes.has('reviewHidden'), 'Review toggles the list back off');
});

// ---- 5. "Selected tabs" segment routes the Sort button to sortSelected -------

test('the Selected tabs segment makes the Sort button run sortSelected', () => {
  const { els, segBtns, info } = makeHarness();
  initMainPanel();
  assert.equal(isSelectedMode(), false, 'defaults to This window');

  // Pick "Selected tabs".
  segBtns[2].listeners.click();
  assert.equal(isSelectedMode(), true);
  assert.equal(segBtns[2].getAttribute('aria-pressed'), 'true');
  assert.equal(segBtns[0].getAttribute('aria-pressed'), 'false');

  // Clicking the Sort button now fires sortSelected (capture handler intercepts).
  els.run.listeners.click({ preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(info().sortSelectedClicks, 1, 'Sort button invoked sortSelected');

  // Switching back to "This window" leaves selected mode and drives the scope select.
  segBtns[0].listeners.click();
  assert.equal(isSelectedMode(), false);
  assert.equal(els.scope.value, 'window');
  segBtns[1].listeners.click();
  assert.equal(els.scope.value, 'all', 'All windows sets the hidden scope select');
});

// ---- 6. Header version comes from the manifest ------------------------------

test('the header version text comes from the manifest (version_name preferred)', () => {
  const { els } = makeHarness({ manifest: { version: '0.2.2', version_name: '0.2.2 Browser Sanity' } });
  initMainPanel();
  assert.equal(els.appVersion.textContent, '0.2.2 Browser Sanity');
});

test('the header version falls back to version when no version_name', () => {
  const { els } = makeHarness({ manifest: { version: '0.3.0' } });
  initMainPanel();
  assert.equal(els.appVersion.textContent, '0.3.0');
});

// ---- Result card wiring ------------------------------------------------------

test('updateResultCard shows one summary line and hides for an empty plan', () => {
  const { els } = makeHarness();
  initMainPanel();
  updateResultCard([
    { action: 'groupTabs', data: { tabIds: [1, 2, 3] } },
    { action: 'closeTab', data: { tabId: 9 } },
  ]);
  assert.equal(els.resultCard.hidden, false);
  assert.equal(els.resultSummary.textContent, 'Move 3 tabs into 1 group, close 1 duplicate');

  updateResultCard([]);
  assert.equal(els.resultCard.hidden, true, 'result card hidden with nothing to apply');
});

test('the result Apply button triggers the existing apply-all path', () => {
  const { els, info } = makeHarness();
  initMainPanel();
  els.resultApply.listeners.click();
  assert.equal(info().approveAllClicks, 1, 'Apply reuses approveAll');
});
