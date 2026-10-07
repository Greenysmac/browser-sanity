// TASK 1 — dark mode that reads right on the new-tab page and the side-panel
// board. Both stylesheets must opt into the OS theme (color-scheme: light dark),
// define the same token set in a dark media block, and style every board piece
// (the ⋯ menu, its items, the rows and the buttons) through those tokens rather
// than with browser defaults or fixed colors, so nothing paints as a white
// system button or dark-on-dark text in dark mode.
// Like the other CSS suites there is no browser here; the checks read each
// stylesheet as text and assert on the relevant rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const newtabCss = readFileSync(new URL('../extension/newtab/newtab.css', import.meta.url), 'utf8');
const panelCss = readFileSync(new URL('../extension/sidepanel/sidepanel.css', import.meta.url), 'utf8');

// The declaration block for a selector, e.g. ".boardMenu {\n ... \n}".
function block(css, selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i !== -1, `${selector} rule exists`);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  assert.ok(close !== -1, `${selector} rule closes`);
  return css.slice(open + 1, close);
}

// The body of the `@media (prefers-color-scheme: dark)` block (its :root, with
// the token re-definitions).
function darkBlock(css) {
  const i = css.indexOf('@media (prefers-color-scheme: dark)');
  assert.ok(i !== -1, 'a dark media block exists');
  const open = css.indexOf('{', i);
  // The media block wraps a :root { ... }; the inner close then the outer close.
  const innerOpen = css.indexOf('{', open + 1);
  const innerClose = css.indexOf('}', innerOpen);
  return css.slice(innerOpen + 1, innerClose);
}

// Both files are checked the same way, so run the shared assertions over each.
const sheets = [
  { name: 'newtab.css', css: newtabCss },
  { name: 'sidepanel.css', css: panelCss },
];

for (const { name, css } of sheets) {
  test(`${name}: :root opts into the OS theme with color-scheme: light dark`, () => {
    const root = block(css, ':root');
    assert.match(root, /color-scheme:\s*light\s+dark/, 'color-scheme follows the OS theme');
  });

  test(`${name}: the dark media block redefines the menu and button tokens`, () => {
    const dark = darkBlock(css);
    assert.match(dark, /--menu-bg:/, 'the dark block defines the menu background token');
    assert.match(dark, /--menu-hover:/, 'the dark block defines the menu hover token');
    assert.match(dark, /--surface:/, 'the dark block defines the button surface token');
    assert.match(dark, /--text:/, 'the dark block defines the button text token');
  });

  test(`${name}: the ⋯ menu styles background and color through tokens`, () => {
    const menu = block(css, '.boardMenu');
    assert.match(menu, /background:\s*var\(--/, 'the menu background is a token');
    assert.match(menu, /color:\s*var\(--/, 'the menu text color is a token');
  });

  test(`${name}: the menu buttons use tokens and have a hover rule`, () => {
    const menuBtn = block(css, '.boardMenu button');
    assert.match(menuBtn, /color:\s*var\(--/, 'menu item color is a token');
    assert.match(menuBtn, /background:\s*var\(--|background:\s*transparent/, 'menu item background is a token (or transparent over the token menu)');
    const hover = block(css, '.boardMenu button:hover');
    assert.match(hover, /background:\s*var\(--/, 'menu items highlight through a token on hover');
  });

  test(`${name}: the board rows style background and color through tokens`, () => {
    const row = block(css, '.boardRow');
    assert.match(row, /background:\s*var\(--/, 'the row background is a token');
    // The row inherits text color from body (var(--text)); the base button rule
    // that styles the row's ⋯ button must set color through a token. Match the
    // base `button {` rule at the start of a line (not a scoped `.x button {`).
    const bi = css.search(/(^|\n)button\s*\{/);
    assert.ok(bi !== -1, 'a base button rule exists');
    const bOpen = css.indexOf('{', bi);
    const button = css.slice(bOpen + 1, css.indexOf('}', bOpen));
    assert.match(button, /color:\s*var\(--/, 'buttons set text color through a token');
    assert.match(button, /background:\s*var\(--/, 'buttons set background through a token');
  });
}
