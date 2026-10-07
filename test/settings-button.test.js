// The top-row Settings button: a shortcut that opens the (far-down) Settings
// panel and scrolls it into view, without moving Settings in the DOM. This
// checks the static layout (Tools now sits above the suggestion list) and the
// click handler, driven with a fake DOM in the same style as settings-view.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installChromeMock } from './helpers/chrome-mock.js';
import { initSettingsView } from '../extension/sidepanel/settings-view.js';

const html = readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8');

test('Tools section comes before the suggestion list (id="plan")', () => {
  const toolsIdx = html.indexOf('aria-label="Tools"');
  const planIdx = html.indexOf('id="plan"');
  assert.ok(toolsIdx !== -1, 'Tools section exists');
  assert.ok(planIdx !== -1, 'plan section exists');
  assert.ok(toolsIdx < planIdx, 'Tools section should appear before the suggestion list');
});

test('a Settings button exists in the top row', () => {
  assert.ok(html.includes('id="openSettings"'), 'openSettings button exists');
});

test('clicking the Settings button opens the settings panel and scrolls to it', () => {
  installChromeMock();
  let scrolled = false;
  const settings = {
    open: false,
    scrollIntoView() { scrolled = true; },
  };
  const openSettings = {
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
  };
  // Only the elements the handler and the rest of initSettingsView() touch.
  const els = {
    openSettings,
    settings,
    openaiApiKey: { value: '', placeholder: '', type: 'password' },
    openaiKeyClear: { disabled: false, addEventListener() {} },
    openaiKeyShow: { addEventListener() {} },
    settingsForm: { adapter: { addEventListener() {}, selectedOptions: [{ text: '' }] }, addEventListener() {} },
  };
  globalThis.document = { getElementById: (id) => els[id] || null };

  initSettingsView();
  assert.equal(settings.open, false, 'settings starts closed');
  openSettings.listeners.click();
  assert.equal(settings.open, true, 'click opens the settings panel');
  assert.equal(scrolled, true, 'click scrolls the settings panel into view');
});
