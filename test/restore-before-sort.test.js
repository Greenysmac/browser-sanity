// TASK 2 — the header's undo control is a labelled "Restore before sort" button
// that undoes the most recent applied run through the existing undo log, reports
// "Restored" (or "Nothing to restore" when the log is empty), and leaves the full
// undo history reachable from the More view as "Undo history…". Covers:
//   1. the header button's text and the More view's "Undo history…" label in the HTML;
//   2. clicking the header button reverts the latest run via the existing undo path;
//   3. the empty case: it reports "Nothing to restore" and sends no undo;
//   4. the More view's "Undo history…" button opens the existing dialog.
// Like the other side-panel suites, this drives the modules with a hand-rolled
// fake DOM (no jsdom in this repo) rather than a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installChromeMock } from './helpers/chrome-mock.js';
import { initUndoHistory, restoreLatestRun } from '../extension/sidepanel/undo.js';

const html = readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8');

// ---- 1. The HTML carries the labelled button and the renamed history entry ----

test('the header undo button is a text button labelled "Restore before sort"', () => {
  const m = html.match(/<button[^>]*id="headerUndoBtn"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(m, 'headerUndoBtn exists');
  assert.ok(m[1].includes('Restore before sort'), 'button text reads "Restore before sort"');
  assert.ok(!m[1].includes('<svg'), 'the button is a text button, not an icon');
});

test('the More view keeps "Undo history…" as the way into the full dialog', () => {
  const m = html.match(/<button[^>]*id="showUndo"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(m, 'showUndo exists');
  assert.equal(m[1].trim(), 'Undo history…');
});

// ---- Fake DOM harness (mirrors the other side-panel suites) ------------------

function el(extra = {}) {
  const node = {
    children: [],
    hidden: false,
    textContent: '',
    listeners: {},
    onclick: null,
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    append(...kids) { this.children.push(...kids); },
    appendChild(kid) { this.children.push(kid); return kid; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    ...extra,
  };
  return node;
}

// A chrome mock that records every sendMessage and replies per the given handler.
function withMessageHandler(handler) {
  const sent = [];
  installChromeMock({
    runtime: {
      id: 'ext',
      sendMessage(msg, cb) { sent.push(msg); cb(handler(msg)); },
    },
  });
  return sent;
}

const UNDO_ENTRIES = [
  { undoId: 'u1', runId: 'r2', ts: 200, action: 'close', label: 'Closed a tab' },
  { undoId: 'u2', runId: 'r2', ts: 201, action: 'close', label: 'Closed a tab' },
  { undoId: 'u3', runId: 'r1', ts: 100, action: 'close', label: 'Closed a tab' },
];

// ---- 2. Clicking reverts the latest run through the existing undo path -------

test('restoreLatestRun undoes every change of the newest run and reports "Restored"', async () => {
  const statusText = el();
  globalThis.document = { getElementById: (id) => (id === 'statusText' ? statusText : null) };
  const sent = withMessageHandler((msg) =>
    msg.cmd === 'getUndo' ? { ok: true, entries: UNDO_ENTRIES } : { ok: true });

  await restoreLatestRun();

  const undoMsg = sent.find((m) => m.cmd === 'undo');
  assert.ok(undoMsg, 'an undo was sent');
  // Newest run is r2 (ts 200/201); both its entries revert, r1 is left alone.
  assert.deepEqual(undoMsg.undoIds, ['u1', 'u2']);
  assert.equal(statusText.textContent, 'Restored');
});

// ---- 3. The empty case: nothing to restore -----------------------------------

test('restoreLatestRun reports "Nothing to restore" and sends no undo when the log is empty', async () => {
  const statusText = el();
  globalThis.document = { getElementById: (id) => (id === 'statusText' ? statusText : null) };
  const sent = withMessageHandler((msg) =>
    msg.cmd === 'getUndo' ? { ok: true, entries: [] } : { ok: true });

  await restoreLatestRun();

  assert.equal(statusText.textContent, 'Nothing to restore');
  assert.ok(!sent.some((m) => m.cmd === 'undo'), 'no undo command was sent');
});

// ---- 4. "Undo history…" still opens the existing dialog ----------------------

test('the More view\'s "Undo history…" button opens the existing undo-history dialog', async () => {
  const showUndo = el();
  const headerUndoBtn = el();
  const undoList = el();
  const undoDialog = el({ querySelector: () => el() });
  const els = { showUndo, headerUndoBtn, undoList, undoDialog };
  globalThis.document = {
    getElementById: (id) => els[id] || null,
    createElement: () => el(),
  };
  withMessageHandler((msg) => (msg.cmd === 'getUndo' ? { ok: true, entries: UNDO_ENTRIES } : { ok: true }));

  initUndoHistory();
  await showUndo.listeners.click();

  assert.equal(undoDialog.open, true, 'the dialog is shown modally');
});
