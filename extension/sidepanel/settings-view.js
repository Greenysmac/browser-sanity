// The settings form: load current settings into the form, persist on submit,
// and apply an adapter switch immediately (re-checking health so the banner
// tracks the chosen backend). The encrypted OpenAI key is written only when the
// user types one. loadSettings() is exported for the bootstrap's first paint.
import { $, setStatus, flashStatus, setSettings } from './dom.js';
import { getSettings } from '../lib/storage.js';
import { setSecret, hasSecret, clearSecret } from '../lib/secret-store.js';
import { adapterNote } from './viewmodel.js';
import { checkHealth } from './health-view.js';

let advancedExtraArgs = {}; // per-adapter extra CLI flags, loaded from settings

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
  el.textContent = note;
  el.hidden = !note;
  $('openaiConfig').hidden = value !== 'openai'; // key/base/model only for the API backend
}

export async function loadSettings() {
  const s = await getSettings();
  const form = $('settingsForm');
  form.adapter.value = s.adapter;
  updateAdapterNote(s.adapter);
  form.openaiBaseUrl.value = s.openaiBaseUrl || '';
  form.openaiModel.value = s.openaiModel || '';
  form.bigModel.value = s.bigModel || '';
  form.quickModel.value = s.quickModel || '';
  const hasKey = await hasSecret('openaiApiKey');
  $('openaiApiKey').value = '';
  $('openaiApiKey').placeholder = hasKey
    ? '•••••••• saved — leave blank to keep'
    : 'sk-… (stored encrypted on this device)';
  $('openaiKeyClear').disabled = !hasKey;
  form.groupTabs.checked = s.enabledFeatures.groupTabs;
  form.staleTabs.checked = s.enabledFeatures.staleTabs;
  form.importantBookmarks.checked = s.enabledFeatures.importantBookmarks;
  form.cleanBookmarks.checked = s.enabledFeatures.cleanBookmarks;
  form.dupeTabs.checked = s.enabledFeatures.dupeTabs;
  form.deadLinkScan.checked = s.enabledFeatures.deadLinkScan;
  form.organizeBookmarks.checked = s.enabledFeatures.organizeBookmarks;
  form.organizeMode.value = s.organizeMode || 'additive';
  form.regroupExisting.checked = !!s.regroupExisting;
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
  // The top-row Settings button opens the (far-down) settings panel and scrolls
  // it into view; Settings itself stays in place in the DOM.
  const openSettings = document.getElementById('openSettings');
  if (openSettings) {
    openSettings.addEventListener('click', () => {
      const settings = $('settings');
      if (!settings) return;
      settings.open = true;
      settings.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  $('openaiKeyShow').addEventListener('change', (e) => { $('openaiApiKey').type = e.target.checked ? 'text' : 'password'; });
  $('openaiKeyClear').addEventListener('click', async () => {
    await clearSecret('openaiApiKey');
    $('openaiApiKey').value = '';
    $('openaiApiKey').placeholder = 'sk-… (stored encrypted on this device)';
    $('openaiKeyClear').disabled = true;
    flashStatus('API key cleared.');
    await checkHealth();
  });

  // Switching the AI backend applies immediately (persist + re-check health), so the
  // banner reflects the chosen backend without also having to click "Save settings".
  $('settingsForm').adapter.addEventListener('change', async (e) => {
    updateAdapterNote(e.target.value);
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
        adapter: form.adapter.value,
        openaiBaseUrl: form.openaiBaseUrl.value.trim(),
        openaiModel: form.openaiModel.value.trim(),
        bigModel: form.bigModel.value.trim(),
        quickModel: form.quickModel.value.trim(),
        enabledFeatures: {
          groupTabs: form.groupTabs.checked,
          staleTabs: form.staleTabs.checked,
          importantBookmarks: form.importantBookmarks.checked,
          cleanBookmarks: form.cleanBookmarks.checked,
          dupeTabs: form.dupeTabs.checked,
          deadLinkScan: form.deadLinkScan.checked,
          organizeBookmarks: form.organizeBookmarks.checked,
        },
        organizeMode: form.organizeMode.value,
        regroupExisting: form.regroupExisting.checked,
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
