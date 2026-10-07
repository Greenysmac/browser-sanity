// TASK 2 — the main view shows only Sort, the result card, and the board; the
// board tools, "More tools", sessions, and the muted list live in a separate
// "More" view opened by the header's ⋯ button (built like the Settings view).
// Covers:
//   1. the main view's surfaces: the sort card, result card, and board sit
//      outside the #moreView container; the moved parts sit inside it;
//   2. the ⋯ button switches to the More view (body[data-view="more"]) and
//      "Done" returns to the main view;
//   3. the connection status line (#health) hides when connected and shows on
//      an error.
// Like the other side-panel suites, this drives the modules with a hand-rolled
// fake DOM (no jsdom in this repo) rather than a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installChromeMock } from './helpers/chrome-mock.js';
import { initMainPanel } from '../extension/sidepanel/main-panel.js';
import { checkHealth } from '../extension/sidepanel/health-view.js';

const html = readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8');

// Index of a needle in the HTML, asserting it exists.
function at(needle) {
  const i = html.indexOf(needle);
  assert.ok(i !== -1, `${needle} exists`);
  return i;
}

// Slice between the #moreView open tag and its matching close: everything moved
// into the More view sits here. The container is the last top-level <section>
// before the Settings tools block, so slice to the "tools" section start.
function moreViewSlice() {
  const start = at('id="moreView"');
  const end = at('class="tools"');
  assert.ok(start < end, 'moreView precedes the settings tools section');
  return html.slice(start, end);
}

// ---- 1. The main view holds only Sort, the result card, and the board --------

test('the sort card, result card, and board sit in the main view (outside #moreView)', () => {
  const moreStart = at('id="moreView"');
  for (const id of ['id="sortCard"', 'id="resultCard"', 'id="board"']) {
    assert.ok(at(id) < moreStart, `${id} is in the main view, before #moreView`);
  }
});

test('the header carries the undo, ⋯, and gear buttons', () => {
  const header = at('class="appHeader"');
  const headerEnd = at('class="heroControls"');
  const h = html.slice(header, headerEnd);
  assert.ok(h.includes('id="headerUndoBtn"'), 'undo button in the header');
  assert.ok(h.includes('id="openMore"'), 'the ⋯ (More) button in the header');
  assert.ok(h.includes('id="openSettings"'), 'the gear in the header');
});

test('Update index, Agent suggestions, More tools, sessions, and the muted list move into #moreView', () => {
  const inside = moreViewSlice();
  for (const id of ['id="updateIndex"', 'id="loadProposals"', 'id="moreTools"', 'id="sessions"', 'id="mutedPanel"']) {
    assert.ok(inside.includes(id), `${id} lives inside the More view`);
  }
  // The command box, Open tabs, and the Run-one row come along inside More tools.
  assert.ok(inside.includes('id="commandPanel"'), 'command box inside the More view');
  assert.ok(inside.includes('id="tabsPanel"'), 'Open tabs inside the More view');
  assert.ok(inside.includes('id="runOne"'), 'Run one inside the More view');
});

test('the More view has a Done button at the top, like the Settings view', () => {
  const inside = moreViewSlice();
  assert.ok(inside.includes('id="moreDone"'), 'moreDone button exists');
  const done = inside.indexOf('id="moreDone"');
  const firstMoved = inside.indexOf('id="updateIndex"');
  assert.ok(done !== -1 && firstMoved !== -1, 'both exist');
  assert.ok(done < firstMoved, 'Done sits above the moved tools');
});

test('each moved id appears exactly once in the HTML (no duplicate wiring)', () => {
  for (const id of ['id="moreTools"', 'id="sessions"', 'id="mutedPanel"', 'id="updateIndex"', 'id="loadProposals"', 'id="runOne"', 'id="showUndo"']) {
    const count = html.split(id).length - 1;
    assert.equal(count, 1, `${id} appears once`);
  }
});

// ---- Fake DOM harness (mirrors the other side-panel suites) ------------------

function el(extra = {}) {
  const node = {
    children: [],
    classes: new Set(),
    attrs: {},
    value: '',
    hidden: false,
    textContent: '',
    style: {},
    listeners: {},
    dataset: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    querySelectorAll() { return []; },
    classList: {
      add: (c) => node.classes.add(c),
      remove: (c) => node.classes.delete(c),
      toggle: (c, on) => (on ? node.classes.add(c) : node.classes.delete(c)),
    },
    ...extra,
  };
  return node;
}

// ---- 2. The ⋯ button switches to the More view and Done returns --------------

test('the ⋯ button switches to the More view and Done returns to the main view', () => {
  const openMore = el();
  const moreDone = el();
  const els = {
    appVersion: el(),
    modelsInUse: el(),
    openMore,
    moreDone,
    scopeSegment: el(),
    scope: el({ value: 'window' }),
    run: el(),
    sortSelected: el(),
    approveAll: el(),
    resultApply: el(),
    reviewToggle: el(),
    plan: el(),
    planTools: el(),
    planActions: el(),
    summary: el(),
  };
  const body = { dataset: {} };
  globalThis.document = { body, getElementById: (id) => els[id] || null };
  installChromeMock({ runtime: { id: 'ext', getManifest: () => ({}) } });
  globalThis.chrome._store.sync.settings = {};

  initMainPanel();
  openMore.listeners.click();
  assert.equal(body.dataset.view, 'more', 'the ⋯ opens the More view');

  moreDone.listeners.click();
  assert.equal(body.dataset.view, 'main', 'Done returns to the main view');
});

// ---- 3. The connection status line hides when connected, shows on error ------

function healthHarness() {
  const els = {
    health: el(),
    hostUpdate: el(),
    run: { disabled: false },
    runOne: { querySelectorAll: () => [] },
    commandInput: { disabled: false },
    commandForm: { querySelector: () => ({ disabled: false }) },
    onboarding: { hidden: false },
    planEmptyState: { hidden: false },
    installCmd: { textContent: '' },
  };
  globalThis.document = { getElementById: (id) => els[id] || null };
  return els;
}

test('the connection status line hides when the backend is connected', async () => {
  const els = healthHarness();
  installChromeMock({
    runtime: {
      id: 'ext',
      sendMessage(msg, cb) { cb({ health: { ready: true, adapter: 'claude', version: 'ok' } }); },
    },
  });
  await checkHealth();
  assert.equal(els.health.hidden, true, 'status line hidden when all is well');
});

test('the connection status line shows when the backend is unreachable', async () => {
  const els = healthHarness();
  installChromeMock({
    runtime: {
      id: 'ext',
      sendMessage(msg, cb) { cb({ health: { ready: false, adapter: 'claude', error: 'Native host disconnected' } }); },
    },
  });
  await checkHealth();
  assert.equal(els.health.hidden, false, 'status line shows on an error');
  assert.ok(els.health.textContent.length > 0, 'and carries guidance text');
});
