// TASK 2 — a calmer, narrow-friendly side-panel header. The header holds only
// four parts (the Browser Sanity mark + name, the "Restore before sort" text
// button, the ⋯ button, and the gear); the version text moves out of the header
// to the top of the More view as "Browser Sanity <version_name or version>".
// Covers:
//   1. the header carries only those four parts (and no longer the version);
//   2. the "Restore before sort" button has the white-space: nowrap rule and
//      smaller text so it fits beside the name at 360px;
//   3. the More view shows the version from chrome.runtime.getManifest().
// Like the other side-panel suites, this drives the module with a hand-rolled
// fake DOM (no jsdom in this repo) rather than a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installChromeMock } from './helpers/chrome-mock.js';
import { initMainPanel } from '../extension/sidepanel/main-panel.js';

const html = readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../extension/sidepanel/sidepanel.css', import.meta.url), 'utf8');

// Index of a needle in the HTML, asserting it exists.
function at(needle) {
  const i = html.indexOf(needle);
  assert.ok(i !== -1, `${needle} exists`);
  return i;
}

// The header markup, from the opening tag to its close.
function headerSlice() {
  const start = at('class="appHeader"');
  const end = html.indexOf('</header>', start);
  assert.ok(end !== -1, 'the header closes');
  return html.slice(start, end);
}

// A CSS rule body for the given selector.
function rule(selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i !== -1, `${selector} rule exists`);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
}

// ---- 1. The header holds only the four parts, not the version ---------------

test('the header holds only the mark+name, Restore button, and gear', () => {
  const header = headerSlice();
  assert.ok(header.includes('class="brandMark"'), 'the Browser Sanity mark');
  assert.ok(header.includes('data-i18n="panelTitle"'), 'the Browser Sanity name');
  assert.ok(header.includes('id="headerUndoBtn"'), 'the Restore before sort button');
  assert.ok(!header.includes('id="openMore"'), 'no ⋯ button (More tools is in the panel now)');
  assert.ok(header.includes('id="openSettings"'), 'the gear');
  // The version no longer lives in the header.
  assert.ok(!header.includes('id="appVersion"'), 'the version is not in the header');
});

// ---- 2. The Restore button fits beside the name at 360px --------------------

test('the Restore before sort button has the no-wrap rule and smaller text', () => {
  const btn = rule('.headerTextBtn');
  assert.match(btn, /white-space:\s*nowrap/, 'the label stays on one line');
  const m = btn.match(/font-size:\s*(\d+)px/);
  assert.ok(m, 'the button sets a font size');
  assert.ok(Number(m[1]) <= 11, 'the text is small enough to fit beside the name');
});

// ---- 3. More tools shows the version from the manifest ----------------------

test('the version line sits in More tools as "Browser Sanity <version>"', () => {
  const moreStart = at('id="moreTools"');
  const versionIdx = at('id="appVersion"');
  assert.ok(versionIdx > moreStart, 'the version lives inside More tools');
  // The static markup prefixes the manifest value with "Browser Sanity".
  const slice = html.slice(moreStart, versionIdx + 40);
  assert.ok(/Browser Sanity\s*<span id="appVersion"/.test(slice), 'reads "Browser Sanity <version>"');
});

// ---- Fake DOM harness (mirrors the other side-panel suites) -----------------

function el(extra = {}) {
  const node = {
    attrs: {},
    classes: new Set(),
    hidden: false,
    textContent: '',
    value: '',
    dataset: {},
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    classList: {
      add: (c) => node.classes.add(c),
      remove: (c) => node.classes.delete(c),
      toggle: (c, f) => (f ? node.classes.add(c) : node.classes.delete(c)),
      contains: (c) => node.classes.has(c),
    },
    querySelectorAll: () => [],
    click() {},
    ...extra,
  };
  return node;
}

function harness(manifest) {
  const els = {
    appVersion: el(),
    modelsInUse: el(),
    scopeSegment: el({ querySelectorAll: () => [] }),
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
  globalThis.document = { body: { dataset: {} }, getElementById: (id) => els[id] || null };
  installChromeMock({ runtime: { id: 'ext', getManifest: () => manifest } });
  globalThis.chrome._store.sync.settings = {};
  return els;
}

test('the More view version fills in from chrome.runtime.getManifest() (version_name preferred)', () => {
  const els = harness({ version: '0.5.0', version_name: '0.5.0 Browser Sanity' });
  initMainPanel();
  assert.equal(els.appVersion.textContent, '0.5.0 Browser Sanity');
});

test('the More view version falls back to the bare version with no version_name', () => {
  const els = harness({ version: '0.6.0' });
  initMainPanel();
  assert.equal(els.appVersion.textContent, '0.6.0');
});
