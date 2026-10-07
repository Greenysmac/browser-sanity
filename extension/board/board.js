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

// Build (or rebuild) the board inside `container`: an "Open now" section and a
// "Parked, from the index" section, each a foldable <details open>. Data comes
// from the service worker's 'boardData' command. setStatus is optional (defaults
// to a no-op) so the module stays importable without the panel's dom.js.
export async function renderBoard(container, { send, setStatus = () => {} } = {}) {
  const rerender = () => renderBoard(container, { send, setStatus });
  const res = await send({ cmd: 'boardData' });
  const open = (res && res.open) || [];
  const parked = (res && res.parked) || [];
  const descriptions = (res && res.descriptions) || [];
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
}
