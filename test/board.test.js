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
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) {
      // Setting textContent to '' is how the view clears a container before a
      // (re)render, matching the real DOM.
      this._text = String(v);
      if (v === '') this.children = [];
    },
    append(...kids) { this.children.push(...kids); },
    appendChild(kid) { this.children.push(kid); return kid; },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { if (this.listeners.click) return this.listeners.click(); },
  };
  return el;
}

function installFakeDocument() {
  globalThis.document = { createElement: (tag) => makeEl(tag) };
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
  assert.ok(texts.includes('Open now'), 'Open now section header');
  assert.ok(texts.includes('Parked, from the index'), 'Parked section header');
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
  assert.ok(texts.some((t) => t === '5 tabs · last seen 2026-01-02'), 'parked meta line with date');
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
  await findByText(container, 'Open').click();
  const req = sent.find((m) => m.cmd === 'openParked');
  assert.ok(req, 'an openParked command was sent');
  assert.equal(req.name, 'Travel');
});

test('Save in a card description fold sends groupsWrite with the edited text and confirms', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const { send, sent } = makeSend(FIXTURE);
  const statuses = [];
  await renderBoard(container, { send, setStatus: (t) => statuses.push(t) });
  // The open card's textarea is prefilled from the matching description.
  const textarea = walk(container).find((n) => n.tagName === 'TEXTAREA' && n.value === 'day job stuff');
  assert.ok(textarea, 'description textarea prefilled from descriptions');
  textarea.value = 'updated note';
  // The first Save button belongs to the open (Work) card.
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

test('a suggestion fills the textarea and shows the Suggested label on re-render', async () => {
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
  // The re-render prefilled the open card's textarea with the suggestion and
  // showed the "Suggested" label.
  const textarea = walk(container).find((n) => n.tagName === 'TEXTAREA' && n.value === 'day job stuff');
  assert.ok(textarea, 'board re-rendered with the suggestion prefilled');
  assert.ok(findByText(container, 'Suggested'), 'the Suggested label is shown');
});

test('a stored suggestion renders without a describe call', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage({ boardDescribeSuggestions: { work: { description: 'day job stuff', date: '2026-01-05' } } });
  const { send, sent } = makeDescribeSend(() => NO_DESC, { descriptions: [], written: 0 });
  await renderBoard(container, { send, storage, today: '2026-01-06' });
  await flush();
  assert.ok(!sent.some((m) => m.cmd === 'describe'), 'no describe sent when a suggestion is already stored');
  const textarea = walk(container).find((n) => n.tagName === 'TEXTAREA' && n.value === 'day job stuff');
  assert.ok(textarea, 'the stored suggestion is prefilled');
  assert.ok(findByText(container, 'Suggested'), 'the Suggested label is shown for the stored suggestion');
});

test('Save on a suggested card sends groupsWrite and clears the Suggested label', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage({ boardDescribeSuggestions: { work: { description: 'day job stuff', date: '2026-01-05' } } });
  const { send, sent } = makeDescribeSend(() => NO_DESC, { descriptions: [], written: 0 });
  await renderBoard(container, { send, storage, today: '2026-01-06' });
  await flush();
  assert.ok(findByText(container, 'Suggested'), 'the Suggested label is shown before saving');
  await findByText(container, 'Save').click();
  const req = sent.find((m) => m.cmd === 'groupsWrite');
  assert.ok(req, 'a groupsWrite command was sent');
  assert.equal(req.name, 'Work');
  assert.equal(req.description, 'day job stuff');
  assert.ok(!findByText(container, 'Suggested'), 'the Suggested label is cleared after saving');
});

test('a saved description is never replaced by a suggestion', async () => {
  installFakeDocument();
  const container = makeEl('div');
  const storage = makeStorage();
  // The open 'Work' group has a saved description; a stale suggestion also
  // exists for it. The saved description must win and no Suggested label shows.
  const fixture = {
    open: [{ groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 3 }],
    parked: [],
    descriptions: [{ name: 'Work', description: 'day job stuff' }],
  };
  storage.peek().boardDescribeSuggestions = { work: { description: 'a stale suggestion', date: '2026-01-05' } };
  const { send } = makeDescribeSend(() => fixture, { descriptions: [], written: 0 });
  await renderBoard(container, { send, storage, today: '2026-01-06' });
  await flush();
  const saved = walk(container).find((n) => n.tagName === 'TEXTAREA' && n.value === 'day job stuff');
  assert.ok(saved, 'the saved description is shown');
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
  assert.ok(findByText(container, 'Close group'), 'a Close group button is offered');
  assert.ok(!findByText(container, 'Park'), 'Park is not offered for a group with no web pages');
  await findByText(container, 'Close group').click();
  const req = sent.find((m) => m.cmd === 'closeGroup');
  assert.ok(req, 'a closeGroup command was sent');
  assert.equal(req.groupId, 7);
});

test('an open card whose name matches a parked record shows "Also parked" and an Add-them-back button', async () => {
  installFakeDocument();
  const container = makeEl('div');
  // 'Work' is open and also has a parked record under the same name (differing
  // only by case/space): the open card offers to add those parked tabs back.
  const { send, sent } = makeSend({
    open: [{ groupId: 7, name: 'Work', color: 'blue', windowId: 1, tabCount: 3, webTabCount: 3 }],
    parked: [{ name: '  work  ', color: 'blue', tabCount: 4, lastSeen: '2026-01-02T10:00:00.000Z' }],
    descriptions: [],
  });
  await renderBoard(container, { send });
  const texts = allText(container);
  assert.ok(texts.includes('Also parked: 4 tabs'), 'the also-parked line names the parked tab count');
  // The same-named parked record is not shown as its own parked card.
  assert.ok(texts.includes('Nothing parked yet'), 'the parked section stays empty for the same-named record');
  const addBtn = findByText(container, 'Add them back');
  assert.ok(addBtn, 'an Add them back button is offered');
  await addBtn.click();
  const req = sent.find((m) => m.cmd === 'openParked');
  assert.ok(req, 'an openParked command was sent');
  assert.equal(req.name, 'Work', 'it opens the parked record by the open group name');
  assert.equal(req.groupId, 7, 'it folds the tabs into the existing open group');
});
