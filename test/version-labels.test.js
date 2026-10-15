// Where Jeff looks for the version (2026-10-15): "Version 0.8.0" at the right of
// the side panel's Open tabs heading, and in a footer under the new-tab board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { paintNewtabVersion } from '../extension/newtab/newtab.js';

const read = (f) => fs.readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('the side panel puts Version next to the Open tabs heading', () => {
  assert.match(read('sidepanel/sidepanel.html'), /id="openTabsHeading">Open tabs <span id="panelVersion"/);
  assert.match(read('sidepanel/main-panel.js'), /side\.textContent = m\.version \? `Version \$\{m\.version\}`/);
});

test('the new-tab footer shows the version', () => {
  assert.match(read('newtab/newtab.html'), /<footer class="pageFooter">Browser Sanity · <span id="ntVersion"><\/span><\/footer>/);
  const el = { textContent: '' };
  paintNewtabVersion({ getElementById: (id) => (id === 'ntVersion' ? el : null) }, { runtime: { getManifest: () => ({ version: '0.8.1' }) } });
  assert.equal(el.textContent, 'Version 0.8.1');
});
