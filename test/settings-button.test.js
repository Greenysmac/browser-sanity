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

// The Tools live in the More view, which shows on its own (views switch by
// hiding), so their place in the markup no longer matters. The Review list
// belongs to the Open tabs part: after its result card, before Parked groups.
test('the suggestion list (id="plan") sits in the Open tabs part', () => {
  const resultIdx = html.indexOf('id="resultCard"');
  const planIdx = html.indexOf('id="plan"');
  const parkedIdx = html.indexOf('id="parkedGroupsHeading"');
  assert.ok(html.includes('aria-label="Tools"'), 'Tools section exists');
  assert.ok(resultIdx !== -1 && planIdx !== -1 && parkedIdx !== -1);
  assert.ok(resultIdx < planIdx && planIdx < parkedIdx, 'plan list is between the result card and Parked groups');
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
