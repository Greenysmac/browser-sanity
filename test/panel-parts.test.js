// TASK 3 — the side panel reads as two labelled parts. "Open tabs" sits over the
// sort card (with the sort result card right below it); "Parked groups" sits over
// a Re-analyze button, the re-analyze card, and the split card, just before the
// board. The More view's duplicate Re-analyze button is gone (the board link
// still drives onTidyParked), and the leftovers the user doesn't use — the Run
// one row, the Settings Bookmarks fieldset, and the Sessions section — carry the
// hidden attribute (markup kept so existing JS lookups keep working).
// Like the sibling suites, this reads the static HTML/JS rather than a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8');
const panelJs = readFileSync(new URL('../extension/sidepanel/sidepanel.js', import.meta.url), 'utf8');

// Index of a needle in the HTML, asserting it exists.
function at(needle, where = html) {
  const i = where.indexOf(needle);
  assert.ok(i !== -1, `${needle} exists`);
  return i;
}

// ---- The two headings, their muted lines, and the cards, in order -----------

test('"Open tabs" heading and its muted line sit over the sort card, result card below', () => {
  const heading = at('id="openTabsHeading">Open tabs');
  const line = at("Sorts the tabs open right now. Tabs for parked groups are put away in them.");
  const sortCard = at('id="sortCard"');
  const resultCard = at('id="resultCard"');
  assert.ok(heading < line, 'the heading precedes its muted line');
  assert.ok(line < sortCard, 'the muted line sits over the sort card');
  assert.ok(sortCard < resultCard, 'the sort result card stays right below');
});

test('"All groups" heading, its line, a Re-analyze button, then the re-analyze and split cards, before the board', () => {
  const heading = at('>All groups</h2>');
  const line = at('Your open and parked groups. Drag a parked group to move it, or into another collection.');
  const reanalyze = at('id="reanalyzeParked"');
  const tidyCard = at('id="tidyCard"');
  const splitCard = at('id="splitCard"');
  const board = at('id="board"');
  assert.ok(heading < line, 'the heading precedes its muted line');
  assert.ok(line < reanalyze, 'the muted line sits over the Re-analyze button');
  assert.ok(reanalyze < tidyCard, 'the re-analyze card follows the button');
  assert.ok(tidyCard < splitCard, 'the split card follows the re-analyze card');
  assert.ok(splitCard < board, 'both cards sit before the board');
});

test('the Open tabs part comes before the All groups part', () => {
  assert.ok(at('id="openTabsHeading">Open tabs') < at('>All groups</h2>'), 'Open tabs is listed first');
});

// ---- The duplicate More-view button is gone; the board link still drives it --

test('the More view no longer carries its own Re-analyze (#tidyParked) button', () => {
  assert.equal(html.indexOf('id="tidyParked"'), -1, '#tidyParked is removed from the markup');
});

test('the Parked-groups Re-analyze button is wired to onTidyParked', () => {
  assert.match(
    panelJs,
    /\$\('reanalyzeParked'\)[\s\S]*?addEventListener\('click', onTidyParked\)/,
    'the part button calls the same onTidyParked handler',
  );
});

test('the board link still drives onTidyParked (unchanged)', () => {
  const board = readFileSync(new URL('../extension/board/board.js', import.meta.url), 'utf8');
  assert.match(board, /onTidyParked\(\)/, 'the board header link still calls onTidyParked');
});

// ---- Leftovers hidden with the hidden attribute (markup kept) ---------------

test('the Run one row carries the hidden attribute (markup kept for JS lookups)', () => {
  assert.match(html, /<div class="quickActions" hidden>/, '.quickActions is hidden');
  assert.ok(html.includes('id="runOne"'), 'but the #runOne markup is still present');
});

test('the Settings Bookmarks fieldset carries the hidden attribute', () => {
  const idx = at('<legend>Bookmarks</legend>');
  const before = html.slice(0, idx);
  const open = before.lastIndexOf('<fieldset');
  assert.ok(open !== -1, 'the Bookmarks fieldset opening tag exists');
  const tag = html.slice(open, idx);
  assert.match(tag, /<fieldset hidden>/, 'the Bookmarks fieldset is hidden');
});

test('the Sessions section carries the hidden attribute (markup kept)', () => {
  assert.match(html, /<details id="sessions" hidden>/, '#sessions is hidden');
  assert.ok(html.includes('id="sessionList"'), 'but its inner markup is still present');
});
