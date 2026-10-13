import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// In a real browser element.children is an HTMLCollection, not an Array, so
// .find/.filter/.includes/.some on it throw. The unit tests' fake DOM uses real
// arrays and can't catch that (found in a real browser).
test('board.js never calls array methods directly on element.children', () => {
  const src = fs.readFileSync(new URL('../extension/board/board.js', import.meta.url), 'utf8');
  const bad = src.match(/(?<!Array\.from)\(\s*\w+\.children\s*\|\|\s*\[\]\s*\)\.(find|filter|includes|some|map|forEach)\(/g) || [];
  assert.deepEqual(bad, []);
});

// Chrome lays out a <details> element's content through ::details-content, so a
// grid on the details element itself leaves the rows in one column.
test('the new-tab sections put their grid on ::details-content', () => {
  const css = fs.readFileSync(new URL('../extension/newtab/newtab.css', import.meta.url), 'utf8');
  assert.match(css, /\.boardSection::details-content\s*\{[^}]*display:\s*grid/);
});

// element.children has only a getter in a real browser; assigning to it throws
// in a module ("Cannot set property children of #<Element> which has only a
// getter"). That crash stopped the split card from ever showing (2026-10-10).
// The fake DOM allows it, so guard the source instead.
const EXT_FILES = [
  'board/board.js', 'sidepanel/split-view.js', 'sidepanel/tidy-view.js', 'sidepanel/sidepanel.js',
  'sidepanel/plan-view.js', 'sidepanel/main-panel.js', 'newtab/newtab.js',
];
const read = (f) => fs.readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8');

test('no extension page assigns to element.children', () => {
  for (const f of EXT_FILES) {
    const bad = read(f).match(/\.children\s*=(?!=)/g) || [];
    assert.deepEqual(bad, [], f);
  }
});

// Looping a live HTMLCollection while moving its items out skips every other
// one; loops over .children must copy it with Array.from first.
test('no extension page loops a live children list directly', () => {
  for (const f of EXT_FILES) {
    const bad = read(f).match(/\bof\s+(?!Array\.from)[\w.]+\.children\b/g) || [];
    assert.deepEqual(bad, [], f);
  }
});

// The same HTMLCollection trap in any page, not just board.js: run 14's "From"
// line called (card.children || []).find, which throws in real Chrome.
test('no extension page calls array methods directly on element.children', () => {
  for (const f of EXT_FILES) {
    const bad = read(f).match(/(?<!Array\.from)\(\s*[\w.]+\.children\s*\|\|\s*\[\]\s*\)\.(find|filter|includes|some|map|forEach|every)\(/g) || [];
    assert.deepEqual(bad, [], f);
  }
});

// A class rule like `.quickActions { display: flex }` beats the hidden
// attribute, so every element the panel hides by attribute needs a [hidden] rule.
test('the hidden Run one row really hides', () => {
  const css = fs.readFileSync(new URL('../extension/sidepanel/sidepanel.css', import.meta.url), 'utf8');
  assert.match(css, /\.quickActions\[hidden\]\s*\{\s*display:\s*none/);
});
