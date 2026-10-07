import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// In a real browser element.children is an HTMLCollection, not an Array, so
// .find/.filter/.includes/.some on it throw. The unit tests' fake DOM uses real
// arrays and can't catch that (found by Mycroft in a real browser, 2026-10-07).
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
