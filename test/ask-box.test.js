// The side panel reads top to bottom as Open tabs (sort card and result), then
// More tools, then a heavy divider and All groups. More tools opens to a pair,
// the open-tabs list (with Close duplicates) and "Tell me what you want to do",
// with the other tools under them. The ⋯ More view is gone (0.10.0). A typed
// request comes back as a card: what you asked, the AI's one-line reading of
// it, the steps, and Go / Review / Cancel; the card opens More tools.
// Covers:
//   1. the order of the parts in the static HTML, and that the ⋯ view is gone;
//   2. the open-tabs list is closed by default and carries Close duplicates;
//   3. More tools is closed, holds the pair first, then the other tools;
//   4. commandStepLines turns a plan into short step lines;
//   5. a plan from a typed request shows the command card instead of the
//      Open tabs result card, and the other way round.
// Like the other side-panel suites, this drives the modules with a hand-rolled
// fake DOM (no jsdom in this repo) rather than a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installChromeMock } from './helpers/chrome-mock.js';
import { commandStepLines } from '../extension/sidepanel/viewmodel.js';
import { updateResultCard } from '../extension/sidepanel/main-panel.js';

const html = readFileSync(new URL('../extension/sidepanel/sidepanel.html', import.meta.url), 'utf8');
const messages = JSON.parse(readFileSync(new URL('../extension/_locales/en/messages.json', import.meta.url), 'utf8'));

function at(needle) {
  const i = html.indexOf(needle);
  assert.ok(i !== -1, `${needle} exists`);
  return i;
}

// The markup between an element's open tag and the </details> that closes it,
// counting nested <details> so an inner fold doesn't end the slice early.
function detailsSlice(id) {
  const start = at(`id="${id}"`);
  let depth = 1;
  const re = /<details\b|<\/details>/g;
  re.lastIndex = html.indexOf('>', start) + 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0] === '</details>' ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  assert.fail(`${id} never closes`);
}

// ---- 1. Order of the parts ---------------------------------------------------

test('the panel reads Open tabs, More tools (the pair, then the rest), a divider, then All groups', () => {
  const order = [
    'id="sortCard"', 'id="resultCard"', 'id="undoToast"', 'id="moreTools"', 'id="tabsPanel"',
    'id="commandForm"', 'id="commandCard"', 'id="updateIndex"', 'id="showUndo"',
    'class="partDivider"', 'id="parkedGroupsHeading"', 'id="board"',
  ];
  for (let i = 1; i < order.length; i++) {
    assert.ok(at(order[i - 1]) < at(order[i]), `${order[i - 1]} comes before ${order[i]}`);
  }
});

test('the ⋯ More view is gone: no button, no view, no Done', () => {
  for (const id of ['id="openMore"', 'id="moreView"', 'id="moreDone"', 'id="commandPanel"']) {
    assert.ok(!html.includes(id), `${id} is gone`);
  }
});

test('each moved id appears exactly once', () => {
  for (const id of ['tabsPanel', 'closeDuplicates', 'commandForm', 'commandInput', 'moreTools', 'updateIndex',
    'loadProposals', 'mutedPanel', 'sessions', 'runOne', 'showUndo', 'appVersion', 'commandGo']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} appears once`);
  }
});

// ---- 2. The open-tabs list ---------------------------------------------------

test('the open-tabs list is closed by default and has Close duplicates on its title line', () => {
  const tag = html.match(/<details[^>]*id="tabsPanel"[^>]*>/);
  assert.ok(tag && !/\bopen\b/.test(tag[0]), 'closed until clicked');
  const summary = html.slice(at('id="tabsPanel"'), html.indexOf('</summary>', at('id="tabsPanel"')));
  assert.ok(summary.includes('id="closeDuplicates"'), 'Close duplicates sits in the list title');
  const sortCard = html.slice(at('id="sortCard"'), html.indexOf('</section>', at('id="sortCard"')));
  assert.ok(!sortCard.includes('id="closeDuplicates"'), 'and no longer in the sort card');
  const inside = detailsSlice('tabsPanel');
  for (const id of ['tabFilter', 'selectAllTabs', 'selectNoneTabs', 'closeTabsBtn', 'tabList']) {
    assert.ok(inside.includes(`id="${id}"`), `${id} is in the open-tabs list`);
  }
});

// ---- 3. The ask box and More tools ------------------------------------------

test('the ask box sits in More tools, paired with the open-tabs list, and reads "Tell me what you want to do"', () => {
  const pair = html.slice(at('class="toolPair"'), at('class="toolRest"'));
  assert.ok(pair.includes('id="tabsPanel"') && pair.includes('id="commandForm"'), 'the open-tabs list and the ask box are a pair');
  assert.ok(detailsSlice('moreTools').includes('class="toolPair"'), 'and the pair is inside More tools');
  assert.equal(messages.commandLabel.message, 'Tell me what you want to do');
  const card = html.slice(at('id="commandCard"'), html.indexOf('</section>', at('id="commandCard"')));
  assert.ok(/<section[^>]*id="commandCard"[^>]*hidden/.test(html), 'the card waits hidden until there is a plan');
  for (const id of ['commandAsked', 'commandUnderstood', 'commandSteps', 'commandGo', 'commandReview', 'commandCancel']) {
    assert.ok(card.includes(`id="${id}"`), `${id} is on the card`);
  }
  assert.match(card, /id="commandGo"[^>]*>Go</, 'the button says Go');
});

test('the heading over the board reads All groups, under a heavy divider', () => {
  assert.match(html, /<hr class="partDivider"[^>]*>\s*<h2 class="partHeading" id="parkedGroupsHeading">All groups<\/h2>/);
});

test('"Muted & learned" is now the Never-suggest list and says what it does', () => {
  assert.equal(messages.mutedTitle.message, 'Never-suggest list');
  const inside = detailsSlice('mutedPanel');
  assert.match(inside, /Never suggest this/, 'it explains where the list comes from');
  assert.match(inside, /Reset learning/, 'and what Reset learning clears');
});

test('More tools is closed and holds the other tools and the version under the pair', () => {
  const tag = html.match(/<details[^>]*id="moreTools"[^>]*>/);
  assert.ok(tag && !/\bopen\b/.test(tag[0]), 'closed by default');
  const inside = html.slice(at('class="toolRest"'), at('class="partDivider"'));
  for (const id of ['updateIndex', 'loadProposals', 'mutedPanel', 'showUndo', 'appVersion', 'runOne', 'sessions']) {
    assert.ok(inside.includes(`id="${id}"`), `${id} lives in More tools`);
  }
});

// ---- 4. Step lines -----------------------------------------------------------

test('commandStepLines lists each group and totals the closes and bookmarks', () => {
  const plan = [
    { action: 'groupTabs', data: { groupName: 'Logged in', tabIds: [1, 2, 3] } },
    { action: 'groupTabs', data: { groupName: 'Reading', tabIds: [4] } },
    { action: 'groupTabs', data: { groupName: 'Self-hosting', parkedMatch: true, tabIds: [5, 6] } },
    { action: 'closeTab', data: { tabId: 7 } },
    { action: 'closeTab', data: { tabId: 8 } },
    { action: 'createBookmark', data: { tabId: 9 } },
  ];
  assert.deepEqual(commandStepLines(plan), [
    'Group 3 tabs into “Logged in”',
    'Group 1 tab into “Reading”',
    'Put 2 tabs away in the parked group “Self-hosting”',
    'Close 2 tabs',
    'Bookmark 1 tab',
  ]);
  assert.deepEqual(commandStepLines([]), []);
});

test('commandStepLines keeps a long list short', () => {
  const plan = Array.from({ length: 9 }, (_, i) => ({ action: 'groupTabs', data: { groupName: `G${i}`, tabIds: [i] } }));
  const lines = commandStepLines(plan);
  assert.equal(lines.length, 7, 'six groups plus a "more" line');
  assert.equal(lines[6], 'and 3 more groups');
});

// ---- 5. Which card shows ------------------------------------------------------

function el(extra = {}) {
  const node = {
    attrs: {},
    classes: new Set(),
    hidden: false,
    text: '',
    // Setting text clears the children, as it does in a real DOM.
    get textContent() { return node.text; },
    set textContent(v) { node.text = String(v); node.children = []; },
    children: [],
    parentNode: null,
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    classList: {
      add: (c) => node.classes.add(c),
      remove: (c) => node.classes.delete(c),
      toggle: (c, force) => { if (force) node.classes.add(c); else node.classes.delete(c); },
    },
    appendChild(child) { child.parentNode = node; node.children.push(child); return child; },
    removeChild(child) { node.children = node.children.filter((c) => c !== child); child.parentNode = null; return child; },
    insertAdjacentElement(_pos, child) { child.parentNode = node.parentNode; if (node.parentNode) node.parentNode.children.push(child); return child; },
    set className(v) { node.classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get className() { return [...node.classes].join(' '); },
    ...extra,
  };
  return node;
}

function harness() {
  const els = {
    moreTools: el({ open: false }),
    resultCard: el({ hidden: true }),
    resultSummary: el(),
    resultCount: el(),
    commandCard: el({ hidden: true }),
    commandAsked: el(),
    commandUnderstood: el(),
    commandSteps: el(),
  };
  els.resultCard.appendChild(els.resultSummary);
  globalThis.document = { getElementById: (id) => els[id] || null, createElement: () => el() };
  installChromeMock({ runtime: { id: 'ext', getManifest: () => ({}) } });
  return els;
}

const groupPlan = [{ action: 'groupTabs', data: { groupName: 'Logged in', tabIds: [1, 2] } }];

test('a plan from a typed request shows the command card, not the Open tabs result card', () => {
  const els = harness();
  updateResultCard(groupPlan, {
    label: 'Command', at: Date.now(),
    instruction: 'find every page where I am logged in', summary: 'I will group the sites you sign in to.',
  });
  assert.equal(els.resultCard.hidden, true, 'the sort result card stays hidden');
  assert.equal(els.commandCard.hidden, false, 'the command card shows');
  assert.equal(els.moreTools.open, true, 'More tools opens so the card is in view');
  assert.equal(els.commandAsked.textContent, 'You asked: find every page where I am logged in');
  assert.equal(els.commandUnderstood.textContent, 'I will group the sites you sign in to.');
  assert.deepEqual(els.commandSteps.children.map((li) => li.textContent), ['Group 2 tabs into “Logged in”']);
});

test('without the AI\'s summary the card falls back to a plain line', () => {
  const els = harness();
  updateResultCard(groupPlan, { label: 'Command', at: Date.now(), instruction: 'group logins' });
  assert.equal(els.commandUnderstood.textContent, 'Here is what the AI will do.');
});

test('a plan from a sort shows the result card and hides the command card', () => {
  const els = harness();
  updateResultCard(groupPlan, { label: 'Command', at: 1, instruction: 'x' });
  updateResultCard(groupPlan, { label: 'Put into my groups', at: Date.now() });
  assert.equal(els.resultCard.hidden, false);
  assert.equal(els.commandCard.hidden, true);
  assert.equal(els.commandSteps.children.length, 0, 'old steps are cleared');
});

test('an empty plan hides both cards', () => {
  const els = harness();
  updateResultCard([], { label: 'Command', at: Date.now(), instruction: 'x' });
  assert.equal(els.resultCard.hidden, true);
  assert.equal(els.commandCard.hidden, true);
});
