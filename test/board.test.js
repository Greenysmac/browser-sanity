// Board view tests. The panel has no jsdom harness (see settings-view.test.js),
// so this installs a tiny fake document that supports just the DOM surface
// renderBoard uses: createElement, textContent/value/style, append/appendChild,
// and querySelector(All) for inspecting the result. A fake `send` returns the
// board data and records every cmd dispatched so we can assert each button
// wires the right command and ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoard } from '../extension/board/board.js';

// A minimal element: children + text, enough createElement surface for the view.
function makeEl(tag) {
  const el = {
    tagName: String(tag || '').toUpperCase(),
    children: [],
    className: '',
    type: '',
    rows: 0,
    value: '',
    open: false,
    style: {},
    listeners: {},
    parent: null,
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) {
      // Setting textContent to '' is how the view clears a container before a
      // (re)render, matching the real DOM.
      this._text = String(v);
      if (v === '') this.children = [];
    },
    append(...kids) { for (const k of kids) { if (k) k.parent = this; } this.children.push(...kids); },
    appendChild(kid) { if (kid) kid.parent = this; this.children.push(kid); return kid; },
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { if (this.listeners.click) return this.listeners.click(); },
  };
  return el;
}

function installFakeDocument() {
  const docListeners = {};
  globalThis.document = {
    createElement: (tag) => makeEl(tag),
    addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || new Set()).add(fn); },
    removeEventListener(ev, fn) { if (docListeners[ev]) docListeners[ev].delete(fn); },
    // Test-only: trip every listener registered for an event, mirroring a real
    // dispatch so the menu's Escape/outside-click handlers can be exercised.
    _fire(ev, arg) { for (const fn of (docListeners[ev] || [])) fn(arg); },
  };
}

// Recursively collect every descendant element (plus the node itself).
function walk(el, out = []) {
  if (!el) return out;
  out.push(el);
  for (const kid of el.children || []) walk(kid, out);
  return out;
}

function allText(el) {
  return walk(el).map((n) => n.textContent).filter(Boolean);
}

function findByText(el, text) {
  return walk(el).find((n) => n.textContent === text);
}

// Open the ⋯ menu on the row that contains the given group name, returning the
// row element. The menu's items (buttons) then live inside that row.
function openRowMenu(container, name) {
  const nameEl = walk(container).find((n) => n.className === 'boardName' && n.textContent === name);
  const row = nameEl && nameEl.parent;
  const menuBtn = (row.children || []).find((c) => c.className === 'boardMenuBtn');
  menuBtn.click();
  return row;
}

// A fake send that records dispatched messages and answers 'boardData' with the
// supplied fixture; everything else resolves { ok: true }.
function makeSend(boardData) {
  const sent = [];
  const send = (msg) => {
    sent.push(msg);
    if (msg.cmd === 'boardData') return Promise.resolve({ ok: true, ...boardData });
    return Promise.resolve({ ok: true });
  };
  return { send, sent };
}

const FIXTURE = {
  open: [{ groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 3 }],
  parked: [{ name: 'Travel', color: 'green', tabCount: 5, lastSeen: '2026-01-02T10:00:00.000Z' }],
  descriptions: [{ name: 'Work', description: 'day job stuff' }],
};

test('renderBoard draws both sections with their summaries', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const texts = allText(container);
  assert.ok(texts.includes('Open now · 1'), 'Open now section header with count');
  assert.ok(texts.includes('Parked · 1'), 'Parked section header with count');
});

test('renderBoard shows an open card with name and tab count', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const texts = allText(container);
  assert.ok(texts.includes('Work'), 'open group name');
  assert.ok(texts.includes('3 tabs'), 'open group tab count');
});

test('renderBoard shows a parked card with count and last-seen date', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const texts = allText(container);
  assert.ok(texts.includes('Travel'), 'parked group name');
  assert.ok(texts.some((t) => t === '5 tabs'), 'parked meta line shows just the count (the date is on hover)');
});

test('a parked entry with the same name as an open group is not rendered', async () => {
  installFakeDocument();
  const container = makeEl('div');
  // Same name as the open 'Work' group, differing only by surrounding space and
  // case — it should be dropped from the parked list.
  const { send } = makeSend({
    open: [{ groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 3 }],
    parked: [{ name: '  work  ', color: 'green', tabCount: 2, lastSeen: '2026-01-02T10:00:00.000Z' }],
    descriptions: [],
  });
  await renderBoard(container, { send });
  const texts = allText(container);
  assert.ok(texts.includes('Nothing parked yet'), 'parked section is empty');
  // No Open button, since the one parked entry was dropped.
  assert.ok(!findByText(container, 'Open'), 'no parked card rendered');
});

test('Sort this group sends sortGroup with the group id', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send, sent } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  openRowMenu(container, 'Work');
  await findByText(container, 'Sort this group').click();
  const req = sent.find((m) => m.cmd === 'sortGroup');
  assert.ok(req, 'a sortGroup command was sent');
  assert.equal(req.groupId, 7);
});

test('Park sends parkGroup with the group id', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send, sent } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  openRowMenu(container, 'Work');
  await findByText(container, 'Park').click();
  const req = sent.find((m) => m.cmd === 'parkGroup');
  assert.ok(req, 'a parkGroup command was sent');
  assert.equal(req.groupId, 7);
});

test('Open sends openParked with the parked group name', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send, sent } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  openRowMenu(container, 'Travel');
  await findByText(container, 'Open').click();
  const req = sent.find((m) => m.cmd === 'openParked');
  assert.ok(req, 'an openParked command was sent');
  assert.equal(req.name, 'Travel');
});

test('Save in a row description editor sends groupsWrite with the edited text and confirms', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send, sent } = makeSend(FIXTURE);
  const statuses = [];
  await renderBoard(container, { send, setStatus: (t) => statuses.push(t) });
  // Open the open (Work) row's menu and choose Description… to reveal the editor.
  openRowMenu(container, 'Work');
  await findByText(container, 'Description…').click();
  // The editor's textarea is prefilled from the matching saved description.
  const textarea = walk(container).find((n) => n.tagName === 'TEXTAREA' && n.value === 'day job stuff');
  assert.ok(textarea, 'description textarea prefilled from descriptions');
  textarea.value = 'updated note';
  await findByText(container, 'Save').click();
  const req = sent.find((m) => m.cmd === 'groupsWrite');
  assert.ok(req, 'a groupsWrite command was sent');
  assert.equal(req.name, 'Work');
  assert.equal(req.description, 'updated note');
  assert.ok(statuses.some((s) => /Saved description/.test(s)), 'status line confirms the save');
});

test('empty sections read the right empty-state text', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend({ open: [], parked: [], descriptions: [] });
  await renderBoard(container, { send });
  const texts = allText(container);
  assert.ok(texts.includes('No open groups'), 'empty open state');
  assert.ok(texts.includes('Nothing parked yet'), 'empty parked state');
});

test('both top-level sections are open <details> so the user can fold them', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const details = walk(container).filter((n) => n.tagName === 'DETAILS' && n.className === 'boardSection');
  assert.equal(details.length, 2);
  assert.ok(details.every((d) => d.open === true), 'both sections start open');
});

// A fake chrome.storage.local-shaped store for the once-a-day describe memory.
function makeStorage(initial = {}) {
  let data = { ...initial };
  return {
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (obj) => { data = { ...data, ...obj }; },
    peek: () => data,
  };
}

// A send that answers boardData with the current fixture (so a re-render can
// pick up a changed fixture), records every message, and answers describe with
// the supplied result. Lets a test flip the fixture after describe writes.
function makeDescribeSend(getFixture, describeResult) {
  const sent = [];
  const send = (msg) => {
    sent.push(msg);
    if (msg.cmd === 'boardData') return Promise.resolve({ ok: true, ...getFixture() });
    if (msg.cmd === 'describe') return Promise.resolve({ ok: true, ...describeResult });
    return Promise.resolve({ ok: true });
  };
  return { send, sent };
}

// Let fire-and-forget autoDescribe promises settle (it isn't awaited by render).
async function flush() {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

const NO_DESC = {
  open: [{ groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 3 }],
  parked: [],
  descriptions: [],
};

test('board asks the model to describe open groups that have no description', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage();
  const { send, sent } = makeDescribeSend(() => NO_DESC, { descriptions: [], written: 0 });
  await renderBoard(container, { send, storage, today: '2026-01-05' });
  await flush();
  const req = sent.find((m) => m.cmd === 'describe');
  assert.ok(req, 'a describe command was sent');
  assert.deepEqual(req.groups, [{ groupId: 7, name: 'Work' }]);
  // The ask is remembered so the next render that day doesn't ask again.
  assert.equal(storage.peek().boardDescribeAsked.work, '2026-01-05');
});

test('board does not re-describe a group already asked about today (once-a-day memory)', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage({ boardDescribeAsked: { work: '2026-01-05' } });
  const { send, sent } = makeDescribeSend(() => NO_DESC, { descriptions: [], written: 0 });
  await renderBoard(container, { send, storage, today: '2026-01-05' });
  await flush();
  assert.ok(!sent.some((m) => m.cmd === 'describe'), 'no describe sent when already asked today');
});

test('board asks again on a new day', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage({ boardDescribeAsked: { work: '2026-01-05' } });
  const { send, sent } = makeDescribeSend(() => NO_DESC, { descriptions: [], written: 0 });
  await renderBoard(container, { send, storage, today: '2026-01-06' });
  await flush();
  assert.ok(sent.some((m) => m.cmd === 'describe'), 'a new day asks again');
});

test('board skips open groups that already have a description', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage();
  // FIXTURE's open 'Work' group already has a description.
  const { send, sent } = makeDescribeSend(() => FIXTURE, { descriptions: [], written: 0 });
  await renderBoard(container, { send, storage, today: '2026-01-05' });
  await flush();
  assert.ok(!sent.some((m) => m.cmd === 'describe'), 'no describe for already-described groups');
});

test('a suggestion shows the waiting dot and fills the editor with a Suggested label', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage();
  const { send } = makeDescribeSend(() => NO_DESC, { descriptions: [{ name: 'Work', description: 'day job stuff' }], written: 0 });
  const statuses = [];
  await renderBoard(container, { send, setStatus: (t) => statuses.push(t), storage, today: '2026-01-05' });
  await flush();
  assert.ok(statuses.some((s) => s === 'Suggested descriptions for 1 group'), 'status reports the suggested count');
  // The suggestion is remembered with its date so later renders don't re-ask.
  assert.deepEqual(storage.peek().boardDescribeSuggestions.work, { description: 'day job stuff', date: '2026-01-05' });
  // The row carries the small waiting dot but no description text or Suggested
  // label until the editor is opened.
  assert.ok(walk(container).some((n) => n.className === 'boardSuggestDot'), 'the waiting dot shows on the row');
  assert.ok(!findByText(container, 'Suggested'), 'no Suggested label on the row itself');
  // Opening the editor prefills the suggestion and shows the Suggested label.
  openRowMenu(container, 'Work');
  await findByText(container, 'Description…').click();
  const textarea = walk(container).find((n) => n.tagName === 'TEXTAREA' && n.value === 'day job stuff');
  assert.ok(textarea, 'the editor is prefilled with the suggestion');
  assert.ok(findByText(container, 'Suggested'), 'the Suggested label is shown in the editor');
});

test('a stored suggestion renders without a describe call', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage({ boardDescribeSuggestions: { work: { description: 'day job stuff', date: '2026-01-05' } } });
  const { send, sent } = makeDescribeSend(() => NO_DESC, { descriptions: [], written: 0 });
  await renderBoard(container, { send, storage, today: '2026-01-06' });
  await flush();
  assert.ok(!sent.some((m) => m.cmd === 'describe'), 'no describe sent when a suggestion is already stored');
  assert.ok(walk(container).some((n) => n.className === 'boardSuggestDot'), 'the waiting dot shows for the stored suggestion');
  openRowMenu(container, 'Work');
  await findByText(container, 'Description…').click();
  const textarea = walk(container).find((n) => n.tagName === 'TEXTAREA' && n.value === 'day job stuff');
  assert.ok(textarea, 'the stored suggestion is prefilled in the editor');
  assert.ok(findByText(container, 'Suggested'), 'the Suggested label is shown for the stored suggestion');
});

test('Save on a suggested row sends groupsWrite and closes the editor', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage({ boardDescribeSuggestions: { work: { description: 'day job stuff', date: '2026-01-05' } } });
  const { send, sent } = makeDescribeSend(() => NO_DESC, { descriptions: [], written: 0 });
  await renderBoard(container, { send, storage, today: '2026-01-06' });
  await flush();
  openRowMenu(container, 'Work');
  await findByText(container, 'Description…').click();
  assert.ok(findByText(container, 'Suggested'), 'the Suggested label is shown before saving');
  await findByText(container, 'Save').click();
  const req = sent.find((m) => m.cmd === 'groupsWrite');
  assert.ok(req, 'a groupsWrite command was sent');
  assert.equal(req.name, 'Work');
  assert.equal(req.description, 'day job stuff');
  // Saving removes the editor, so the Suggested label is gone with it.
  assert.ok(!findByText(container, 'Suggested'), 'the editor (and its Suggested label) is closed after saving');
});

test('a saved description is never replaced by a suggestion', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage();
  // The open 'Work' group has a saved description; a stale suggestion also
  // exists for it. The saved description must win, no waiting dot shows, and the
  // editor prefills from the saved text with no Suggested label.
  const fixture = {
    open: [{ groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 3 }],
    parked: [],
    descriptions: [{ name: 'Work', description: 'day job stuff' }],
  };
  storage.peek().boardDescribeSuggestions = { work: { description: 'a stale suggestion', date: '2026-01-05' } };
  const { send } = makeDescribeSend(() => fixture, { descriptions: [], written: 0 });
  await renderBoard(container, { send, storage, today: '2026-01-06' });
  await flush();
  assert.ok(!walk(container).some((n) => n.className === 'boardSuggestDot'), 'no waiting dot when a description is saved');
  openRowMenu(container, 'Work');
  await findByText(container, 'Description…').click();
  const saved = walk(container).find((n) => n.tagName === 'TEXTAREA' && n.value === 'day job stuff');
  assert.ok(saved, 'the saved description is shown in the editor');
  assert.ok(!walk(container).some((n) => n.tagName === 'TEXTAREA' && n.value === 'a stale suggestion'), 'the suggestion did not replace it');
  assert.ok(!findByText(container, 'Suggested'), 'no Suggested label when a description is saved');
});

// --- live updates, web-tab counts, no-web-pages and also-parked ------------

// A fake chrome.tabGroups/tabs with just the event surface renderBoard wires:
// each event is an object with add/removeListener and a fire() to trip it. The
// board also reads chrome.storage.local via defaultStorage, so none is set here
// and the tests pass an explicit storage.
function makeChromeEvents() {
  const mkEvent = () => {
    const fns = new Set();
    return {
      addListener: (fn) => fns.add(fn),
      removeListener: (fn) => fns.delete(fn),
      fire: (...args) => { for (const fn of fns) fn(...args); },
      count: () => fns.size,
    };
  };
  return {
    tabGroups: {
      onCreated: mkEvent(), onUpdated: mkEvent(), onRemoved: mkEvent(), onMoved: mkEvent(),
    },
    tabs: {
      onCreated: mkEvent(), onRemoved: mkEvent(), onUpdated: mkEvent(),
      onAttached: mkEvent(), onDetached: mkEvent(),
    },
  };
}

test('a tab-group event triggers one debounced re-render', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage();
  let boardCalls = 0;
  const send = (msg) => {
    if (msg.cmd === 'boardData') { boardCalls += 1; return Promise.resolve({ ok: true, ...FIXTURE }); }
    return Promise.resolve({ ok: true });
  };
  const chromeApi = makeChromeEvents();
  await renderBoard(container, { send, storage, chromeApi, debounceMs: 10 });
  assert.equal(boardCalls, 1, 'the initial render requested boardData once');

  // A burst of events within the debounce window collapses into one re-render.
  chromeApi.tabGroups.onCreated.fire();
  chromeApi.tabs.onRemoved.fire();
  chromeApi.tabGroups.onMoved.fire();
  assert.equal(boardCalls, 1, 'no re-render has fired yet (still debouncing)');
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(boardCalls, 2, 'the burst produced exactly one debounced re-render');
});

test('tabs.onUpdated only re-renders when groupId or url changed', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage();
  let boardCalls = 0;
  const send = (msg) => {
    if (msg.cmd === 'boardData') { boardCalls += 1; return Promise.resolve({ ok: true, ...FIXTURE }); }
    return Promise.resolve({ ok: true });
  };
  const chromeApi = makeChromeEvents();
  await renderBoard(container, { send, storage, chromeApi, debounceMs: 10 });

  // A title/favicon change is ignored.
  chromeApi.tabs.onUpdated.fire(1, { title: 'new title' });
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(boardCalls, 1, 'an unrelated change does not re-render');

  // A groupId change re-renders.
  chromeApi.tabs.onUpdated.fire(1, { groupId: 9 });
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(boardCalls, 2, 'a groupId change re-renders');
});

test('the teardown removes every live-update listener', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage();
  const { send } = makeSend(FIXTURE);
  const chromeApi = makeChromeEvents();
  const teardown = await renderBoard(container, { send, storage, chromeApi, debounceMs: 10 });
  const events = [
    chromeApi.tabGroups.onCreated, chromeApi.tabGroups.onUpdated, chromeApi.tabGroups.onRemoved,
    chromeApi.tabGroups.onMoved, chromeApi.tabs.onCreated, chromeApi.tabs.onRemoved,
    chromeApi.tabs.onUpdated, chromeApi.tabs.onAttached, chromeApi.tabs.onDetached,
  ];
  assert.ok(events.every((e) => e.count() === 1), 'each event has one listener attached');
  teardown();
  assert.ok(events.every((e) => e.count() === 0), 'teardown removed every listener');
});

test('open-card counts show web tabs only (webTabCount), not the raw tab count', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend({
    // 5 tabs in the group but only 3 are web pages.
    open: [{ groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 5, webTabCount: 3 }],
    parked: [],
    descriptions: [],
  });
  await renderBoard(container, { send });
  const texts = allText(container);
  assert.ok(texts.includes('3 tabs'), 'the card shows the web-tab count');
  assert.ok(!texts.includes('5 tabs'), 'the raw tab count is not shown');
});

test('an open group with no web pages reads "no web pages" and offers Close group', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send, sent } = makeSend({
    open: [{ groupId: 7, name: 'Scratch', color: 'grey', windowId: 1, tabCount: 2, webTabCount: 0 }],
    parked: [],
    descriptions: [],
  });
  await renderBoard(container, { send });
  const texts = allText(container);
  assert.ok(texts.includes('no web pages'), 'the no-web-pages count text');
  openRowMenu(container, 'Scratch');
  assert.ok(findByText(container, 'Close group'), 'a Close group item is offered');
  assert.ok(!findByText(container, 'Park'), 'Park is not offered for a group with no web pages');
  await findByText(container, 'Close group').click();
  const req = sent.find((m) => m.cmd === 'closeGroup');
  assert.ok(req, 'a closeGroup command was sent');
  assert.equal(req.groupId, 7);
});

test('an open row whose name matches a parked record offers an "Add back <n> parked tabs" menu item', async () => {
  installFakeDocument();
  const container = makeEl('div');
  // 'Work' is open and also has a parked record under the same name (differing
  // only by case/space): the open row's menu offers to add those parked tabs back.
  const { send, sent } = makeSend({
    open: [{ groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 3, webTabCount: 3 }],
    parked: [{ name: '  work  ', color: 'blue', tabCount: 4, lastSeen: '2026-01-02T10:00:00.000Z' }],
    descriptions: [],
  });
  await renderBoard(container, { send });
  // The same-named parked record is not shown as its own parked row.
  assert.ok(allText(container).includes('Nothing parked yet'), 'the parked section stays empty for the same-named record');
  openRowMenu(container, 'Work');
  const addItem = findByText(container, 'Add back 4 parked tabs');
  assert.ok(addItem, 'an Add back <n> parked tabs item is offered');
  await addItem.click();
  const req = sent.find((m) => m.cmd === 'openParked');
  assert.ok(req, 'an openParked command was sent');
  assert.equal(req.name, 'Work', 'it opens the parked record by the open group name');
  assert.equal(req.groupId, 7, 'it folds the tabs into the existing open group');
});

// --- compact rows, per-row ⋯ menus, and section-header counts --------------

// Collect the labels of the buttons inside the menu currently open under a row.
function menuLabels(row) {
  const menu = (row.children || []).find((c) => c.className === 'boardMenu');
  if (!menu) return [];
  return walk(menu).filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
}

test('each group renders as a single compact row with dot, name, count and a ⋯ button', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  // One row per group: one open ('Work'), one parked ('Travel'). The parked
  // row carries an extra 'boardRow--parked' class, so match the base token
  // rather than the whole className string.
  const rows = walk(container).filter((n) => /(^|\s)boardRow(\s|$)/.test(n.className || ''));
  assert.equal(rows.length, 2, 'exactly one row per group');
  const openRow = rows.find((r) => (r.children || []).some((c) => c.className === 'boardName' && c.textContent === 'Work'));
  assert.ok(openRow, 'the open group has a row');
  // The row carries its parts: a color dot, the name, a muted count, and a ⋯ button.
  assert.ok((openRow.children || []).some((c) => c.className === 'boardDot'), 'row has a color dot');
  assert.ok((openRow.children || []).some((c) => c.className === 'boardName' && c.textContent === 'Work'), 'row has the name');
  // The count now sits inside a right-aligned container rather than directly on
  // the row (it moved to the top right); the text is still '3 tabs'.
  const countWrap = (openRow.children || []).find((c) => c.className === 'boardCountWrap');
  assert.ok(countWrap, 'row has a right-aligned count container');
  assert.ok((countWrap.children || []).some((c) => c.className === 'boardCount' && c.textContent === '3 tabs'), 'the container holds the muted count');
  assert.ok((openRow.children || []).some((c) => c.className === 'boardMenuBtn' && c.textContent === '⋯'), 'row has a ⋯ button');
  // Nothing about the description shows on the row (Work has a saved description).
  assert.ok(!(openRow.children || []).some((c) => c.tagName === 'TEXTAREA'), 'no inline editor until opened');
  assert.ok(!(openRow.children || []).some((c) => c.className === 'boardSuggestDot'), 'no waiting dot when a description is saved');
});

test('the ⋯ menu lists the open-row actions (Sort, Split, Park, Description…)', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const row = openRowMenu(container, 'Work');
  assert.deepEqual(menuLabels(row), ['Sort this group', 'Split this group…', 'Park', 'Description…']);
});

test('the ⋯ menu lists the parked-row actions (Open, Split, Description…)', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const row = openRowMenu(container, 'Travel');
  assert.deepEqual(menuLabels(row), ['Open', 'Split this group…', 'Description…']);
});

test('Description… opens an inline editor with Save and Cancel under the row', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const row = openRowMenu(container, 'Work');
  await findByText(container, 'Description…').click();
  const editor = (row.children || []).find((c) => c.className === 'boardDescEditor');
  assert.ok(editor, 'the editor is appended under the row');
  assert.ok(walk(editor).some((n) => n.tagName === 'TEXTAREA'), 'the editor has a textarea');
  assert.ok(walk(editor).some((n) => n.textContent === 'Save'), 'the editor has a Save button');
  assert.ok(walk(editor).some((n) => n.textContent === 'Cancel'), 'the editor has a Cancel button');
  // Cancel removes the editor again.
  await findByText(container, 'Cancel').click();
  assert.ok(!(row.children || []).some((c) => c.className === 'boardDescEditor'), 'Cancel closes the editor');
});

test('Escape closes an open ⋯ menu', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const row = openRowMenu(container, 'Work');
  assert.ok((row.children || []).some((c) => c.className === 'boardMenu'), 'the menu is open');
  // Pressing Escape anywhere closes it.
  document._fire('keydown', { key: 'Escape' });
  assert.ok(!(row.children || []).some((c) => c.className === 'boardMenu'), 'the menu is closed after Escape');
});

test('a click outside the ⋯ menu closes it', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const row = openRowMenu(container, 'Work');
  assert.ok((row.children || []).some((c) => c.className === 'boardMenu'), 'the menu is open');
  // The opening click itself must not close the menu: the outside-click
  // listener is attached on the next tick (real-browser fix, 2026-10-07).
  document._fire('click', { target: makeEl('div') });
  assert.ok((row.children || []).some((c) => c.className === 'boardMenu'), 'the opening click does not close it');
  await new Promise((r) => setTimeout(r, 0));
  // A later document click on something that isn't the menu closes it.
  document._fire('click', { target: makeEl('div') });
  assert.ok(!(row.children || []).some((c) => c.className === 'boardMenu'), 'the menu is closed after an outside click');
});

test('section headers show the group counts, e.g. "Open now · 5" and "Parked · 10"', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const mk = (n, prefix) => Array.from({ length: n }, (_, i) => ({ groupId: i + 1, name: `${prefix}${i + 1}`, color: 'blue', windowId: 1, tabCount: 1 }));
  const { send } = makeSend({
    open: mk(5, 'Open'),
    parked: Array.from({ length: 10 }, (_, i) => ({ name: `Park${i + 1}`, color: 'green', tabCount: 1, lastSeen: '2026-01-02T10:00:00.000Z' })),
    descriptions: [],
  });
  await renderBoard(container, { send });
  const texts = allText(container);
  assert.ok(texts.includes('Open now · 5'), 'open header shows its count');
  assert.ok(texts.includes('Parked · 10'), 'parked header shows its count');
});

// --- click-to-expand: description, titles, single-open, keyboard -----------

// The row element that holds a given group name.
function rowFor(container, name) {
  const nameEl = walk(container).find((n) => n.className === 'boardName' && n.textContent === name);
  return nameEl && nameEl.parent;
}

// Trip a row's click handler with an optional event target, mirroring a real
// click bubbling up to the row (the fake DOM doesn't bubble on its own).
function clickRow(row, target) {
  if (row.listeners.click) row.listeners.click({ target });
}

// The expanded area under a row (built on click), or undefined when collapsed.
function expandedOf(row) {
  return (row.children || []).find((c) => c && c.className === 'boardExpanded');
}

// A chrome-like api exposing tabs.query/update and windows.update, recording
// the focus calls so a test can assert a title click focused the right tab.
function makeFocusChrome(tabsByGroup = {}) {
  const calls = { tabUpdate: [], windowUpdate: [] };
  return {
    api: {
      tabs: {
        query: async ({ groupId }) => tabsByGroup[groupId] || [],
        update: (id, info) => { calls.tabUpdate.push({ id, info }); },
      },
      windows: {
        update: (id, info) => { calls.windowUpdate.push({ id, info }); },
      },
    },
    calls,
  };
}

test('clicking an open row expands it with the description and tab titles', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  const { api } = makeFocusChrome({ 7: [{ id: 11, title: 'Spec doc', url: 'https://a', windowId: 1 }, { id: 12, title: 'Ticket', url: 'https://b', windowId: 1 }] });
  await renderBoard(container, { send, chromeApi: api });
  const row = rowFor(container, 'Work');
  clickRow(row);
  await flush();
  const area = expandedOf(row);
  assert.ok(area, 'the row expanded');
  // The saved description shows (FIXTURE's Work has 'day job stuff').
  assert.ok(walk(area).some((n) => n.textContent === 'day job stuff'), 'the description shows');
  assert.ok(walk(area).some((n) => n.textContent === 'Edit'), 'an Edit button shows');
  // Both live tab titles appear as links, each with the bold site name and the
  // page title.
  const links = walk(area).filter((n) => n.tagName === 'A');
  const titleOf = (n) => (walk(n).find((c) => c.className === 'boardTabTitle') || {}).textContent;
  assert.ok(links.some((a) => titleOf(a) === 'Spec doc'), 'first tab title link');
  assert.ok(links.some((a) => titleOf(a) === 'Ticket'), 'second tab title link');
});

test('a second click on the same row collapses it', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  const { api } = makeFocusChrome({ 7: [] });
  await renderBoard(container, { send, chromeApi: api });
  const row = rowFor(container, 'Work');
  clickRow(row);
  await flush();
  assert.ok(expandedOf(row), 'the row is expanded after the first click');
  clickRow(row);
  assert.ok(!expandedOf(row), 'the row collapsed after the second click');
});

test('several rows can be open at once; opening another leaves the first open', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  const { api } = makeFocusChrome({ 7: [] });
  await renderBoard(container, { send, chromeApi: api });
  const work = rowFor(container, 'Work');
  const travel = rowFor(container, 'Travel');
  clickRow(work);
  await flush();
  assert.ok(expandedOf(work), 'the open row is expanded');
  clickRow(travel);
  await flush();
  assert.ok(expandedOf(travel), 'the parked row is expanded');
  assert.ok(expandedOf(work), 'opening the parked row left the open one expanded (two open at once)');
  // Clicking an open row closes just that one, leaving the other open.
  clickRow(work);
  assert.ok(!expandedOf(work), 'clicking the open row closed just it');
  assert.ok(expandedOf(travel), 'the other row stayed open');
});

test('clicking the ⋯ button does not expand the row', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  const { api } = makeFocusChrome({ 7: [] });
  await renderBoard(container, { send, chromeApi: api });
  const row = rowFor(container, 'Work');
  const menuBtn = (row.children || []).find((c) => c.className === 'boardMenuBtn');
  // A click that originated on the ⋯ button bubbling to the row must not toggle.
  clickRow(row, menuBtn);
  await flush();
  assert.ok(!expandedOf(row), 'the ⋯ button did not expand the row');
});

test('Enter and Space on a focused row toggle the expansion', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  const { api } = makeFocusChrome({ 7: [] });
  await renderBoard(container, { send, chromeApi: api });
  const row = rowFor(container, 'Work');
  assert.equal(row.tabIndex, 0, 'the row is keyboard-focusable');
  row.listeners.keydown({ key: 'Enter', preventDefault() {} });
  await flush();
  assert.ok(expandedOf(row), 'Enter expanded the row');
  row.listeners.keydown({ key: ' ', preventDefault() {} });
  assert.ok(!expandedOf(row), 'Space collapsed the row');
});

test('clicking a title in an open group focuses that tab', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  const { api, calls } = makeFocusChrome({ 7: [{ id: 42, title: 'Spec doc', url: 'https://a', windowId: 3 }] });
  await renderBoard(container, { send, chromeApi: api });
  const row = rowFor(container, 'Work');
  clickRow(row);
  await flush();
  const link = walk(row).find((n) => n.tagName === 'A' && walk(n).some((c) => c.className === 'boardTabTitle' && c.textContent === 'Spec doc'));
  assert.ok(link, 'the tab title link is present');
  link.click();
  assert.deepEqual(calls.tabUpdate, [{ id: 42, info: { active: true } }], 'the tab was activated');
  assert.deepEqual(calls.windowUpdate, [{ id: 3, info: { focused: true } }], 'its window was focused');
});

test('a parked row expands with its index tab titles as plain text (no links)', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend({
    open: [],
    parked: [{ name: 'Travel', color: 'green', tabCount: 2, lastSeen: '2026-01-02T10:00:00.000Z', tabs: [{ title: 'Hotel', url: 'https://h' }, { title: 'Flights', url: 'https://f' }] }],
    descriptions: [],
  });
  await renderBoard(container, { send });
  const row = rowFor(container, 'Travel');
  clickRow(row);
  const area = expandedOf(row);
  assert.ok(area, 'the parked row expanded');
  // No saved description, no suggestion: reads "No description yet".
  assert.ok(walk(area).some((n) => n.textContent === 'No description yet'), 'the no-description placeholder shows');
  // The index titles show as plain list items (no links), each with the bold
  // site name and the page title.
  const list = walk(area).find((n) => n.className === 'boardTabList');
  assert.ok(list, 'the tab list is present');
  const titleOf = (li) => (walk(li).find((c) => c.className === 'boardTabTitle') || {}).textContent;
  assert.ok((list.children || []).some((li) => titleOf(li) === 'Hotel'), 'first parked title shown');
  assert.ok((list.children || []).some((li) => titleOf(li) === 'Flights'), 'second parked title shown');
  assert.ok(!walk(area).some((n) => n.tagName === 'A'), 'parked titles are plain text, not links');
});

test('Edit in the expanded area swaps the description for the inline editor', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  const { api } = makeFocusChrome({ 7: [] });
  await renderBoard(container, { send, chromeApi: api });
  const row = rowFor(container, 'Work');
  clickRow(row);
  await flush();
  const area = expandedOf(row);
  await findByText(area, 'Edit').click();
  // The editor replaces the description text in place, prefilled from the save.
  assert.ok(walk(area).some((n) => n.tagName === 'TEXTAREA' && n.value === 'day job stuff'), 'the editor opened prefilled');
});

// --- count at top right, card tab lines (bold host + title), "+ n more" -----

// The direct children of a row, in order, by their class/tag — enough to assert
// relative position without the fake DOM's layout.
function rowChildClasses(row) {
  return (row.children || []).map((c) => c.className || c.tagName);
}

test('the count comes after the name and sits in a right-aligned container before the ⋯', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const row = rowFor(container, 'Work');
  const classes = rowChildClasses(row);
  const nameAt = classes.indexOf('boardName');
  const wrapAt = classes.indexOf('boardCountWrap');
  const menuAt = classes.indexOf('boardMenuBtn');
  assert.ok(nameAt >= 0 && wrapAt >= 0 && menuAt >= 0, 'row has name, count container and ⋯');
  assert.ok(nameAt < wrapAt, 'the count container comes after the name');
  assert.ok(wrapAt < menuAt, 'the count container sits before the ⋯ button');
  // The count element lives inside the right-aligned container.
  const wrap = row.children[wrapAt];
  assert.ok((wrap.children || []).some((c) => c.className === 'boardCount' && c.textContent === '3 tabs'), 'the count is inside the container');
});

test('a crowded group puts the 30+ badge beside the count in the same right-aligned container', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend({
    open: [{ groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 40, webTabCount: 40 }],
    parked: [],
    descriptions: [],
  });
  await renderBoard(container, { send });
  const row = rowFor(container, 'Work');
  const wrap = (row.children || []).find((c) => c.className === 'boardCountWrap');
  assert.ok(wrap, 'the count container is present');
  const classes = (wrap.children || []).map((c) => c.className);
  assert.deepEqual(classes, ['boardCount', 'boardSplitHint'], 'the count and the 30+ badge sit together, count first');
  assert.ok((wrap.children || []).some((c) => c.className === 'boardSplitHint' && c.textContent === '30+'), 'the 30+ badge is beside the count');
});

test('an opened open card shows the description before the tab lines', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  const { api } = makeFocusChrome({ 7: [{ id: 11, title: 'Spec doc', url: 'https://example.com', windowId: 1 }] });
  await renderBoard(container, { send, chromeApi: api });
  const row = rowFor(container, 'Work');
  clickRow(row);
  await flush();
  const area = expandedOf(row);
  // The description row is the area's first child; the tab list follows it.
  const areaClasses = (area.children || []).map((c) => c.className);
  assert.ok(areaClasses.indexOf('boardExpandedDesc') < areaClasses.indexOf('boardTabList'), 'the description comes before the tab list');
  assert.ok(walk(area).some((n) => n.textContent === 'day job stuff'), 'the saved description shows first');
});

test('each tab line shows the hostname (without www) in bold, then the title in normal weight', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  const { api } = makeFocusChrome({ 7: [{ id: 11, title: 'The spec', url: 'https://www.example.com/doc', windowId: 1 }] });
  await renderBoard(container, { send, chromeApi: api });
  const row = rowFor(container, 'Work');
  clickRow(row);
  await flush();
  const area = expandedOf(row);
  const list = walk(area).find((n) => n.className === 'boardTabList');
  const li = (list.children || [])[0];
  // The site name is a bold <strong> with the hostname minus 'www.'; the title
  // follows in a normal-weight span.
  const site = walk(li).find((n) => n.tagName === 'STRONG' && n.className === 'boardTabSite');
  const title = walk(li).find((n) => n.className === 'boardTabTitle');
  assert.ok(site, 'the line has a bold site element');
  assert.equal(site.textContent, 'example.com', 'the hostname has no www. prefix');
  assert.ok(title, 'the line has a title element');
  assert.equal(title.textContent, 'The spec', 'the title follows in normal weight');
});

test('a card lists at most five tab lines and a "+ n more" line for the rest', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  // Seven tabs: only five lines show, then "+ 2 more".
  const tabs = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, title: `Tab ${i + 1}`, url: `https://site${i + 1}.com`, windowId: 1 }));
  const { api } = makeFocusChrome({ 7: tabs });
  await renderBoard(container, { send, chromeApi: api });
  const row = rowFor(container, 'Work');
  clickRow(row);
  await flush();
  const area = expandedOf(row);
  const list = walk(area).find((n) => n.className === 'boardTabList');
  const items = list.children || [];
  // Five tab lines plus one "+ n more" line.
  const tabLines = items.filter((li) => walk(li).some((n) => n.className === 'boardTabSite'));
  assert.equal(tabLines.length, 5, 'at most five tab lines show');
  const more = items.find((li) => li.className === 'boardTabMore');
  assert.ok(more, 'a "+ n more" line follows');
  assert.equal(more.textContent, '+ 2 more', 'the more line counts the remaining tabs');
});

test('a card with five or fewer tabs shows no "+ n more" line', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  const tabs = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: `Tab ${i + 1}`, url: `https://site${i + 1}.com`, windowId: 1 }));
  const { api } = makeFocusChrome({ 7: tabs });
  await renderBoard(container, { send, chromeApi: api });
  const row = rowFor(container, 'Work');
  clickRow(row);
  await flush();
  const area = expandedOf(row);
  assert.ok(!walk(area).some((n) => n.className === 'boardTabMore'), 'no more line when five or fewer tabs');
});

// --- TASK 1: the "+n new" badge on parked cards that received filed tabs ------

const PARKED_FIXTURE = {
  open: [],
  parked: [{ name: 'Hearing research', color: 'green', tabCount: 5, lastSeen: '2026-01-02T10:00:00.000Z', tabs: [{ title: 'A', url: 'https://a' }] }],
  descriptions: [],
};

test('a parked card shows a "+n new" badge from the stored new-counts', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(PARKED_FIXTURE);
  // The apply flow recorded 3 tabs filed into "Hearing research" (keyed lowercased).
  const storage = makeStorage({ boardParkedNewCounts: { 'hearing research': 3 } });
  await renderBoard(container, { send, storage });
  const badge = walk(container).find((n) => n.className === 'boardNewBadge');
  assert.ok(badge, 'the parked card shows a new badge');
  assert.equal(badge.textContent, '+3 new');
});

test('a parked card with no recorded new tabs shows no badge', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(PARKED_FIXTURE);
  const storage = makeStorage(); // no counts
  await renderBoard(container, { send, storage });
  assert.ok(!walk(container).some((n) => n.className === 'boardNewBadge'), 'no badge without a count');
});

test('expanding a parked card clears its "+n new" badge and the stored count', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(PARKED_FIXTURE);
  const storage = makeStorage({ boardParkedNewCounts: { 'hearing research': 3 } });
  await renderBoard(container, { send, storage });
  const row = rowFor(container, 'Hearing research');
  assert.ok(walk(row).some((n) => n.className === 'boardNewBadge'), 'badge present before expand');
  clickRow(row);
  await flush();
  // Expanding removes the badge element and clears the stored count for this group.
  assert.ok(!walk(row).some((n) => n.className === 'boardNewBadge'), 'badge gone after expand');
  assert.deepEqual(storage.peek().boardParkedNewCounts, {}, 'stored count cleared');
});

// --- TASK 3: parked rows look parked -----------------------------------------

test('a parked row carries the boardRow--parked class and a parked mark; an open row does not', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  // The parked 'Travel' row has the parked class and a parked mark before the name.
  const parkedRow = rowFor(container, 'Travel');
  assert.ok(/\bboardRow--parked\b/.test(parkedRow.className), 'the parked row carries the parked class');
  assert.ok((parkedRow.children || []).some((c) => c.className === 'boardParkedMark'), 'the parked row has a parked mark');
  // The mark comes before the name.
  const classes = (parkedRow.children || []).map((c) => c.className);
  assert.ok(classes.indexOf('boardParkedMark') < classes.indexOf('boardName'), 'the mark sits before the name');
  // The open 'Work' row has neither the class nor the mark.
  const openRow = rowFor(container, 'Work');
  assert.ok(!/\bboardRow--parked\b/.test(openRow.className), 'the open row is not marked parked');
  assert.ok(!(openRow.children || []).some((c) => c.className === 'boardParkedMark'), 'the open row has no parked mark');
});

test('an expanded parked card shows the muted "Parked <Mon D>" line from lastSeen', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(FIXTURE);
  await renderBoard(container, { send });
  const row = rowFor(container, 'Travel');
  clickRow(row);
  await flush();
  const area = expandedOf(row);
  assert.ok(area, 'the parked row expanded');
  const parkedLine = walk(area).find((n) => n.className === 'boardExpandedParked');
  assert.ok(parkedLine, 'the expanded card has the parked date line');
  // The date is the local 'Mon D' from lastSeen (FIXTURE's Travel), computed the
  // same way the view does so the assertion isn't timezone-brittle.
  const when = new Date('2026-01-02T10:00:00.000Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  assert.equal(parkedLine.textContent, `Parked ${when}`, 'the line reads "Parked <Mon D>"');
});

test('an expanded parked card prefers parkedAt over lastSeen for the parked date', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend({
    open: [],
    parked: [{ name: 'Travel', color: 'green', tabCount: 2, parkedAt: '2026-03-20T08:00:00.000Z', lastSeen: '2026-01-02T10:00:00.000Z', tabs: [] }],
    descriptions: [],
  });
  await renderBoard(container, { send });
  const row = rowFor(container, 'Travel');
  clickRow(row);
  await flush();
  const area = expandedOf(row);
  const parkedLine = walk(area).find((n) => n.className === 'boardExpandedParked');
  const when = new Date('2026-03-20T08:00:00.000Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  assert.equal(parkedLine.textContent, `Parked ${when}`, 'parkedAt wins over lastSeen');
});

// --- TASK 4: order parked groups (drag + the Order menu) ---------------------

// The parked-group names in the order they render, read from the parked section.
function parkedNames(container) {
  const section = walk(container).find((n) => n.tagName === 'DETAILS' && n.className === 'boardSection'
    && (n.children || []).some((c) => c.tagName === 'SUMMARY' && String(c.textContent || '').indexOf('Parked') === 0));
  if (!section) return [];
  return (section.children || [])
    .filter((c) => c && typeof c.className === 'string' && c.className.indexOf('boardRow--parked') !== -1)
    .map((r) => (r.dataset && r.dataset.parkedName) || '');
}

const ORDER_FIXTURE = {
  open: [],
  parked: [
    { name: 'Alpha', color: 'blue', tabCount: 1, lastSeen: '2026-01-01T00:00:00.000Z', parkedAt: '2026-03-01T00:00:00.000Z', lastUsed: '2026-02-10T00:00:00.000Z', tabs: [] },
    { name: 'Bravo', color: 'green', tabCount: 1, lastSeen: '2026-01-02T00:00:00.000Z', parkedAt: '2026-03-05T00:00:00.000Z', lastUsed: '2026-02-20T00:00:00.000Z', tabs: [] },
    { name: 'charlie', color: 'red', tabCount: 1, lastSeen: '2026-01-03T00:00:00.000Z', parkedAt: '2026-03-03T00:00:00.000Z', lastUsed: '2026-02-01T00:00:00.000Z', tabs: [] },
  ],
};

test('the board renders parked groups in the saved parkedOrder, with unknown names after', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(ORDER_FIXTURE);
  // Only two of the three names are listed; the unlisted 'Bravo' follows after,
  // in its current order. A stale name ('Gone') with no group is skipped.
  const storage = makeStorage({ boardParkedOrder: ['charlie', 'Gone', 'Alpha'] });
  await renderBoard(container, { send, storage });
  assert.deepEqual(parkedNames(container), ['charlie', 'Alpha', 'Bravo']);
});

test('with no saved order, the board keeps the incoming parked order', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(ORDER_FIXTURE);
  const storage = makeStorage();
  await renderBoard(container, { send, storage });
  assert.deepEqual(parkedNames(container), ['Alpha', 'Bravo', 'charlie']);
});

// Open the Order ▾ menu in the Parked header and click the item with the given
// label, returning after the choice (and its re-render) has run.
async function chooseOrder(container, label) {
  const btn = walk(container).find((n) => n.className === 'boardOrderBtn');
  assert.ok(btn, 'the Order button is present');
  btn.click();
  const menu = (btn.children || []).find((c) => c.className === 'boardMenu');
  assert.ok(menu, 'the Order menu opened under the button');
  const item = walk(menu).find((n) => n.tagName === 'BUTTON' && n.textContent === label);
  assert.ok(item, `the "${label}" menu item is present`);
  await item.click();
  await flush();
}

test('Order ▸ Last used writes the names newest-first by lastUsed', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(ORDER_FIXTURE);
  const storage = makeStorage();
  await renderBoard(container, { send, storage });
  await chooseOrder(container, 'Last used');
  // Bravo 02-20, Alpha 02-10, charlie 02-01 → newest first.
  assert.deepEqual(storage.peek().boardParkedOrder, ['Bravo', 'Alpha', 'charlie']);
  assert.deepEqual(parkedNames(container), ['Bravo', 'Alpha', 'charlie'], 're-rendered in the chosen order');
});

test('Order ▸ Time parked writes the names newest-first by parkedAt', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(ORDER_FIXTURE);
  const storage = makeStorage();
  await renderBoard(container, { send, storage });
  await chooseOrder(container, 'Time parked');
  // Bravo 03-05, charlie 03-03, Alpha 03-01 → newest first.
  assert.deepEqual(storage.peek().boardParkedOrder, ['Bravo', 'charlie', 'Alpha']);
});

test('Order ▸ A to Z writes the names case-insensitively alphabetical', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(ORDER_FIXTURE);
  const storage = makeStorage();
  await renderBoard(container, { send, storage });
  await chooseOrder(container, 'A to Z');
  // Alpha, Bravo, charlie (case-insensitive).
  assert.deepEqual(storage.peek().boardParkedOrder, ['Alpha', 'Bravo', 'charlie']);
});

test('dragging a parked row and dropping it saves the moved order', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(ORDER_FIXTURE);
  const storage = makeStorage();
  await renderBoard(container, { send, storage });
  // Drag 'charlie' and drop it on 'Alpha' (the fake rows have no geometry, so
  // the drop lands before the target): charlie moves to the front.
  const charlie = rowFor(container, 'charlie');
  const alpha = rowFor(container, 'Alpha');
  charlie.listeners.dragstart({ dataTransfer: { setData() {} } });
  alpha.listeners.drop({ preventDefault() {}, dataTransfer: {} });
  await flush();
  assert.deepEqual(storage.peek().boardParkedOrder, ['charlie', 'Alpha', 'Bravo'], 'the dropped order is saved');
  assert.deepEqual(parkedNames(container), ['charlie', 'Alpha', 'Bravo'], 're-rendered in the new order');
});

test('dropping a parked row on itself leaves the order unchanged', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send } = makeSend(ORDER_FIXTURE);
  const storage = makeStorage();
  await renderBoard(container, { send, storage });
  const alpha = rowFor(container, 'Alpha');
  alpha.listeners.dragstart({ dataTransfer: { setData() {} } });
  alpha.listeners.drop({ preventDefault() {}, dataTransfer: {} });
  await flush();
  // No reorder was saved (a drop on self is a no-op).
  assert.equal(storage.peek().boardParkedOrder, undefined, 'nothing saved for a self-drop');
});
