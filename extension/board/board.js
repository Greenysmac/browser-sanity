// The board: a quick at-a-glance view of the user's tab groups, split into the
// ones open right now (from the live tab strip) and the ones parked in the
// on-disk index. Each card can be acted on (sort/park an open group, open a
// parked one) and carries a fold-out to edit the description the model sees.
// All DOM is built with createElement/textContent — never innerHTML with data —
// so group names and descriptions can't inject markup (the repo lints for it).

// Chrome tab-group color names map to concrete CSS colors for the dot. Anything
// unknown (or missing) falls back to a neutral grey so the dot always renders.
const DOT_COLORS = {
  grey: '#9aa0a6',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#1e8e3e',
  pink: '#d01884',
  purple: '#9334e6',
  cyan: '#007b83',
  orange: '#fa903e',
};

// Render "last seen <date>" from an ISO timestamp, keeping just the date part.
// A missing/blank value reads "last seen unknown" rather than showing an empty.
function lastSeenText(lastSeen) {
  const day = String(lastSeen || '').slice(0, 10);
  return day ? `last seen ${day}` : 'last seen unknown';
}

// Find the saved description for a group name (trimmed, case-insensitive) in the
// descriptions list, or '' when none is recorded.
function descriptionFor(descriptions, name) {
  const wanted = String(name || '').trim().toLowerCase();
  const found = (descriptions || []).find((d) => String(d.name || '').trim().toLowerCase() === wanted);
  return (found && found.description) || '';
}

// The <details> "Description" fold-out shared by open and parked cards: a
// textarea prefilled from the group's saved description and a Save button that
// writes it back through 'groupsWrite'. On save the status line confirms. Takes
// a setStatus callback so the board can show its own status without importing
// dom.js (keeping this module testable with a bare fake document).
function descriptionFold({ name, description, send, setStatus }) {
  const details = document.createElement('details');
  details.className = 'boardDesc';
  const summary = document.createElement('summary');
  summary.textContent = 'Description';
  const textarea = document.createElement('textarea');
  textarea.rows = 2;
  textarea.value = description || '';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save';
  save.addEventListener('click', async () => {
    await send({ cmd: 'groupsWrite', name, description: textarea.value });
    setStatus(`Saved description for "${name}".`);
  });
  details.append(summary, textarea, save);
  return details;
}

// A single open-group card: color dot, name, "<n> tabs", a Sort and a Park
// button, and the description fold-out. After Sort or Park the board re-renders
// so the card list reflects the new state.
function openCard({ group, descriptions, send, setStatus, rerender }) {
  const card = document.createElement('div');
  card.className = 'boardCard';
  const head = document.createElement('div');
  head.className = 'boardCardHead';
  const dot = document.createElement('span');
  dot.className = 'boardDot';
  dot.style.backgroundColor = DOT_COLORS[group.color] || DOT_COLORS.grey;
  const name = document.createElement('span');
  name.className = 'boardName';
  name.textContent = group.name || '(unnamed)';
  const count = document.createElement('span');
  count.className = 'boardCount';
  count.textContent = `${group.tabCount} tabs`;
  const sortBtn = document.createElement('button');
  sortBtn.type = 'button';
  sortBtn.textContent = 'Sort this group';
  sortBtn.addEventListener('click', async () => {
    await send({ cmd: 'sortGroup', groupId: group.groupId });
    await rerender();
  });
  const parkBtn = document.createElement('button');
  parkBtn.type = 'button';
  parkBtn.textContent = 'Park';
  parkBtn.addEventListener('click', async () => {
    await send({ cmd: 'parkGroup', groupId: group.groupId });
    await rerender();
  });
  head.append(dot, name, count, sortBtn, parkBtn);
  card.append(head, descriptionFold({ name: group.name, description: descriptionFor(descriptions, group.name), send, setStatus }));
  return card;
}

// A single parked-group card: color dot, name, "<n> tabs · last seen <date>",
// an Open button, and the description fold-out. After Open the board re-renders.
function parkedCard({ group, descriptions, send, setStatus, rerender }) {
  const card = document.createElement('div');
  card.className = 'boardCard';
  const head = document.createElement('div');
  head.className = 'boardCardHead';
  const dot = document.createElement('span');
  dot.className = 'boardDot';
  dot.style.backgroundColor = DOT_COLORS[group.color] || DOT_COLORS.grey;
  const name = document.createElement('span');
  name.className = 'boardName';
  name.textContent = group.name || '(unnamed)';
  const meta = document.createElement('span');
  meta.className = 'boardCount';
  meta.textContent = `${group.tabCount} tabs · ${lastSeenText(group.lastSeen)}`;
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.textContent = 'Open';
  openBtn.addEventListener('click', async () => {
    await send({ cmd: 'openParked', name: group.name });
    await rerender();
  });
  head.append(dot, name, meta, openBtn);
  card.append(head, descriptionFold({ name: group.name, description: descriptionFor(descriptions, group.name), send, setStatus }));
  return card;
}

// The chrome.storage.local key holding the "last asked" dates, so we describe a
// given group at most once a day and opening new tabs doesn't call the model
// again and again.
const ASKED_KEY = 'boardDescribeAsked';

// Today's date as YYYY-MM-DD (local), the granularity of the once-a-day memory.
function todayStr(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

// chrome.storage.local when available, else undefined (e.g. the unit tests'
// bare fake document) so the view stays importable without a chrome mock.
function defaultStorage() {
  return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || undefined;
}

// Read/write the once-a-day memory: a plain { "<name-lowercased>": "YYYY-MM-DD" }
// map. A missing store (tests) reads {} and writes nothing.
async function readAsked(storage) {
  if (!storage) return {};
  const got = await storage.get(ASKED_KEY);
  return (got && got[ASKED_KEY]) || {};
}

async function writeAsked(storage, asked) {
  if (!storage) return;
  await storage.set({ [ASKED_KEY]: asked });
}

// Pick the open groups that have a name, lack a saved description, and haven't
// been asked about today (per the memory). Returns [{ groupId, name }].
function groupsNeedingDescription(open, descriptions, asked, today) {
  return open
    .filter((g) => {
      const name = String(g.name || '').trim();
      if (!name) return false;
      if (descriptionFor(descriptions, name)) return false;
      return asked[name.toLowerCase()] !== today;
    })
    .map((g) => ({ groupId: g.groupId, name: g.name }));
}

// In the background (never blocking the board), fill in any missing open-group
// descriptions: ask at most once a day per group, send one 'describe' request,
// then re-render and report how many were written. Does nothing when nothing
// needs asking. storage/today are injectable so the view is testable.
async function autoDescribe({ open, descriptions, send, setStatus, rerender, storage, today }) {
  const asked = await readAsked(storage);
  const needing = groupsNeedingDescription(open, descriptions, asked, today);
  if (!needing.length) return;
  // Mark them asked before sending so a re-render (or new tabs) won't ask again.
  for (const g of needing) asked[String(g.name).trim().toLowerCase()] = today;
  await writeAsked(storage, asked);
  const res = await send({ cmd: 'describe', groups: needing });
  const written = (res && res.written) || 0;
  if (written > 0) {
    await rerender();
    setStatus(`Wrote descriptions for ${written} ${written === 1 ? 'group' : 'groups'}`);
  }
}

// Build (or rebuild) the board inside `container`: an "Open now" section and a
// "Parked, from the index" section, each a foldable <details open>. Data comes
// from the service worker's 'boardData' command. setStatus is optional (defaults
// to a no-op) so the module stays importable without the panel's dom.js.
export async function renderBoard(container, { send, setStatus = () => {}, storage = defaultStorage(), today = todayStr() } = {}) {
  const rerender = () => renderBoard(container, { send, setStatus, storage, today });
  const res = await send({ cmd: 'boardData' });
  const open = (res && res.open) || [];
  const parkedRaw = (res && res.parked) || [];
  const descriptions = (res && res.descriptions) || [];
  // Drop any parked card whose name matches an open group (trimmed, case-
  // insensitive): a reopened group is "open now", so it shouldn't also appear
  // under "Parked, from the index".
  const openNames = new Set(open.map((g) => String(g.name || '').trim().toLowerCase()).filter(Boolean));
  const parked = parkedRaw.filter((g) => !openNames.has(String(g.name || '').trim().toLowerCase()));
  container.textContent = '';

  const openSection = document.createElement('details');
  openSection.open = true;
  openSection.className = 'boardSection';
  const openSummary = document.createElement('summary');
  openSummary.textContent = 'Open now';
  openSection.appendChild(openSummary);
  if (!open.length) {
    const empty = document.createElement('p');
    empty.className = 'boardEmpty';
    empty.textContent = 'No open groups';
    openSection.appendChild(empty);
  } else {
    for (const group of open) openSection.appendChild(openCard({ group, descriptions, send, setStatus, rerender }));
  }

  const parkedSection = document.createElement('details');
  parkedSection.open = true;
  parkedSection.className = 'boardSection';
  const parkedSummary = document.createElement('summary');
  parkedSummary.textContent = 'Parked, from the index';
  parkedSection.appendChild(parkedSummary);
  if (!parked.length) {
    const empty = document.createElement('p');
    empty.className = 'boardEmpty';
    empty.textContent = 'Nothing parked yet';
    parkedSection.appendChild(empty);
  } else {
    for (const group of parked) parkedSection.appendChild(parkedCard({ group, descriptions, send, setStatus, rerender }));
  }

  container.append(openSection, parkedSection);

  // After painting, fill in any missing open-group descriptions in the
  // background — this never blocks the board above, and re-renders itself when
  // the model answers.
  autoDescribe({ open, descriptions, send, setStatus, rerender, storage, today });
}
