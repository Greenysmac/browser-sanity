import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installChromeMock } from './helpers/chrome-mock.js';
import { DEFAULTS, getSettings, setSettings } from '../extension/lib/storage.js';

beforeEach(() => installChromeMock());

test('getSettings returns defaults when nothing stored', async () => {
  const s = await getSettings();
  assert.equal(s.automationMode, 'review');
  assert.equal(s.staleTabDays, DEFAULTS.staleTabDays);
  assert.equal(s.adapter, 'claude');
  // organize feature defaults: off, additive, bar protected
  assert.equal(s.enabledFeatures.organizeBookmarks, false);
  assert.equal(s.organizeMode, 'additive');
  assert.equal(s.regroupExisting, true); // default on: a fresh install re-sorts already-grouped tabs
  assert.equal(s.debugLogging, false);
  assert.equal(s.advancedCli.loadMcpServers, false);
  assert.equal(s.advancedCli.checkHostUpdates, false); // opt-in, off by default
  assert.deepEqual(s.advancedCli.extraArgs, {});
  assert.equal(s.protectBookmarkBar, true);
  assert.deepEqual(s.protectedFolders, []);
  assert.equal(s.removeEmptyFolders, false);
});

test('setSettings merges a patch over defaults', async () => {
  await setSettings({ automationMode: 'auto', staleTabDays: 30 });
  const s = await getSettings();
  assert.equal(s.automationMode, 'auto');
  assert.equal(s.staleTabDays, 30);
  assert.equal(s.adapter, 'claude'); // untouched default preserved
});

test('defaults include an empty ignore list', async () => {
  const s = await getSettings();
  assert.deepEqual(s.ignore, []);
});

test('ignore and decisions are stored in storage.local, not the synced settings blob', async () => {
  await setSettings({ ignore: ['closeTab:https://a.com'], decisions: { 'closeTab:https://a.com': { reject: 3 } }, adapter: 'kiro' });
  const { settings } = await chrome.storage.sync.get('settings');
  assert.equal(settings.adapter, 'kiro');
  assert.equal(settings.ignore, undefined, 'ignore must NOT be in the sync blob');
  assert.equal(settings.decisions, undefined, 'decisions must NOT be in the sync blob');
  const local = await chrome.storage.local.get('ignore');
  assert.deepEqual(local.ignore, ['closeTab:https://a.com']);
  const merged = await getSettings();
  assert.deepEqual(merged.ignore, ['closeTab:https://a.com']);
  assert.equal(merged.decisions['closeTab:https://a.com'].reject, 3);
});

test('decisions are capped to prevent unbounded growth', async () => {
  const big = {};
  for (let i = 0; i < 600; i++) big[`k${i}`] = { reject: i };
  await setSettings({ decisions: big });
  const { decisions } = await chrome.storage.local.get('decisions');
  assert.ok(Object.keys(decisions).length <= 500);
  assert.ok(decisions.k599, 'highest-reject entries are kept');
});

test('setSettings deep merges advancedCli.extraArgs across multiple adapter updates', async () => {
  await setSettings({ advancedCli: { extraArgs: { claude: '--temp 0' } } });
  let s = await getSettings();
  assert.equal(s.advancedCli.extraArgs.claude, '--temp 0');

  await setSettings({ advancedCli: { extraArgs: { ollama: '--num-ctx 4096' } } });
  s = await getSettings();
  assert.equal(s.advancedCli.extraArgs.claude, '--temp 0');
  assert.equal(s.advancedCli.extraArgs.ollama, '--num-ctx 4096');
});
