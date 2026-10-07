// The board: a quick at-a-glance view of the user's tab groups, split into the
// ones open right now (from the live tab strip) and the ones parked in the
// on-disk index. Each group is a single compact row; a '⋯' menu on the row
// holds its actions (sort/park an open group, open a parked one) and a
// "Description…" item opens an inline editor for the description the model sees.
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

// Find a stored model suggestion for a group name in the suggestions map
// ({ "<name-lowercased>": { description, date } }), or '' when none is kept.
function suggestionFor(suggestions, name) {
  const entry = (suggestions || {})[String(name || '').trim().toLowerCase()];
  return (entry && entry.description) || '';
}

// Remove an element from the DOM when it supports .remove() (the real DOM and
// the richer test fakes do); a bare fake element without it is simply left in
// place, which keeps the view importable with a minimal fake document.
function detach(el) {
  if (el && typeof el.remove === 'function') el.remove();
}

// The inline "Description" editor opened from a row's ⋯ menu: a textarea
// prefilled from the group's saved description, a Save button that writes it
// back through 'groupsWrite', and a Cancel button that removes the editor. On
// save the status line confirms. Takes a setStatus callback so the board can
// show its own status without importing dom.js (keeping this module testable
// with a bare fake document).
//
// When `suggested` is a non-empty string, the group has no saved description
// and the model proposed one: the textarea is prefilled with that suggestion
// and a small "Suggested" label shows inside the editor. Nothing is saved until
// the user clicks Save, which sends 'groupsWrite' as usual.
function descriptionEditor({ name, description, suggested, send, setStatus }) {
  const wrap = document.createElement('div');
  wrap.className = 'boardDescEditor';
  if (suggested) {
    const label = document.createElement('span');
    label.className = 'boardSuggested';
    label.textContent = 'Suggested';
    wrap.appendChild(label);
  }
  const textarea = document.createElement('textarea');
  textarea.rows = 2;
  textarea.value = description || suggested || '';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save';
  save.addEventListener('click', async () => {
    await send({ cmd: 'groupsWrite', name, description: textarea.value });
    setStatus(`Saved description for "${name}".`);
    detach(wrap);
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => { detach(wrap); });
  wrap.append(textarea, save, cancel);
  return wrap;
}

// The expanded area shown under a row when it's clicked open: the group's
// description (or, when none is saved, the waiting suggestion with its
// "Suggested" label, else "No description yet"), an Edit button that swaps the
// description text for the inline editor above, and the group's tab titles.
// Each title is a link; for an open group clicking it focuses that tab (via
// `onOpenTab`), while for a parked group the title is plain text. `tabs` is the
// list of { title, url } the row expanded with. Built with createElement so
// names/titles can't inject markup.
function expandedArea({ name, description, suggested, tabs, send, setStatus, onOpenTab }) {
  const wrap = document.createElement('div');
  wrap.className = 'boardExpanded';

  // The description line and its Edit button, grouped so Edit can replace them
  // with the existing editor in place.
  const descRow = document.createElement('div');
  descRow.className = 'boardExpandedDesc';
  const descText = document.createElement('span');
  descText.className = 'boardExpandedDescText';
  if (!description && suggested) {
    const label = document.createElement('span');
    label.className = 'boardSuggested';
    label.textContent = 'Suggested';
    descRow.appendChild(label);
    descText.textContent = suggested;
  } else {
    descText.textContent = description || 'No description yet';
  }
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'boardExpandedEdit';
  edit.textContent = 'Edit';
  edit.addEventListener('click', () => {
    // Swap the description text and Edit button for the inline editor.
    const editor = descriptionEditor({ name, description, suggested, send, setStatus });
    descRow.textContent = '';
    descRow.appendChild(editor);
  });
  descRow.append(descText, edit);
  wrap.appendChild(descRow);

  const list = document.createElement('ul');
  list.className = 'boardTabList';
  for (const t of (tabs || [])) {
    const li = document.createElement('li');
    const title = (t && t.title) || (t && t.url) || '';
    if (onOpenTab && t && t.id != null) {
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = title;
      link.addEventListener('click', (e) => { if (e && e.preventDefault) e.preventDefault(); onOpenTab(t); });
      li.appendChild(link);
    } else {
      li.textContent = title;
    }
    list.appendChild(li);
  }
  wrap.appendChild(list);
  return wrap;
}

// A small pop-up menu, built with createElement as a positioned <ul> of
// buttons. Each item is { label, onChoose }. The menu closes after a choice, on
// Escape, or on a click outside it; whichever happens first detaches the shared
// document listeners. Appended to the given host element so it sits under the
// row's ⋯ button.
function openMenu(host, items) {
  const menu = document.createElement('ul');
  menu.className = 'boardMenu';
  let close = () => {};
  const onKey = (e) => { if (e && e.key === 'Escape') close(); };
  const onDocClick = (e) => {
    const target = e && e.target;
    // A click on the menu itself (or its items) shouldn't close it from here;
    // choosing an item closes the menu explicitly.
    if (target && (target === menu || walkIncludes(menu, target))) return;
    close();
  };
  let closed = false;
  close = () => {
    closed = true;
    detach(menu);
    const doc = (typeof document !== 'undefined') ? document : undefined;
    if (doc && doc.removeEventListener) {
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('click', onDocClick);
    }
  };
  for (const item of items) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = item.label;
    btn.addEventListener('click', async () => {
      close();
      await item.onChoose();
    });
    li.appendChild(btn);
    menu.appendChild(li);
  }
  host.appendChild(menu);
  const doc = (typeof document !== 'undefined') ? document : undefined;
  if (doc && doc.addEventListener) {
    doc.addEventListener('keydown', onKey);
    // Listen for outside clicks only after the click that opened the menu has
    // finished bubbling; otherwise that same click reaches the document and
    // closes the menu at once (found in a real browser, 2026-10-07).
    setTimeout(() => { if (!closed) doc.addEventListener('click', onDocClick); }, 0);
  }
  return close;
}

// The number of web pages in a group: the host-supplied web-tab count when
// present (http(s) tabs only), else the raw tab count. The count on a card
// reflects web pages, not scratch tabs like the new-tab page.
function webTabCount(group) {
  return (group && typeof group.webTabCount === 'number') ? group.webTabCount : (group.tabCount || 0);
}

// A small "30+" badge shown next to the count on a crowded row (more than 30
// web tabs for an open group, or tabs for a parked one), a hint that the group
// is a good candidate to split. Returns the badge element, or undefined when the
// count is at or below the threshold.
const SPLIT_HINT_THRESHOLD = 30;
function splitHintBadge(count) {
  if (!(count > SPLIT_HINT_THRESHOLD)) return undefined;
  const badge = document.createElement('span');
  badge.className = 'boardSplitHint';
  badge.textContent = '30+';
  return badge;
}

// Find the parked record (if any) whose name matches an open group's name
// (trimmed, case-insensitive), so an open card can offer to add its tabs back.
function parkedMatch(parked, name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return undefined;
  return (parked || []).find((g) => String(g.name || '').trim().toLowerCase() === wanted);
}

// A shared single-open-at-a-time expander for the board's rows. Each row calls
// `wire(row, build)` to make itself clickable: a click anywhere on the row
// (except the ⋯ button, its menu, or an open editor/expanded area) toggles an
// expanded area built by `build()` and appended under the row; Enter or Space
// on the focused row does the same. Opening one row collapses whichever row was
// open before, so only one expanded area shows across both sections.
function makeExpander() {
  let openRow;
  const collapse = () => {
    if (!openRow) return;
    const area = Array.from(openRow.children || []).find((c) => c && c.className === 'boardExpanded');
    detach(area);
    openRow = undefined;
  };
  // A click/keypress originating from the ⋯ button, its menu, or an already-open
  // editor/expanded area shouldn't toggle the row.
  const fromControls = (row, target) => {
    if (!target) return false;
    const controls = Array.from(row.children || []).filter((c) => c && (
      c.className === 'boardMenuBtn' || c.className === 'boardMenu'
      || c.className === 'boardExpanded' || c.className === 'boardDescEditor'));
    for (const c of controls) {
      if (target === c) return true;
      if ((c.children || []).length && walkIncludes(c, target)) return true;
    }
    return false;
  };
  const wire = (row, build) => {
    row.tabIndex = 0;
    const toggle = (e) => {
      const target = e && e.target;
      if (fromControls(row, target)) return;
      const isOpen = Array.from(row.children || []).some((c) => c && c.className === 'boardExpanded');
      if (isOpen) { collapse(); return; }
      collapse();
      row.appendChild(build());
      openRow = row;
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => {
      if (e && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
        if (e.preventDefault) e.preventDefault();
        toggle(e);
      }
    });
  };
  return { wire };
}

// True when `target` is `el` or one of its descendants, used to tell whether a
// click landed inside a row's controls (menu, editor, expanded area).
function walkIncludes(el, target) {
  if (!el) return false;
  if (el === target) return true;
  for (const kid of Array.from(el.children || [])) { if (walkIncludes(kid, target)) return true; }
  return false;
}

// A single open-group row: a compact line of color dot, name, web-tab count in
// muted text, a small dot when a suggested description is waiting, and a '⋯'
// button that opens the row's action menu. The description editor (opened from
// the menu) appears inline right under the row. After an action the board
// re-renders so the row list reflects the new state. `suggestions` is the
// stored map of model suggestions by group name; an open group with no saved
// description has its waiting suggestion flagged with the small dot and
// prefilled (with a "Suggested" label) once the editor opens.
//
// The count reflects web pages only. A group with no web pages reads "no web
// pages" and the menu offers "Close group" (close its tabs) instead of Park,
// since there's nothing worth parking. When a parked record carries the same
// name, the menu offers "Add back <n> parked tabs", opening those parked tabs
// straight into this open group.
function openCard({ group, descriptions, suggestions, parked, send, setStatus, rerender, expander, chromeApi, onSplitProposal }) {
  const row = document.createElement('div');
  row.className = 'boardRow';
  const dot = document.createElement('span');
  dot.className = 'boardDot';
  dot.style.backgroundColor = DOT_COLORS[group.color] || DOT_COLORS.grey;
  const name = document.createElement('span');
  name.className = 'boardName';
  name.textContent = group.name || '(unnamed)';
  const webCount = webTabCount(group);
  const count = document.createElement('span');
  count.className = 'boardCount';
  count.textContent = webCount ? `${webCount} tabs` : 'no web pages';
  row.append(dot, name, count);
  // A crowded group (more than 30 web pages) shows a small "30+" badge — a hint
  // that Split (in the ⋯ menu) is worth a look.
  const badge = splitHintBadge(webCount);
  if (badge) row.append(badge);

  const description = descriptionFor(descriptions, group.name);
  // Only surface a stored suggestion when nothing is saved yet; a saved
  // description is never replaced by a suggestion.
  const suggested = description ? '' : suggestionFor(suggestions, group.name);
  if (suggested) {
    const flag = document.createElement('span');
    flag.className = 'boardSuggestDot';
    row.appendChild(flag);
  }

  // Opening the editor replaces any editor already open on this row.
  const openEditor = () => {
    const existing = Array.from(row.children || []).find((c) => c && c.className === 'boardDescEditor');
    if (existing) return;
    row.appendChild(descriptionEditor({ name: group.name, description, suggested, send, setStatus }));
  };

  const items = [
    { label: 'Sort this group', onChoose: async () => { await send({ cmd: 'sortGroup', groupId: group.groupId }); await rerender(); } },
    { label: 'Split this group…', onChoose: async () => {
      const res = await send({ cmd: 'splitGroup', groupId: group.groupId });
      if (onSplitProposal && res && res.ok && res.proposal) onSplitProposal(res.proposal);
    } },
  ];
  if (webCount) {
    items.push({ label: 'Park', onChoose: async () => { await send({ cmd: 'parkGroup', groupId: group.groupId }); await rerender(); } });
  } else {
    // Nothing worth parking: offer to close the group's tabs instead.
    items.push({ label: 'Close group', onChoose: async () => { await send({ cmd: 'closeGroup', groupId: group.groupId }); await rerender(); } });
  }
  // A parked record with the same name holds tabs that aren't open here yet;
  // offer to add them back into this open group.
  const alsoParked = parkedMatch(parked, group.name);
  const parkedCount = alsoParked ? (alsoParked.tabCount || 0) : 0;
  if (parkedCount) {
    items.push({ label: `Add back ${parkedCount} parked tabs`, onChoose: async () => { await send({ cmd: 'openParked', name: group.name, groupId: group.groupId }); await rerender(); } });
  }
  items.push({ label: 'Description…', onChoose: openEditor });

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'boardMenuBtn';
  menuBtn.textContent = '⋯';
  menuBtn.addEventListener('click', () => { openMenu(row, items); });
  row.append(menuBtn);

  // Clicking the row (anywhere but the ⋯ button/menu/editor) expands it: the
  // description with an Edit button, plus the live tabs' titles as links that
  // focus the tab when clicked.
  if (expander) {
    const tabsApi = chromeApi && chromeApi.tabs;
    const windowsApi = chromeApi && chromeApi.windows;
    const onOpenTab = (t) => {
      if (!t || t.id == null) return;
      if (tabsApi && tabsApi.update) tabsApi.update(t.id, { active: true });
      if (windowsApi && windowsApi.update && t.windowId != null) windowsApi.update(t.windowId, { focused: true });
    };
    const build = () => {
      const area = expandedArea({ name: group.name, description, suggested, tabs: [], send, setStatus, onOpenTab });
      // Fill the live tab titles asynchronously; the area shows immediately and
      // the links appear once the query answers.
      if (tabsApi && tabsApi.query && group.groupId != null) {
        Promise.resolve(tabsApi.query({ groupId: group.groupId })).then((tabs) => {
          const list = Array.from(area.children || []).find((c) => c && c.className === 'boardTabList');
          if (!list) return;
          for (const t of (tabs || [])) {
            const li = document.createElement('li');
            const link = document.createElement('a');
            link.href = '#';
            link.textContent = t.title || t.url || '';
            link.addEventListener('click', (e) => { if (e && e.preventDefault) e.preventDefault(); onOpenTab(t); });
            li.appendChild(link);
            list.appendChild(li);
          }
        });
      }
      return area;
    };
    expander.wire(row, build);
  }
  return row;
}

// A single parked-group row: color dot, name, "<n> tabs · last seen <date>" in
// muted text, and a '⋯' button whose menu offers "Open" and "Description…".
// After Open the board re-renders.
function parkedCard({ group, descriptions, send, setStatus, rerender, expander, onSplitProposal }) {
  const row = document.createElement('div');
  row.className = 'boardRow';
  const dot = document.createElement('span');
  dot.className = 'boardDot';
  dot.style.backgroundColor = DOT_COLORS[group.color] || DOT_COLORS.grey;
  const name = document.createElement('span');
  name.className = 'boardName';
  name.textContent = group.name || '(unnamed)';
  const meta = document.createElement('span');
  meta.className = 'boardCount';
  meta.textContent = `${group.tabCount} tabs · ${lastSeenText(group.lastSeen)}`;
  row.append(dot, name, meta);
  // A crowded parked group (more than 30 tabs) shows the same "30+" split hint.
  const badge = splitHintBadge(group.tabCount);
  if (badge) row.append(badge);

  const description = descriptionFor(descriptions, group.name);
  const openEditor = () => {
    const existing = Array.from(row.children || []).find((c) => c && c.className === 'boardDescEditor');
    if (existing) return;
    row.appendChild(descriptionEditor({ name: group.name, description, send, setStatus }));
  };
  const items = [
    { label: 'Open', onChoose: async () => { await send({ cmd: 'openParked', name: group.name }); await rerender(); } },
    { label: 'Split this group…', onChoose: async () => {
      const res = await send({ cmd: 'splitGroup', name: group.name });
      if (onSplitProposal && res && res.ok && res.proposal) onSplitProposal(res.proposal);
    } },
    { label: 'Description…', onChoose: openEditor },
  ];
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'boardMenuBtn';
  menuBtn.textContent = '⋯';
  menuBtn.addEventListener('click', () => { openMenu(row, items); });
  row.append(menuBtn);

  // Clicking a parked row expands it with the description (plus Edit) and the
  // tab titles from the index entry as plain text (parked tabs aren't live, so
  // there's nothing to focus).
  if (expander) {
    const tabs = Array.isArray(group.tabs) ? group.tabs : [];
    const build = () => expandedArea({ name: group.name, description, suggested: '', tabs, send, setStatus });
    expander.wire(row, build);
  }
  return row;
}

// The chrome.storage.local key holding the "last asked" dates, so we describe a
// given group at most once a day and opening new tabs doesn't call the model
// again and again.
const ASKED_KEY = 'boardDescribeAsked';

// The chrome.storage.local key holding the model's suggested descriptions, kept
// as { "<name-lowercased>": { description, date } } so the board can show a
// suggestion again on later renders without calling the model.
const SUGGESTIONS_KEY = 'boardDescribeSuggestions';

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

// Read/write the stored suggestions map. A missing store (tests) reads {} and
// writes nothing.
async function readSuggestions(storage) {
  if (!storage) return {};
  const got = await storage.get(SUGGESTIONS_KEY);
  return (got && got[SUGGESTIONS_KEY]) || {};
}

async function writeSuggestions(storage, suggestions) {
  if (!storage) return;
  await storage.set({ [SUGGESTIONS_KEY]: suggestions });
}

// Pick the open groups that have a name, lack a saved description, lack a stored
// suggestion (which the board shows without re-asking), and haven't been asked
// about today (per the memory). Returns [{ groupId, name }].
function groupsNeedingDescription(open, descriptions, suggestions, asked, today) {
  return open
    .filter((g) => {
      const name = String(g.name || '').trim();
      if (!name) return false;
      if (descriptionFor(descriptions, name)) return false;
      if (suggestionFor(suggestions, name)) return false;
      return asked[name.toLowerCase()] !== today;
    })
    .map((g) => ({ groupId: g.groupId, name: g.name }));
}

// In the background (never blocking the board), ask the model to suggest
// descriptions for open groups that have none: ask at most once a day per
// group, send one 'describe' request, then remember each suggestion (with its
// date) and re-render so the board shows them prefilled with a "Suggested"
// label. Nothing is saved to the groups file here — the host writes nothing and
// a suggestion for a group that now has a saved description is ignored. Does
// nothing when nothing needs asking. storage/today are injectable so the view
// is testable.
async function autoDescribe({ open, descriptions, suggestions, send, setStatus, rerender, storage, today }) {
  const asked = await readAsked(storage);
  const needing = groupsNeedingDescription(open, descriptions, suggestions, asked, today);
  if (!needing.length) return;
  // Mark them asked before sending so a re-render (or new tabs) won't ask again.
  for (const g of needing) asked[String(g.name).trim().toLowerCase()] = today;
  await writeAsked(storage, asked);
  const res = await send({ cmd: 'describe', groups: needing });
  const suggested = (res && Array.isArray(res.descriptions)) ? res.descriptions : [];
  if (!suggested.length) return;
  const next = { ...suggestions };
  let added = 0;
  for (const d of suggested) {
    const name = String(d.name || '').trim();
    if (!name || !d.description) continue;
    // A suggestion for a group that now has a saved description is ignored.
    if (descriptionFor(descriptions, name)) continue;
    next[name.toLowerCase()] = { description: d.description, date: today };
    added += 1;
  }
  if (!added) return;
  await writeSuggestions(storage, next);
  await rerender();
  setStatus(`Suggested descriptions for ${added} ${added === 1 ? 'group' : 'groups'}`);
}

// Build (or rebuild) the board inside `container`: an "Open now" section and a
// "Parked, from the index" section, each a foldable <details open>. Data comes
// from the service worker's 'boardData' command. setStatus is optional (defaults
// to a no-op) so the module stays importable without the panel's dom.js.
//
// The board stays live: it listens to the tab-group and tab events that change
// what's open (a parked/opened/applied group, or the user dragging tabs around)
// and re-requests boardData, debounced to ~400ms so a burst of events paints
// once. The listeners are attached once (tracked on the container) and removed
// by the teardown function this returns, so re-renders don't stack them.
export async function renderBoard(container, { send, setStatus = () => {}, storage = defaultStorage(), today = todayStr(), chromeApi = (typeof chrome !== 'undefined' ? chrome : undefined), debounceMs = 400, onSplitProposal = () => {} } = {}) {
  const rerender = () => renderBoard(container, { send, setStatus, storage, today, chromeApi, debounceMs, onSplitProposal });
  const res = await send({ cmd: 'boardData' });
  const open = (res && res.open) || [];
  const parkedRaw = (res && res.parked) || [];
  const descriptions = (res && res.descriptions) || [];
  // Stored model suggestions, shown on open cards that have no saved
  // description (prefilled with a "Suggested" label) without re-asking.
  const suggestions = await readSuggestions(storage);
  // Drop any parked card whose name matches an open group (trimmed, case-
  // insensitive): a reopened group is "open now", so it shouldn't also appear
  // under "Parked, from the index". The full parkedRaw is still passed to open
  // cards so one can offer to add a same-named parked record's tabs back.
  const openNames = new Set(open.map((g) => String(g.name || '').trim().toLowerCase()).filter(Boolean));
  const parked = parkedRaw.filter((g) => !openNames.has(String(g.name || '').trim().toLowerCase()));
  container.textContent = '';

  // One expander shared by every row so only a single row stays expanded at a
  // time, across both the open and parked sections.
  const expander = makeExpander();

  const openSection = document.createElement('details');
  openSection.open = true;
  openSection.className = 'boardSection';
  const openSummary = document.createElement('summary');
  openSummary.textContent = `Open now · ${open.length}`;
  openSection.appendChild(openSummary);
  if (!open.length) {
    const empty = document.createElement('p');
    empty.className = 'boardEmpty';
    empty.textContent = 'No open groups';
    openSection.appendChild(empty);
  } else {
    for (const group of open) openSection.appendChild(openCard({ group, descriptions, suggestions, parked: parkedRaw, send, setStatus, rerender, expander, chromeApi, onSplitProposal }));
  }

  const parkedSection = document.createElement('details');
  parkedSection.open = true;
  parkedSection.className = 'boardSection';
  const parkedSummary = document.createElement('summary');
  parkedSummary.textContent = `Parked · ${parked.length}`;
  parkedSection.appendChild(parkedSummary);
  if (!parked.length) {
    const empty = document.createElement('p');
    empty.className = 'boardEmpty';
    empty.textContent = 'Nothing parked yet';
    parkedSection.appendChild(empty);
  } else {
    for (const group of parked) parkedSection.appendChild(parkedCard({ group, descriptions, send, setStatus, rerender, expander, onSplitProposal }));
  }

  container.append(openSection, parkedSection);

  // Attach the live-update listeners once per container; a re-render reuses the
  // ones already wired. Returns the teardown that removes them.
  const teardown = attachLiveUpdates(container, { rerender, chromeApi, debounceMs });

  // After painting, ask the model to suggest descriptions for any open groups
  // that lack both a saved description and a stored suggestion — this never
  // blocks the board above, and re-renders itself when the model answers.
  autoDescribe({ open, descriptions, suggestions, send, setStatus, rerender, storage, today });

  return teardown;
}

// The tab-group and tab events that change what the board shows. tabs.onUpdated
// fires on every title/favicon/status change too, so its handler only re-renders
// when groupId or url changed — the fields a card actually reflects.
//
// Listeners are attached once per container (tracked via a WeakMap) with a
// single debounced re-render shared across every event, so a burst (parking a
// group fires many) paints once after ~debounceMs. Returns a teardown that
// clears any pending timer and detaches every listener; calling renderBoard
// again returns the same teardown without re-attaching.
const liveUpdates = new WeakMap();

function attachLiveUpdates(container, { rerender, chromeApi, debounceMs }) {
  const existing = liveUpdates.get(container);
  if (existing) return existing.teardown;
  const tabGroups = chromeApi && chromeApi.tabGroups;
  const tabs = chromeApi && chromeApi.tabs;
  // Need the full event surface; a bare { query } stub (some tests) can't carry
  // listeners, so there's nothing live to attach.
  const hasEvents = tabGroups && tabGroups.onCreated && tabGroups.onUpdated
    && tabGroups.onRemoved && tabGroups.onMoved
    && tabs && tabs.onCreated && tabs.onRemoved && tabs.onUpdated
    && tabs.onAttached && tabs.onDetached;
  if (!hasEvents) {
    const noop = () => {};
    return noop;
  }

  let timer;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; rerender(); }, debounceMs);
  };
  // tabs.onUpdated carries changeInfo; only groupId/url changes matter here.
  const onTabUpdated = (_tabId, changeInfo) => {
    if (changeInfo && ('groupId' in changeInfo || 'url' in changeInfo)) schedule();
  };

  tabGroups.onCreated.addListener(schedule);
  tabGroups.onUpdated.addListener(schedule);
  tabGroups.onRemoved.addListener(schedule);
  tabGroups.onMoved.addListener(schedule);
  tabs.onCreated.addListener(schedule);
  tabs.onRemoved.addListener(schedule);
  tabs.onUpdated.addListener(onTabUpdated);
  tabs.onAttached.addListener(schedule);
  tabs.onDetached.addListener(schedule);

  const teardown = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    tabGroups.onCreated.removeListener(schedule);
    tabGroups.onUpdated.removeListener(schedule);
    tabGroups.onRemoved.removeListener(schedule);
    tabGroups.onMoved.removeListener(schedule);
    tabs.onCreated.removeListener(schedule);
    tabs.onRemoved.removeListener(schedule);
    tabs.onUpdated.removeListener(onTabUpdated);
    tabs.onAttached.removeListener(schedule);
    tabs.onDetached.removeListener(schedule);
    liveUpdates.delete(container);
  };
  liveUpdates.set(container, { teardown });
  return teardown;
}
