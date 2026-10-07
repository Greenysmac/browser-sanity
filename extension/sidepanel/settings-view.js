// The settings form: load current settings into the form, persist on submit,
// and apply an adapter switch immediately (re-checking health so the banner
// tracks the chosen backend). The encrypted OpenAI key is written only when the
// user types one. loadSettings() is exported for the bootstrap's first paint.
import { $, setStatus, flashStatus, setSettings, send } from './dom.js';
import { getSettings } from '../lib/storage.js';
import { setSecret, hasSecret, clearSecret } from '../lib/secret-store.js';
import { adapterNote, modelDisplayName } from './viewmodel.js';
import { providerSettings, providerFor, EDITABLE_BASE, PROVIDERS } from '../lib/providers.js';
import { checkHealth } from './health-view.js';

let advancedExtraArgs = {}; // per-adapter extra CLI flags, loaded from settings

// Human-readable label per provider radio, for the "Switching to …" status
// (radios have no selectedOptions, so this stands in for a <select>'s option text).
const PROVIDER_LABELS = {
  claude: 'Claude subscription',
  poe: 'Poe',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  local: 'Local model',
  other: 'Other',
};

// Which providers need an API key field, and which need a base URL field.
const KEY_PROVIDERS = new Set(['poe', 'openrouter', 'openai']);
const BASE_PROVIDERS = new Set(['local']); // 'other' adds this only when its adapter is openai

// Recommended Claude models for the two slots, so the picker can label them
// without a round-trip. Opus is the heaviest option; the slot default is called
// out as "(recommended)".
const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'];
// [selectId, slotName (hidden text input / saved value), recommended id, custom-field row id]
const MODEL_SELECTS = [
  ['bigModelSelect', 'bigModel', 'claude-sonnet-5-5', 'bigModelOtherRow'],
  ['quickModelSelect', 'quickModel', 'claude-haiku-4-5', 'quickModelOtherRow'],
];
// Sentinel <option> value that reveals the slot's free-text "custom model id" field.
const OTHER_MODEL = '__other__';

// Label a model id for the picker: known Claude ids show their friendly name,
// the slot's recommended model gets "(recommended)" and Opus "(most thorough,
// most usage)". Other ids pass through unchanged.
function modelOptionLabel(id, recommended) {
  const name = modelDisplayName(id);
  if (id === recommended) return `${name} (recommended)`;
  if (id === 'claude-opus-5-5') return `${name} (most thorough, most usage)`;
  return name;
}

// Features gated behind an optional host permission, and the origin each needs.
const PERM_FEATURES = [
  ['deadLinkScan', '<all_urls>'],
  ['checkHostUpdates', 'https://registry.npmjs.org/*'],
];

// Clamps a numeric field's raw string value to a minimum, so an emptied or
// invalid field (Number('') === 0, Number('garbage') === NaN) can't silently
// save as 0 or NaN — e.g. staleTabDays: 0 would flag every open tab as stale.
function clampedInt(value, min = 1) {
  return Math.max(min, Number(value) || min);
}

function isPermFeatureEnabled(settings, feature) {
  return feature === 'checkHostUpdates'
    ? !!(settings.advancedCli && settings.advancedCli.checkHostUpdates)
    : !!(settings.enabledFeatures && settings.enabledFeatures[feature]);
}

// Least-privilege: an origin is safe to revoke once every feature that needed it
// has gone from enabled (in `prevSettings`) to unchecked (per `isChecked`) — a
// still-checked feature sharing the origin keeps it granted. Pure/exported so
// the decision can be tested without a DOM.
export function originsToRevoke(prevSettings, isChecked) {
  const dropped = PERM_FEATURES.filter(([f]) => isPermFeatureEnabled(prevSettings, f) && !isChecked(f));
  return dropped
    .map(([, origin]) => origin)
    .filter((origin) => !PERM_FEATURES.some(([f2, o2]) => o2 === origin && isChecked(f2)));
}

// Point the "extra CLI flags" field at the currently-selected backend.
function syncExtraArgsField(adapter) {
  const form = $('settingsForm');
  form.extraArgs.value = advancedExtraArgs[adapter] || '';
  const label = document.getElementById('extraArgsAdapter');
  if (label) label.textContent = (form.adapter.selectedOptions[0] && form.adapter.selectedOptions[0].text) || adapter;
}

function updateAdapterNote(value) {
  const note = adapterNote(value);
  const el = $('adapterNote');
  if (el) {
    el.textContent = note;
    el.hidden = !note;
  }
}

// Fill a model <select> from a list of ids (no innerHTML), ending with an
// "Other…" option that reveals the slot's free-text input (name=bigModel/
// quickModel), which is what gets saved. If the current slot value isn't one of
// the listed ids (a custom id), "Other…" is selected and its field revealed;
// otherwise the matching option is selected and the field hidden. `recommended`
// drives the labels.
function fillModelSelect(selectId, slotName, recommended, otherRowId, ids) {
  const sel = document.getElementById(selectId);
  const input = $('settingsForm') && $('settingsForm')[slotName];
  const current = input ? input.value : '';
  if (!sel) return;
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '(backend default)';
  sel.appendChild(blank);
  for (const id of ids) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = modelOptionLabel(id, recommended);
    sel.appendChild(opt);
  }
  const other = document.createElement('option');
  other.value = OTHER_MODEL;
  other.textContent = 'Other…';
  sel.appendChild(other);
  const isCustom = !!current && !ids.includes(current);
  sel.value = isCustom ? OTHER_MODEL : (ids.includes(current) ? current : '');
  const row = otherRowId && document.getElementById(otherRowId);
  if (row) row.hidden = !isCustom;
}

// Fill both slots' pickers from the same id list (Claude's fixed set by default).
function fillAllModelSelects(ids = CLAUDE_MODELS) {
  for (const [selectId, slotName, recommended, otherRowId] of MODEL_SELECTS) {
    fillModelSelect(selectId, slotName, recommended, otherRowId, ids);
  }
}

// Reflect the chosen provider in the form: the raw backend dropdown shows only
// under 'Other'; the API key field shows for the key-bearing hosted providers
// (poe/openrouter/openai) and under 'Other' when its adapter is openai; the base
// URL field shows for 'local' and for 'other' when its adapter is openai (and
// stays editable there). The adapter note tracks the resolved backend.
function applyProviderView(provider) {
  const form = $('settingsForm');
  const isOther = provider === 'other';
  const adapter = isOther ? form.adapter.value : (PROVIDERS[provider] && PROVIDERS[provider].adapter) || 'claude';
  const adapterRow = document.getElementById('adapterRow');
  if (adapterRow) adapterRow.hidden = !isOther;
  updateAdapterNote(adapter);
  const otherIsOpenai = isOther && adapter === 'openai';
  const keyRow = document.getElementById('apiKeyConfig');
  if (keyRow) keyRow.hidden = !(KEY_PROVIDERS.has(provider) || otherIsOpenai);
  const baseRow = document.getElementById('openaiConfig'); // base URL + model block
  const showBase = BASE_PROVIDERS.has(provider) || otherIsOpenai;
  if (baseRow) baseRow.hidden = !showBase;
  const baseEditable = isOther || EDITABLE_BASE.has(provider);
  if (form.openaiBaseUrl) form.openaiBaseUrl.disabled = !baseEditable;
}

export async function loadSettings() {
  const s = await getSettings();
  const form = $('settingsForm');
  form.adapter.value = s.adapter;
  const provider = s.provider || providerFor(s.adapter, s.openaiBaseUrl);
  if (form.provider) form.provider.value = provider;
  applyProviderView(provider);
  form.openaiBaseUrl.value = s.openaiBaseUrl || '';
  form.openaiModel.value = s.openaiModel || '';
  form.bigModel.value = s.bigModel || '';
  form.quickModel.value = s.quickModel || '';
  fillAllModelSelects(); // seed the pickers with Claude's set; "Load models" refreshes from the live backend
  const hasKey = await hasSecret('openaiApiKey');
  $('openaiApiKey').value = '';
  $('openaiApiKey').placeholder = hasKey
    ? '•••••••• saved — leave blank to keep'
    : 'sk-… (stored encrypted on this device)';
  $('openaiKeyClear').disabled = !hasKey;
  form.staleTabs.checked = s.enabledFeatures.staleTabs;
  form.importantBookmarks.checked = s.enabledFeatures.importantBookmarks;
  form.cleanBookmarks.checked = s.enabledFeatures.cleanBookmarks;
  form.deadLinkScan.checked = s.enabledFeatures.deadLinkScan;
  form.organizeBookmarks.checked = s.enabledFeatures.organizeBookmarks;
  form.organizeMode.value = s.organizeMode || 'additive';
  form.protectBookmarkBar.checked = s.protectBookmarkBar !== false;
  form.removeEmptyFolders.checked = !!s.removeEmptyFolders;
  form.protectedFolders.value = (s.protectedFolders || []).join('\n');
  form.staleTabDays.value = s.staleTabDays;
  form.staleBookmarkDays.value = s.staleBookmarkDays;
  form.scanIntervalHours.value = Math.round(s.scanIntervalMinutes / 60);
  form.undoRetentionDays.value = s.undoRetentionDays;
  form.autoMode.checked = s.automationMode === 'auto';
  form.whitelist.value = (s.whitelist || []).join('\n');
  form.debugLogging.checked = !!s.debugLogging;
  form.checkHostUpdates.checked = !!(s.advancedCli && s.advancedCli.checkHostUpdates);
  form.loadMcpServers.checked = !!(s.advancedCli && s.advancedCli.loadMcpServers);
  form.loadPluginsSettings.checked = !!(s.advancedCli && s.advancedCli.loadPluginsSettings);
  advancedExtraArgs = { ...((s.advancedCli && s.advancedCli.extraArgs) || {}) };
  syncExtraArgsField(s.adapter);
}

export function initSettingsView() {
  // The gear opens Settings as its own view that replaces the main content:
  // body[data-view="settings"] hides the main surfaces (CSS) and reveals the
  // settings panel; "Done" clears it to return to the main view. Settings itself
  // stays in place in the DOM (same form element names), so saving is unchanged.
  const setView = (view) => {
    if (document.body) document.body.dataset.view = view;
    const settings = $('settings');
    if (settings) settings.open = view === 'settings';
  };
  const openSettings = document.getElementById('openSettings');
  if (openSettings) {
    openSettings.addEventListener('click', () => {
      setView('settings');
      const settings = $('settings');
      if (settings && settings.scrollIntoView) settings.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  const settingsDone = document.getElementById('settingsDone');
  if (settingsDone) settingsDone.addEventListener('click', () => setView('main'));
  $('openaiKeyShow').addEventListener('change', (e) => { $('openaiApiKey').type = e.target.checked ? 'text' : 'password'; });
  $('openaiKeyClear').addEventListener('click', async () => {
    await clearSecret('openaiApiKey');
    $('openaiApiKey').value = '';
    $('openaiApiKey').placeholder = 'sk-… (stored encrypted on this device)';
    $('openaiKeyClear').disabled = true;
    flashStatus('API key cleared.');
    await checkHealth();
  });

  // Picking "runs on" sets the backend + endpoint and applies immediately. The
  // provider is a radio group, so wire each radio; 'other' leaves adapter/base
  // alone and reveals the full backend dropdown so every CLI backend stays reachable.
  const form0 = $('settingsForm');
  const providerRadios = form0.querySelectorAll ? form0.querySelectorAll('input[name="provider"]') : [];
  for (const radio of providerRadios) {
    radio.addEventListener('change', async (e) => {
      if (!e.target.checked) return;
      const provider = e.target.value;
      const form = $('settingsForm');
      const patch = providerSettings(provider); // {} for 'other' — keeps current adapter/base
      if (patch.adapter) form.adapter.value = patch.adapter;
      if (patch.openaiBaseUrl !== undefined) form.openaiBaseUrl.value = patch.openaiBaseUrl;
      applyProviderView(provider);
      syncExtraArgsField(form.adapter.value);
      setStatus(`Switching to ${PROVIDER_LABELS[provider] || provider}…`);
      try {
        await setSettings({ provider, ...patch });
        await checkHealth();
        setStatus('');
      } catch (err) { setStatus(`Could not switch provider: ${err.message}`); }
    });
  }

  // The model pickers write the chosen id into the slot's hidden text input
  // (which is what gets saved). Picking "Other…" reveals that input as an
  // editable "custom model id" field instead of overwriting it.
  for (const [selectId, slotName, , otherRowId] of MODEL_SELECTS) {
    const sel = document.getElementById(selectId);
    if (!sel) continue;
    sel.addEventListener('change', (e) => {
      const row = otherRowId && document.getElementById(otherRowId);
      if (e.target.value === OTHER_MODEL) {
        if (row) row.hidden = false;
        const input = form0[slotName];
        if (input && input.focus) input.focus();
      } else {
        if (row) row.hidden = true;
        form0[slotName].value = e.target.value;
      }
    });
  }

  // "Load models" asks the host for the selected backend's model list and fills
  // both pickers from it (falling back to Claude's set / keeping them if it fails).
  const loadModelsBtn = document.getElementById('loadModels');
  if (loadModelsBtn) {
    loadModelsBtn.addEventListener('click', async () => {
      setStatus('Loading models…');
      try {
        const r = await send({ cmd: 'listModels' });
        const models = (r && r.ok && Array.isArray(r.models) && r.models.length) ? r.models : CLAUDE_MODELS;
        fillAllModelSelects(models);
        setStatus('');
      } catch (err) { setStatus(`Could not load models: ${err.message}`); }
    });
  }

  // Switching the AI backend applies immediately (persist + re-check health), so the
  // banner reflects the chosen backend without also having to click "Save settings".
  $('settingsForm').adapter.addEventListener('change', async (e) => {
    updateAdapterNote(e.target.value);
    const form = $('settingsForm');
    if (form.provider) applyProviderView(form.provider.value); // reveal key/base when 'other' resolves to openai
    syncExtraArgsField(e.target.value); // show this backend's extra flags
    setStatus(`Switching to ${e.target.selectedOptions[0].text}…`);
    try {
      await setSettings({ adapter: e.target.value });
      await checkHealth();
      setStatus('');
    } catch (err) { setStatus(`Could not switch adapter: ${err.message}`); }
  });

  $('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      const prevSettings = await getSettings(); // snapshot before this save, to detect on->off transitions below
      // Features that need an optional host permission: dead-link scan (<all_urls>)
      // and the opt-in npm update check (registry host). Prompt only for the ones
      // not already granted, in a single dialog. If the user DECLINES, untick those
      // features so we never persist an enabled setting whose permission is missing.
      const permFeatures = PERM_FEATURES.filter(([f]) => form[f].checked);
      const toRequest = [];
      for (const [feature, origin] of permFeatures) {
        if (!(await chrome.permissions.contains({ origins: [origin] }))) toRequest.push([feature, origin]);
      }
      if (toRequest.length) {
        const granted = await chrome.permissions.request({ origins: toRequest.map(([, o]) => o) });
        if (!granted) {
          for (const [feature] of toRequest) form[feature].checked = false;
          setStatus('Permission declined — that feature stays off.');
        }
      }
      // Persist the API key (encrypted, device-local) only if the user typed one.
      // Trim FIRST: a blank/whitespace-only field means "keep the saved key" — it
      // must not fall through to setSecret('') which would clear the stored key.
      const apiKeyInput = $('openaiApiKey');
      const apiKey = apiKeyInput.value.trim();
      if (apiKey) {
        await setSecret('openaiApiKey', apiKey);
        apiKeyInput.value = '';
        apiKeyInput.placeholder = '•••••••• saved — leave blank to keep';
        $('openaiKeyClear').disabled = false;
      }
      await setSettings({
        provider: form.provider ? form.provider.value : 'other',
        adapter: form.adapter.value,
        openaiBaseUrl: form.openaiBaseUrl.value.trim(),
        openaiModel: form.openaiModel.value.trim(),
        bigModel: form.bigModel.value.trim(),
        quickModel: form.quickModel.value.trim(),
        enabledFeatures: {
          staleTabs: form.staleTabs.checked,
          importantBookmarks: form.importantBookmarks.checked,
          cleanBookmarks: form.cleanBookmarks.checked,
          deadLinkScan: form.deadLinkScan.checked,
          organizeBookmarks: form.organizeBookmarks.checked,
        },
        organizeMode: form.organizeMode.value,
        protectBookmarkBar: form.protectBookmarkBar.checked,
        removeEmptyFolders: form.removeEmptyFolders.checked,
        protectedFolders: form.protectedFolders.value.split('\n').map((s) => s.trim()).filter(Boolean),
        staleTabDays: clampedInt(form.staleTabDays.value),
        staleBookmarkDays: clampedInt(form.staleBookmarkDays.value),
        scanIntervalMinutes: clampedInt(form.scanIntervalHours.value) * 60,
        undoRetentionDays: clampedInt(form.undoRetentionDays.value),
        automationMode: form.autoMode.checked ? 'auto' : 'review',
        whitelist: form.whitelist.value.split('\n').map((s) => s.trim()).filter(Boolean),
        debugLogging: form.debugLogging.checked,
        advancedCli: {
          loadMcpServers: form.loadMcpServers.checked,
          loadPluginsSettings: form.loadPluginsSettings.checked,
          checkHostUpdates: form.checkHostUpdates.checked,
          extraArgs: { ...advancedExtraArgs, [form.adapter.value]: form.extraArgs.value.trim() },
        },
      });
      advancedExtraArgs = { ...advancedExtraArgs, [form.adapter.value]: form.extraArgs.value.trim() };
      // Least-privilege: a feature that just went from on to off no longer needs
      // its optional host permission — revoke it, unless another still-enabled
      // feature needs the same origin.
      for (const origin of originsToRevoke(prevSettings, (f) => form[f].checked)) {
        await chrome.permissions.remove({ origins: [origin] });
      }
      // Re-check health so the banner reflects the (possibly changed) AI backend —
      // it queries the newly-saved adapter and updates connected/version or the
      // onboarding card + disables Analyze if the new backend isn't reachable.
      await checkHealth();
      flashStatus('Settings saved.');
    } catch (err) { flashStatus(`Save failed: ${err.message}`); }
  });
}
