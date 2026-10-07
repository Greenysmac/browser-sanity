// TASK 4 — the panel cleanup after the first 0.3.0 look. Covers:
//   1. the main button i18n message now reads "Sort tabs" (no stale wording);
//   2. friendly display names for the known Claude model ids (raw ids pass through),
//      flowing into modelsInUseLine;
//   3. the model pickers are one <select> per slot with a trailing "Other…" option
//      that reveals a single custom-id text field and writes to the right slot;
//   4. the "Run one" row lives inside the collapsed "More tools" <details>;
//   5. the gear switches to the Settings view (body[data-view]) and "Done" returns.
// Like the other side-panel suites, this drives the modules with a hand-rolled
// fake DOM (no jsdom in this repo) rather than a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installChromeMock } from './helpers/chrome-mock.js';
import { modelDisplayName, modelsInUseLine } from '../extension/sidepanel/viewmodel.js';
import { initSettingsView } from '../extension/sidepanel/settings-view.js';

const html = readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8');
const messages = JSON.parse(readFileSync(new URL('../extension/_locales/en/messages.json', import.meta.url), 'utf8'));

// ---- 1. The main button label message ---------------------------------------

test('the analyzeButton i18n message reads "Sort tabs" (no stale wording)', () => {
  assert.equal(messages.analyzeButton.message, 'Sort tabs');
  const json = JSON.stringify(messages);
  assert.ok(!/Analyze my tabs & bookmarks/.test(json), 'no "Analyze my tabs & bookmarks" wording');
  assert.ok(!/Browser Organizer/.test(json), 'no "Browser Organizer" wording in user-visible text');
});

// ---- 2. Friendly model names -------------------------------------------------

test('modelDisplayName maps known Claude ids to friendly names, passes others through', () => {
  assert.equal(modelDisplayName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelDisplayName('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(modelDisplayName('claude-haiku-4-5'), 'Haiku 4.5');
  assert.equal(modelDisplayName('gpt-4o-mini'), 'gpt-4o-mini');
  assert.equal(modelDisplayName(''), '');
});

test('modelsInUseLine shows friendly names for known Claude ids', () => {
  assert.equal(
    modelsInUseLine('claude-sonnet-5-5', 'claude-haiku-4-5'),
    'Big sorts: Sonnet 5.5 · Quick jobs: Haiku 4.5',
  );
  assert.equal(
    modelsInUseLine('claude-opus-5-5', ''),
    'Big sorts: Opus 5.5 · Quick jobs: endpoint default',
  );
});

// ---- 4. "Run one" is inside the collapsed "More tools" details ---------------

test('the "Run one" row lives inside the collapsed "More tools" details', () => {
  const m = html.match(/<details[^>]*id="moreTools"[^>]*>/);
  assert.ok(m, 'moreTools details tag exists');
  assert.ok(!/\bopen\b/.test(m[0]), 'More tools is collapsed by default');
  const start = html.indexOf('id="moreTools"');
  const runOne = html.indexOf('id="runOne"');
  // The first </details> after runOne closes More tools; runOne must sit before it.
  const closeMore = html.indexOf('</details>', runOne);
  assert.ok(start !== -1 && runOne !== -1, 'both ids exist');
  assert.ok(start < runOne, 'Run one appears after the More tools open tag');
  assert.ok(runOne < closeMore, 'Run one sits inside the More tools details');
});

test('the model slots are one <select> each with a hidden custom-id text field', () => {
  // Exactly one select per slot and the slot name lives on the (now hidden) input.
  assert.ok(html.includes('id="bigModelSelect"'), 'big-sort select');
  assert.ok(html.includes('id="quickModelSelect"'), 'quick-job select');
  assert.ok(/id="bigModelOtherRow"[^>]*hidden/.test(html), 'big custom row hidden by default');
  assert.ok(/id="quickModelOtherRow"[^>]*hidden/.test(html), 'quick custom row hidden by default');
  assert.ok(html.includes('name="bigModel"'), 'bigModel saved field');
  assert.ok(html.includes('name="quickModel"'), 'quickModel saved field');
  // The old free-text-plus-datalist pairing is gone.
  assert.ok(!html.includes('id="bigModelList"'), 'no leftover big datalist');
  assert.ok(!html.includes('id="quickModelList"'), 'no leftover quick datalist');
});

// ---- Fake DOM harness (mirrors settings-redesign.test.js) --------------------

function el(extra = {}) {
  const node = {
    children: [],
    value: '',
    hidden: false,
    checked: false,
    textContent: '',
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    focus() { this.focused = true; },
    get firstChild() { return this.children[0] || null; },
    ...extra,
  };
  return node;
}

function makeHarness() {
  const form = {
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    adapter: { value: 'claude', addEventListener() {}, selectedOptions: [{ text: 'Claude Code' }] },
    openaiBaseUrl: { value: '', disabled: false },
    openaiModel: { value: '' },
    bigModel: el(),
    quickModel: el(),
    extraArgs: { value: '' },
    querySelectorAll() { return []; },
    get provider() { return { get value() { return 'claude'; } }; },
  };
  const els = {
    settingsForm: form,
    adapterNote: el(),
    adapterRow: el(),
    apiKeyConfig: el(),
    openaiConfig: el(),
    extraArgsAdapter: el(),
    openaiApiKey: { value: '', placeholder: '', type: 'password' },
    openaiKeyClear: { disabled: false, addEventListener() {} },
    openaiKeyShow: { addEventListener() {} },
    bigModelSelect: el(),
    quickModelSelect: el(),
    bigModelOtherRow: el({ hidden: true }),
    quickModelOtherRow: el({ hidden: true }),
    loadModels: el(),
    settingsDone: el(),
    openSettings: el(),
    settings: { open: false, scrollIntoView() {} },
    status: { textContent: '', classList: { add() {}, remove() {} }, offsetWidth: 0 },
    statusText: { textContent: '' },
    statusClock: { textContent: '' },
  };
  const body = { dataset: {} };
  globalThis.document = {
    body,
    getElementById: (id) => els[id] || null,
    createElement: () => el(),
  };
  return { form, els, body };
}

// ---- 3. One select + "Other…" reveals the custom field and saves correctly ---

test('picking a listed model writes it into the slot and keeps the custom field hidden', () => {
  installChromeMock();
  const { form, els } = makeHarness();
  initSettingsView();

  els.bigModelSelect.listeners.change({ target: { value: 'claude-opus-5-5' } });
  assert.equal(form.bigModel.value, 'claude-opus-5-5');
  assert.equal(els.bigModelOtherRow.hidden, true, 'custom field stays hidden for a listed id');

  els.quickModelSelect.listeners.change({ target: { value: 'claude-haiku-4-5' } });
  assert.equal(form.quickModel.value, 'claude-haiku-4-5');
  assert.equal(els.quickModelOtherRow.hidden, true);
});

test('picking "Other…" reveals the slot\'s custom-id field and leaves the saved value for typing', () => {
  installChromeMock();
  const { form, els } = makeHarness();
  initSettingsView();

  els.bigModelSelect.listeners.change({ target: { value: '__other__' } });
  assert.equal(els.bigModelOtherRow.hidden, false, 'big custom field revealed');
  assert.equal(form.bigModel.focused, true, 'the custom input is focused for typing');

  // The custom field is the saved slot (name="bigModel"); typing a custom id lands there.
  form.bigModel.value = 'my-custom-model';
  assert.equal(form.bigModel.value, 'my-custom-model');

  // The other slot is independent.
  els.quickModelSelect.listeners.change({ target: { value: '__other__' } });
  assert.equal(els.quickModelOtherRow.hidden, false);
  assert.equal(els.bigModelOtherRow.hidden, false, 'the big slot stays revealed');
});

// ---- 5. The gear switches views and Done returns -----------------------------

test('the gear switches to the Settings view and Done returns to the main view', () => {
  installChromeMock();
  const { els, body } = makeHarness();
  initSettingsView();

  els.openSettings.listeners.click();
  assert.equal(body.dataset.view, 'settings', 'gear switches to the settings view');
  assert.equal(els.settings.open, true, 'settings panel opens in its view');

  els.settingsDone.listeners.click();
  assert.equal(body.dataset.view, 'main', 'Done returns to the main view');
  assert.equal(els.settings.open, false, 'settings panel closes on Done');
});
