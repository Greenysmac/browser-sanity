// TASK 1 — one-step sort that says the AI is working. Covers:
//   1. 'countTabs' returns { loose, duplicates } for the scope WITHOUT clearing
//      the stored plan (unlike 'analyze', which does);
//   2. the two grouping choices are always visible (no Analyze click) and the
//      #run Analyze button is hidden (static HTML);
//   3. the muted AI line under the choices names the big-sorts model, with the
//      same display names as the models-in-use line (main-panel);
//   4. the live counts line refreshes when the scope changes (plan-view, driven
//      through the main panel's segmented control);
//   5. clicking a grouping choice shows "AI is sorting N tabs… Ns" on the clicked
//      button and disables both while the AI runs (plan-view).
// Like the sibling suites, this drives the modules with a hand-rolled fake DOM
// and a hand-rolled chrome mock (no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---- 1. countTabs leaves the stored plan alone -------------------------------

function listener() {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), fire: (...args) => fns.map((fn) => fn(...args)), fns };
}

const bootOnMessage = listener();
function bootChrome() {
  const noop = listener();
  return {
    runtime: { id: 'self', onConnect: noop, onInstalled: noop, onStartup: noop, onMessage: bootOnMessage },
    action: { onClicked: noop }, alarms: { onAlarm: noop, async create() {} },
    commands: { onCommand: noop }, omnibox: { onInputEntered: noop },
    notifications: { onClicked: noop }, storage: { onChanged: noop },
    tabs: { onActivated: noop, onUpdated: noop, onRemoved: noop },
  };
}
globalThis.chrome = bootChrome();
const sw = await import('../extension/background/service-worker.js');
void sw;
const swOnMessage = bootOnMessage.fns[0];

// The two panel modules under test. Imported once (ES modules are singletons);
// each test re-inits them, which resets the state they own.
const mainPanel = await import('../extension/sidepanel/main-panel.js');
const planView = await import('../extension/sidepanel/plan-view.js');

function installSwChrome({ local = {}, openTabs = [] } = {}) {
  const stored = { local: { ...local }, sync: {} };
  const area = (name) => ({
    async get(k) {
      if (typeof k === 'string') return { [k]: stored[name][k] };
      if (k == null) return { ...stored[name] };
      return Object.fromEntries(Object.keys(k).map((kk) => [kk, stored[name][kk] ?? k[kk]]));
    },
    async set(o) { Object.assign(stored[name], o); },
    async remove(k) { delete stored[name][k]; },
  });
  globalThis.chrome = {
    runtime: { id: 'self', lastError: null },
    storage: { local: area('local'), sync: area('sync') },
    tabs: { async query() { return openTabs; } },
  };
  const dispatch = (message) => new Promise((resolve) => {
    const ret = swOnMessage(message, { id: 'self' }, resolve);
    assert.equal(ret, true);
  });
  return { dispatch, stored };
}

test('countTabs returns the scope counts WITHOUT clearing the stored plan', async () => {
  const plan = [{ itemId: 'old', action: 'groupTabs', data: { tabIds: [1, 2] } }];
  const { dispatch, stored } = installSwChrome({
    local: { currentPlan: plan, currentPlanAt: Date.now() },
    openTabs: [
      { id: 1, url: 'https://a.com', groupId: -1 },             // loose
      { id: 2, url: 'https://b.com', groupId: -1 },             // loose
      { id: 3, url: 'https://c.com', groupId: 7 },              // grouped
      { id: 4, url: 'https://a.com', groupId: -1, lastAccessed: 0 }, // duplicate of 1, loose
    ],
  });
  const res = await dispatch({ cmd: 'countTabs', windowId: null });
  assert.equal(res.ok, true);
  assert.equal(res.loose, 3, 'tabs 1, 2, 4 are ungrouped');
  assert.equal(res.duplicates, 1, '4 duplicates 1');
  assert.deepEqual(stored.local.currentPlan, plan, 'the stored plan is left untouched (unlike analyze)');
});

// ---- 2. The choices are always visible; #run Analyze is hidden ---------------

const html = readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8');

test('the two grouping choices are visible without an Analyze click, and #run is hidden', () => {
  // #sortChoices carries no hidden attribute.
  const choices = html.match(/<div id="sortChoices"[^>]*>/);
  assert.ok(choices, '#sortChoices exists');
  assert.ok(!/\bhidden\b/.test(choices[0]), '#sortChoices is never hidden');
  // The two choice buttons are inside it.
  assert.ok(html.includes('id="putMine"'), '#putMine present');
  assert.ok(html.includes('id="suggestGroups"'), '#suggestGroups present');
  // The old Analyze button keeps its id and wiring but is hidden.
  const run = html.match(/<button id="run"[^>]*>/);
  assert.ok(run, '#run kept for existing wiring');
  assert.ok(/\bhidden\b/.test(run[0]), '#run is hidden');
});

// ---- Fake DOM harness --------------------------------------------------------

function el(extra = {}) {
  const node = {
    attrs: {},
    classes: new Set(),
    hidden: false,
    disabled: false,
    textContent: '',
    value: '',
    checked: false,
    dataset: {},
    children: [],
    parentNode: null,
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    querySelectorAll() { return []; },
    querySelector() { return el(); },
    classList: {
      add: (c) => node.classes.add(c),
      remove: (c) => node.classes.delete(c),
      toggle: (c, force) => { if (force) node.classes.add(c); else node.classes.delete(c); },
      contains: (c) => node.classes.has(c),
    },
    appendChild(child) { child.parentNode = node; node.children.push(child); return child; },
    removeChild(child) { node.children = node.children.filter((c) => c !== child); child.parentNode = null; return child; },
    insertAdjacentElement(_pos, child) { child.parentNode = node.parentNode; if (node.parentNode) node.parentNode.children.push(child); return child; },
    get className() { return [...node.classes].join(' '); },
    set className(v) { node.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    click() { if (this.listeners.click) this.listeners.click({ preventDefault() {}, stopImmediatePropagation() {} }); },
    ...extra,
  };
  return node;
}

// A document whose getElementById lazily creates and caches a fake element for
// any id, so we don't have to enumerate every control the panel touches. A few
// ids need special shapes (segmented control, template, forms).
function makeDocument(seed = {}) {
  const els = { ...seed };
  const doc = {
    body: { dataset: {} },
    getElementById(id) {
      if (!(id in els)) els[id] = el();
      return els[id];
    },
    createElement: () => el(),
  };
  return { doc, els };
}

// A chrome whose runtime.sendMessage routes commands to a provided map, records
// every message sent, and gives a no-op scan port for ensureScanPort().
function makeChrome(handlers, settings = {}) {
  const sent = [];
  const chrome = {
    _sent: sent,
    runtime: {
      id: 'ext',
      getManifest: () => ({ version: '0.8.0' }),
      sendMessage(msg, cb) { sent.push(msg); const h = handlers[msg.cmd]; Promise.resolve(h ? h(msg) : { ok: true }).then((r) => cb(r)); },
      connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }),
    },
    windows: { async getCurrent() { return { id: 1 }; } },
    tabs: {
      onCreated: { addListener() {} }, onRemoved: { addListener() {} },
      onMoved: { addListener() {} }, onAttached: { addListener() {} }, onUpdated: { addListener() {} },
    },
    storage: {
      local: {
        async get() { return {}; },
        async set() {},
      },
    },
  };
  chrome._settings = settings;
  globalThis.chrome = chrome;
  return chrome;
}

// Reset the module cache so main-panel/plan-view state is fresh per test.
async function freshModules() {
  return { mainPanel, planView };
}

// ---- 3. The AI line names the big-sorts model --------------------------------

test('the muted AI line under the choices names the big-sorts model', async () => {
  const seg = (scope) => el({ dataset: { scope } });
  const segBtns = [seg('window'), seg('all'), seg('selected')];
  const scopeSegment = el({ querySelectorAll: () => segBtns });
  const { doc, els } = makeDocument({ scopeSegment, scope: el({ value: 'window' }) });
  globalThis.document = doc;
  makeChrome({});
  // getSettings reads chrome.storage.sync via storage.js; stub it to return the
  // big model id so the AI line can name it.
  globalThis.chrome.storage.sync = { async get() { return { settings: { bigModel: 'claude-sonnet-5-5', quickModel: '' } }; } };

  const { mainPanel } = await freshModules();
  mainPanel.initMainPanel();
  // paintModelsInUse resolves on a microtask; let it settle.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(
    els.sortAiLine.textContent,
    'Both use AI (Sonnet 5.5). Nothing changes until you Apply.',
    'the big model id is shown with its friendly display name',
  );
});

test('the AI line falls back to "endpoint default" for an empty big slot', async () => {
  const scopeSegment = el({ querySelectorAll: () => [] });
  const { doc, els } = makeDocument({ scopeSegment, scope: el({ value: 'window' }) });
  globalThis.document = doc;
  makeChrome({});
  globalThis.chrome.storage.sync = { async get() { return { settings: { bigModel: '', quickModel: '' } }; } };

  const { mainPanel } = await freshModules();
  mainPanel.initMainPanel();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(els.sortAiLine.textContent, 'Both use AI (endpoint default). Nothing changes until you Apply.');
});

// ---- 4 & 5. plan-view: counts refresh on scope change; AI-working button -----

// Build the shared fake document + chrome, init both panels, and return the
// handles the behavioural tests need.
async function wirePanels({ handlers = {}, scopeValue = 'window' } = {}) {
  const seg = (scope) => el({ dataset: { scope } });
  const segBtns = [seg('window'), seg('all'), seg('selected')];
  const scopeSegment = el({ querySelectorAll: () => segBtns });
  const runOne = el({ querySelectorAll: () => [] });
  const commandForm = el({ querySelector: () => el() });
  const itemTemplate = { content: { cloneNode: () => el({ querySelector: () => el() }) } };
  const { doc, els } = makeDocument({ scopeSegment, runOne, commandForm, itemTemplate, scope: el({ value: scopeValue }) });
  // Seed the two choice buttons with their labels so the AI clock can restore them.
  els.putMine = el({ textContent: 'Put into my groups' });
  els.suggestGroups = el({ textContent: 'Suggest new groups' });
  globalThis.document = doc;
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { async writeText() {} } }, configurable: true });
  }
  const base = {
    getPlan: async () => ({ ok: true, items: [], origin: null }),
    countTabs: async () => ({ ok: true, loose: 40, duplicates: 1 }),
    run: async () => ({ ok: true, items: [], warnings: [] }),
  };
  const chrome = makeChrome({ ...base, ...handlers });
  chrome.storage.sync = { async get() { return { settings: { bigModel: '', quickModel: '' } }; } };
  const { mainPanel, planView } = await freshModules();
  mainPanel.initMainPanel();
  await planView.initPlanView();
  return { els, segBtns, chrome };
}

test('the live counts line refreshes when the scope changes', async () => {
  let scope = null;
  const counts = { seq: [] };
  const { els, segBtns } = await wirePanels({
    handlers: {
      countTabs: async (m) => { scope = m; counts.seq.push(m.selected ? 'selected' : (m.windowId == null ? 'all' : 'window')); return { ok: true, loose: m.selected ? 3 : 40, duplicates: m.selected ? 0 : 1 }; },
    },
  });
  // The first count on open filled the line for "this window".
  assert.equal(els.analyzeCounts.textContent, '40 loose tabs, 1 duplicate');
  assert.equal(els.analyzeCounts.hidden, false, 'the counts line is shown');
  const openSends = counts.seq.length;

  // Switch to "Selected tabs": the scope change fires another countTabs, and the
  // line updates to the new scope's numbers.
  segBtns[2].listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(counts.seq.length > openSends, 'a scope change triggers a fresh countTabs');
  assert.equal(scope.selected, true, 'the refresh used the selected scope');
  assert.equal(els.analyzeCounts.textContent, '3 loose tabs, 0 duplicates');
});

test('clicking a grouping choice shows the AI-working text and disables both buttons', async () => {
  // Hold the run (the AI call) open until we release it, so we can inspect the
  // mid-flight button state.
  let releaseRun;
  const runGate = new Promise((r) => { releaseRun = r; });
  const { els } = await wirePanels({
    handlers: {
      countTabs: async () => ({ ok: true, loose: 40, duplicates: 1 }),
      run: async () => { await runGate; return { ok: true, items: [], warnings: [] }; },
    },
  });
  const putMine = els.putMine;
  const suggest = els.suggestGroups;

  // Click "Put into my groups": the run is now in flight.
  const done = putMine.listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(putMine.textContent, /^AI is sorting 40 tabs… \d+s$/, 'the clicked button shows the ticking AI-working text');
  assert.equal(putMine.disabled, true, 'the clicked button is disabled while the AI runs');
  assert.equal(suggest.disabled, true, 'the other choice is disabled too');
  assert.equal(els.cancelRun.hidden, false, 'Cancel is visible while the AI runs');

  // Let the run finish: both buttons return to their labels and re-enable.
  releaseRun();
  await done;
  assert.equal(putMine.textContent, 'Put into my groups', 'the button returns to its label');
  assert.equal(putMine.disabled, false, 'the clicked button re-enables');
  assert.equal(suggest.disabled, false, 'the other choice re-enables');
  assert.equal(els.cancelRun.hidden, true, 'Cancel is hidden again');
});
