// The redesigned Settings area (TASK 4): AI first, plain choices.
// Covers four things:
//   1. the order of the sections in the static HTML (AI → What to suggest →
//      More → Advanced), read straight from sidepanel.html;
//   2. which fields show/hide per "Runs on" provider (API key for poe/openrouter/
//      openai; base URL for local and 'other'→openai);
//   3. the model pickers writing their choice into bigModel / quickModel;
//   4. "Load models" filling both pickers from a faked listModels response.
// Like settings-view.test.js, this drives the panel module with a hand-rolled
// fake DOM (no jsdom in this repo) rather than a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installChromeMock } from './helpers/chrome-mock.js';
import { initSettingsView } from '../extension/sidepanel/settings-view.js';

const html = readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8');

// ---- 1. Section order in the HTML --------------------------------------------

test('settings sections appear in order: AI → What to suggest → More → Advanced', () => {
  const ai = html.indexOf('<legend>AI</legend>');
  const suggest = html.indexOf('<legend>What to suggest</legend>');
  const more = html.indexOf('id="moreSettings"');
  const advanced = html.indexOf('class="advanced"');
  assert.ok(ai !== -1 && suggest !== -1 && more !== -1 && advanced !== -1, 'all four sections exist');
  assert.ok(ai < suggest, 'AI comes before What to suggest');
  assert.ok(suggest < more, 'What to suggest comes before More');
  assert.ok(more < advanced, 'More comes before Advanced');
});

test('"More" is a closed <details> (no open attribute on its tag)', () => {
  const m = html.match(/<details[^>]*id="moreSettings"[^>]*>/);
  assert.ok(m, 'moreSettings details tag exists');
  assert.ok(!/\bopen\b/.test(m[0]), 'moreSettings is collapsed by default');
});

// TASK 3: grouping is always on, and "Re-sort tabs already in groups" and
// "Close duplicate tabs" are now Sort-card actions — none of the three switches
// appear in Settings anymore.
test('Settings no longer shows the group-tabs, re-sort, or close-duplicates switches', () => {
  assert.ok(!/name="groupTabs"/.test(html), 'no "Group tabs by your needs" switch');
  assert.ok(!/name="regroupExisting"/.test(html), 'no "Re-sort tabs already in groups" switch');
  assert.ok(!/name="dupeTabs"/.test(html), 'no "Close duplicate tabs" switch');
  assert.ok(!/Group tabs by your needs/.test(html), 'no stale "Group tabs by your needs" label');
});

// ---- Fake DOM harness --------------------------------------------------------

// A tiny element supporting the DOM ops settings-view uses to build options
// without innerHTML (createElement/appendChild/removeChild/firstChild) plus
// value/hidden/checked and a captured change listener.
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
    get firstChild() { return this.children[0] || null; },
    ...extra,
  };
  return node;
}

// Build the provider radios + model selects + the elements settings-view touches,
// and install a document whose createElement makes fake <option>s.
function makeHarness() {
  const providerValues = ['claude', 'poe', 'openrouter', 'openai', 'local', 'other'];
  const providerRadios = providerValues.map((v) => el({ name: 'provider', value: v, type: 'radio' }));

  const form = {
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    adapter: { value: 'claude', addEventListener() {}, selectedOptions: [{ text: 'Claude Code' }] },
    openaiBaseUrl: { value: '', disabled: false },
    openaiModel: { value: '' },
    bigModel: { value: '' },
    quickModel: { value: '' },
    extraArgs: { value: '' },
    querySelectorAll(sel) {
      return sel.includes('provider') ? providerRadios : [];
    },
    // The RadioNodeList-like getter: form.provider.value reflects the checked radio.
    get provider() {
      const checked = providerRadios.find((r) => r.checked);
      return { get value() { return checked ? checked.value : ''; } };
    },
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
    bigModelList: el(),
    quickModelList: el(),
    loadModels: el(),
    status: { textContent: '', classList: { add() {}, remove() {} }, offsetWidth: 0 },
    statusText: { textContent: '' },
    statusClock: { textContent: '' },
    // checkHealth() touches these (provider change calls it).
    health: { style: {}, textContent: '', classList: { toggle() {} } },
    run: { disabled: false },
    runOne: { querySelectorAll: () => [] },
    commandInput: { disabled: false },
    commandForm: { querySelector: () => ({ disabled: false }) },
    onboarding: { hidden: false },
    planEmptyState: { hidden: false },
    installCmd: { textContent: '' },
    hostUpdate: { textContent: '', hidden: false },
  };
  globalThis.document = {
    getElementById: (id) => els[id] || null,
    createElement: () => el(),
  };
  return { form, providerRadios, els };
}

function selectProvider(providerRadios, value) {
  for (const r of providerRadios) r.checked = r.value === value;
  const target = providerRadios.find((r) => r.value === value);
  return target.listeners.change({ target });
}

// ---- 2. Fields shown/hidden per provider -------------------------------------

test('API key field shows for poe/openrouter/openai and hides for claude/local', async () => {
  installChromeMock({
    permissions: {}, runtime: {
      id: 'ext', sendMessage(msg, cb) { cb(msg.cmd === 'health' ? { health: { ok: true } } : { ok: true, settings: {} }); },
    },
  });
  const { providerRadios, els } = makeHarness();
  initSettingsView();

  await selectProvider(providerRadios, 'claude');
  assert.equal(els.apiKeyConfig.hidden, true, 'no key for the Claude subscription');

  for (const p of ['poe', 'openrouter', 'openai']) {
    await selectProvider(providerRadios, p);
    assert.equal(els.apiKeyConfig.hidden, false, `key field shows for ${p}`);
  }

  await selectProvider(providerRadios, 'local');
  assert.equal(els.apiKeyConfig.hidden, true, 'local server needs no key field');
});

test('base URL (openaiConfig) shows for local and hides for the hosted presets', async () => {
  installChromeMock({
    permissions: {}, runtime: {
      id: 'ext', sendMessage(msg, cb) { cb(msg.cmd === 'health' ? { health: { ok: true } } : { ok: true, settings: {} }); },
    },
  });
  const { providerRadios, els } = makeHarness();
  initSettingsView();

  await selectProvider(providerRadios, 'local');
  assert.equal(els.openaiConfig.hidden, false, 'local model exposes an editable base URL');

  for (const p of ['claude', 'poe', 'openrouter', 'openai']) {
    await selectProvider(providerRadios, p);
    assert.equal(els.openaiConfig.hidden, true, `base URL hidden for the fixed preset ${p}`);
  }
});

// ---- 3. Model pickers write into bigModel / quickModel -----------------------

test('choosing a model in each picker writes it into bigModel / quickModel', () => {
  installChromeMock();
  const { form, els } = makeHarness();
  initSettingsView();

  els.bigModelSelect.listeners.change({ target: { value: 'claude-opus-5-5' } });
  assert.equal(form.bigModel.value, 'claude-opus-5-5');

  els.quickModelSelect.listeners.change({ target: { value: 'claude-haiku-4-5' } });
  assert.equal(form.quickModel.value, 'claude-haiku-4-5');
});

// ---- 4. "Load models" fills both pickers from the faked response -------------

test('Load models fills both pickers from the listModels send', async () => {
  installChromeMock({
    runtime: {
      id: 'ext',
      sendMessage(msg, cb) {
        if (msg.cmd === 'listModels') cb({ ok: true, models: ['model-a', 'model-b'] });
        else cb({});
      },
    },
  });
  const { els } = makeHarness();
  initSettingsView();

  await els.loadModels.listeners.click();

  // Each select gets a leading "(backend default)" blank, one option per id, and
  // a trailing "Other…" sentinel that reveals the slot's custom-id field.
  const bigValues = els.bigModelSelect.children.map((o) => o.value);
  const quickValues = els.quickModelSelect.children.map((o) => o.value);
  assert.deepEqual(bigValues, ['', 'model-a', 'model-b', '__other__']);
  assert.deepEqual(quickValues, ['', 'model-a', 'model-b', '__other__']);
});
