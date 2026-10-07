// originsToRevoke is the pure decision behind the settings-save handler's
// least-privilege permission cleanup: no DOM/messaging harness exists for this
// panel module (no jsdom in this repo's unit-test setup), so this exercises the
// decision function directly rather than the full submit event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originsToRevoke } from '../extension/sidepanel/settings-view.js';

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
