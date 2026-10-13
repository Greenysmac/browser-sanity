// "Applied 12. 1 failed." said nothing about which or why, and the Undo toast
// vanished after 8 seconds and was easy to miss. applyItems now
// returns why each item failed, the panel names it, and the Undo stays put.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyItems } from '../extension/lib/orchestrator.js';

test('applyItems reports why an item failed', async () => {
  const items = [
    { itemId: 'a', action: 'groupTabs', reason: 'Group "Reading" (2 tabs)', data: {} },
    { itemId: 'b', action: 'closeTab', reason: 'Duplicate of another tab', data: {} },
  ];
  const res = await applyItems(items, {
    applyItem: async (i) => { if (i.itemId === 'b') throw new Error('No tab with id: 12.'); return null; },
    recordUndo: async () => {},
  });
  assert.deepEqual(res.applied, ['a']);
  assert.deepEqual(res.failed, ['b']);
  assert.deepEqual(res.failures, [{ itemId: 'b', reason: 'Duplicate of another tab', error: 'No tab with id: 12.' }]);
});

const read = (f) => fs.readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('the panel status names the first failure', () => {
  assert.match(read('sidepanel/plan-view.js'), /` \$\{n\} failed: \$\{f\.reason\}: \$\{why\}\$\{more\}\.`/);
  assert.match(read('background/service-worker.js'), /failures: applyRes\.failures \|\| \[\]/);
});

test('the Undo after Apply stays until used, sits under the Open tabs result, and clears on Analyze', () => {
  const undo = read('sidepanel/undo.js');
  assert.doesNotMatch(undo, /setTimeout\(\(\) => \{ toast\.hidden = true/);
  const html = read('sidepanel/sidepanel.html');
  const toastIdx = html.indexOf('id="undoToast"');
  assert.ok(toastIdx > html.indexOf('id="planActions"') && toastIdx < html.indexOf('id="parkedGroupsHeading"'));
  assert.match(read('sidepanel/plan-view.js'), /if \(toast\) toast\.hidden = true;/);
});
