// The connection status line (#health) hides when connected and shows on an
// error. (This suite once covered the ⋯ More view too; 0.10.0 folded that view
// into the main panel, and ask-box.test.js pins the new layout.)
// Like the other side-panel suites, this drives the module with a hand-rolled
// fake DOM (no jsdom in this repo) rather than a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeMock } from './helpers/chrome-mock.js';
import { checkHealth } from '../extension/sidepanel/health-view.js';

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

// ---- 3. The connection status line hides when connected, shows on error ------

function healthHarness() {
  const els = {
    health: el(),
    hostUpdate: el(),
    run: { disabled: false },
    putMine: { disabled: false },
    suggestGroups: { disabled: false },
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
