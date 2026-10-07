// originsToRevoke is the pure decision behind the settings-save handler's
// least-privilege permission cleanup: no DOM/messaging harness exists for this
// panel module (no jsdom in this repo's unit-test setup), so this exercises the
// decision function directly rather than the full submit event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeMock } from './helpers/chrome-mock.js';
import { originsToRevoke, loadSettings, initSettingsView } from '../extension/sidepanel/settings-view.js';
import { setSettings, DEFAULTS } from '../extension/lib/storage.js';

// Field names the settings form exposes; each is a stub with value/checked.
const FORM_FIELDS = [
  'adapter', 'openaiBaseUrl', 'openaiModel', 'groupTabs', 'regroupExisting', 'staleTabs',
  'importantBookmarks', 'cleanBookmarks', 'dupeTabs', 'deadLinkScan', 'organizeBookmarks',
  'organizeMode', 'protectBookmarkBar', 'removeEmptyFolders', 'protectedFolders', 'staleTabDays',
  'staleBookmarkDays', 'scanIntervalHours', 'undoRetentionDays', 'autoMode', 'whitelist',
  'debugLogging', 'checkHostUpdates', 'loadMcpServers', 'loadPluginsSettings', 'extraArgs',
];

// A minimal fake DOM/form so loadSettings() and the submit handler run without
// jsdom (the panel has no DOM test harness; see originsToRevoke tests below).
function makeForm() {
  const form = {
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
  };
  for (const name of FORM_FIELDS) {
    form[name] = { value: '', checked: false, addEventListener() {}, selectedOptions: [{ text: name }] };
  }
  return form;
}

function installFakeDom(form) {
  const els = {
    settingsForm: form,
    openaiApiKey: { value: '', placeholder: '', type: 'password' },
    openaiKeyClear: { disabled: false, addEventListener() {} },
    openaiKeyShow: { addEventListener() {} },
    adapterNote: { textContent: '', hidden: false },
    openaiConfig: { hidden: false },
    extraArgsAdapter: { textContent: '' },
    status: { textContent: '', classList: { add() {}, remove() {} }, offsetWidth: 0 },
    statusText: { textContent: '' },
    statusClock: { textContent: '' },
    // Elements touched by checkHealth(), which the submit handler calls at the end.
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
  };
  return els;
}

test('settings view renders the regroupExisting checkbox from stored settings', async () => {
  installChromeMock();
  await setSettings({ regroupExisting: true });
  const form = makeForm();
  installFakeDom(form);
  await loadSettings();
  assert.equal(form.regroupExisting.checked, true);
});

test('settings view saves the regroupExisting checkbox', async () => {
  let savedPatch = null;
  installChromeMock({
    permissions: { async contains() { return true; }, async request() { return true; }, async remove() {} },
    runtime: {
      id: 'ext',
      sendMessage(msg, cb) {
        if (msg.cmd === 'setSettings') { savedPatch = msg.patch; cb({ ok: true, settings: { ...DEFAULTS, ...msg.patch } }); }
        else if (msg.cmd === 'health') cb({ health: { ok: true } });
        else cb({});
      },
    },
  });
  const form = makeForm();
  installFakeDom(form);
  initSettingsView();
  form.regroupExisting.checked = true;
  await form.listeners.submit({ preventDefault() {}, target: form });
  assert.ok(savedPatch, 'a settings patch was saved');
  assert.equal(savedPatch.regroupExisting, true);
});


test('originsToRevoke: revokes <all_urls> when deadLinkScan goes from on to off', () => {
  const prev = { enabledFeatures: { deadLinkScan: true }, advancedCli: {} };
  const isChecked = (f) => f !== 'deadLinkScan'; // deadLinkScan now unchecked
  assert.deepEqual(originsToRevoke(prev, isChecked), ['<all_urls>']);
});

test('originsToRevoke: revokes the npm registry origin when checkHostUpdates goes from on to off', () => {
  const prev = { enabledFeatures: {}, advancedCli: { checkHostUpdates: true } };
  const isChecked = () => false;
  assert.deepEqual(originsToRevoke(prev, isChecked), ['https://registry.npmjs.org/*']);
});

test('originsToRevoke: nothing to revoke when the feature stays checked', () => {
  const prev = { enabledFeatures: { deadLinkScan: true }, advancedCli: {} };
  const isChecked = () => true; // still on
  assert.deepEqual(originsToRevoke(prev, isChecked), []);
});

test('originsToRevoke: nothing to revoke when the feature was already off', () => {
  const prev = { enabledFeatures: { deadLinkScan: false }, advancedCli: {} };
  const isChecked = () => false;
  assert.deepEqual(originsToRevoke(prev, isChecked), []);
});

test('originsToRevoke: turning off one feature does not revoke another feature\'s (distinct) origin', () => {
  const prev = { enabledFeatures: { deadLinkScan: true }, advancedCli: { checkHostUpdates: true } };
  const isChecked = (f) => f === 'checkHostUpdates'; // deadLinkScan turned off, checkHostUpdates still on
  assert.deepEqual(originsToRevoke(prev, isChecked), ['<all_urls>']); // only deadLinkScan's origin drops
});

test('originsToRevoke: revokes both origins when both features go from on to off together', () => {
  const prev = { enabledFeatures: { deadLinkScan: true }, advancedCli: { checkHostUpdates: true } };
  const isChecked = () => false;
  assert.deepEqual(originsToRevoke(prev, isChecked).sort(), ['<all_urls>', 'https://registry.npmjs.org/*'].sort());
});
