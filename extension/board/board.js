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

// The muted "Parked Oct 11" line shown in a parked card's expanded area: a
// local, date-only 'Mon D' from the group's parkedAt or, failing that, its
// lastSeen. A missing/unparseable value reads just "Parked" rather than an
// invalid date.
function parkedDateText(group) {
  const iso = (group && (group.parkedAt || group.lastSeen)) || '';
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return 'Parked';
  const when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `Parked ${when}`;
}

// The small "parked" mark shown before a parked group's name: an inline SVG
// pause icon (two short bars) labelled "Parked". Built with createElementNS so
// the SVG renders in a real browser; the unit tests' bare fake document has no
// createElementNS, so it falls back to createElement there. Attributes are set
// with setAttribute when available (a real SVG element's class is read-only via
// the .className property), guarded for the bare fake element.
const SVG_NS = 'http://www.w3.org/2000/svg';
function makeSvg(tag) {
  if (typeof document.createElementNS === 'function') return document.createElementNS(SVG_NS, tag);
  return document.createElement(tag);
}
function setAttr(el, name, value) {
  if (!el) return;
  if (typeof el.setAttribute === 'function') el.setAttribute(name, value);
  // Mirror the class onto .className for the unit tests' fake element, but only
  // where className is a plain string: on a real SVG element it's a read-only
  // SVGAnimatedString, and assigning it threw and emptied the whole board.
  if (name === 'class' && typeof el.className === 'string') el.className = value;
}
function parkedMark() {
  const svg = makeSvg('svg');
  setAttr(svg, 'class', 'boardParkedMark');
  setAttr(svg, 'viewBox', '0 0 24 24');
  setAttr(svg, 'width', '12');
  setAttr(svg, 'height', '12');
  setAttr(svg, 'aria-label', 'Parked');
  setAttr(svg, 'role', 'img');
  for (const x of ['8', '14']) {
    const rect = makeSvg('rect');
    setAttr(rect, 'x', x);
    setAttr(rect, 'y', '6');
    setAttr(rect, 'width', '2');
    setAttr(rect, 'height', '12');
    setAttr(rect, 'rx', '1');
    svg.appendChild(rect);
  }
  return svg;
}

// The site name shown in bold at the head of each tab line: the URL's hostname
// without a leading "www.". A tab without a parseable URL reads ''.
function siteName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
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
// The most tab lines an expanded card shows; a group with more adds a muted
// "+ <n> more" line instead of listing the rest.
const MAX_TAB_LINES = 5;

// What follows the site in a URL ("/checkout/details?step=shipping"), shown in
// place of a missing page title since the site name is already on the line.
// Empty for a bare home page.
function urlRest(url) {
  try {
    const u = new URL(url);
    const rest = `${u.pathname}${u.search}${u.hash}`;
    return rest === '/' ? '' : rest;
  } catch {
    return String(url || '');
  }
}

// Build one tab line (<li>): the site name (hostname without "www.") in bold,
// then the page title (or, without one, the rest of the URL) in normal weight. For an open group `onOpenTab` makes the
// whole line a link that focuses the tab; a parked group's line is plain text.
// Built with createElement so names/titles can't inject markup.
function tabLine(t, onOpenTab) {
  const li = document.createElement('li');
  const site = siteName(t && t.url);
  const title = (t && t.title) || (site ? urlRest(t.url) : (t && t.url)) || '';
  // The line is cut off with "…" at the card's edge; hovering shows it whole.
  li.title = [t && t.title, t && t.url].filter(Boolean).join('\n');
  const makeContent = (host) => {
    if (site) {
      const siteEl = document.createElement('strong');
      siteEl.className = 'boardTabSite';
      siteEl.textContent = site;
      host.appendChild(siteEl);
      if (title) {
        const titleEl = document.createElement('span');
        titleEl.className = 'boardTabTitle';
        titleEl.textContent = title;
        host.appendChild(titleEl);
      }
    } else {
      const titleEl = document.createElement('span');
      titleEl.className = 'boardTabTitle';
      titleEl.textContent = title;
      host.appendChild(titleEl);
    }
  };
  if (onOpenTab && t && t.id != null) {
    const link = document.createElement('a');
    link.href = '#';
    makeContent(link);
    link.addEventListener('click', (e) => { if (e && e.preventDefault) e.preventDefault(); onOpenTab(t); });
    li.appendChild(link);
  } else {
    makeContent(li);
  }
  return li;
}

// Fill a <ul.boardTabList> with at most five tab lines; when the group has
// more, a muted "+ <n> more" line follows instead of the rest. `onOpenTab`,
// when given, makes each line a link that focuses that tab.
function fillTabList(list, tabs, onOpenTab) {
  const all = Array.isArray(tabs) ? tabs : [];
  for (const t of all.slice(0, MAX_TAB_LINES)) list.appendChild(tabLine(t, onOpenTab));
  const extra = all.length - MAX_TAB_LINES;
  if (extra > 0) {
    const more = document.createElement('li');
    more.className = 'boardTabMore';
    more.textContent = `+ ${extra} more`;
    list.appendChild(more);
  }
}

function expandedArea({ name, description, suggested, tabs, parkedDate, send, setStatus, onOpenTab }) {
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

  // For a parked group, a muted "Parked Oct 11" line under the description.
  if (parkedDate) {
    const parked = document.createElement('div');
    parked.className = 'boardExpandedParked';
    parked.textContent = parkedDate;
    wrap.appendChild(parked);
  }

  const list = document.createElement('ul');
  list.className = 'boardTabList';
  fillTabList(list, tabs, onOpenTab);
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

// A shared expander for the board's rows. Each row calls `wire(row, build)` to
// make itself clickable: a click anywhere on the row (except the ⋯ button, its
// menu, or an open editor/expanded area) toggles an expanded area built by
// `build()` and appended under the row; Enter or Space on the focused row does
// the same. Several rows may be open at once — clicking a row doesn't collapse
// any other, and clicking an already-open row collapses just that one.
function makeExpander() {
  const collapse = (row) => {
    if (!row) return;
    const area = Array.from(row.children || []).find((c) => c && c.className === 'boardExpanded');
    detach(area);
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
      if (isOpen) { collapse(row); return; }
      row.appendChild(build());
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
  // The count sits top-right, against the right edge before the ⋯ button, with
  // the "30+" split-hint badge (on a crowded group) beside it. A right-aligned
  // container holds both and pushes itself to the far side of the row.
  const countWrap = document.createElement('span');
  countWrap.className = 'boardCountWrap';
  countWrap.appendChild(count);
  const badge = splitHintBadge(webCount);
  if (badge) countWrap.appendChild(badge);
  row.append(dot, name, countWrap);

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
      const res = await send({ cmd: 'splitGroup', groupId: group.groupId, fromBoard: true });
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
      // the lines appear once the query answers — at most five, each a link
      // (bold site name + title) that focuses the tab, with a "+ <n> more" line
      // when the group has more.
      if (tabsApi && tabsApi.query && group.groupId != null) {
        Promise.resolve(tabsApi.query({ groupId: group.groupId })).then((tabs) => {
          const list = Array.from(area.children || []).find((c) => c && c.className === 'boardTabList');
          if (!list) return;
          fillTabList(list, tabs, onOpenTab);
        });
      }
      return area;
    };
    expander.wire(row, build);
  }
  return row;
}

// A single parked-group row: a parked mark (pause icon), color dot, name,
// "<n> tabs" in muted text (the date on hover), and a '⋯' button whose menu
// offers "Open" and "Description…". The row carries a 'boardRow--parked' class
// for its own look (dashed border, dimmer background, muted name) so it reads
// as parked, not open. After Open the board re-renders. When `newCount` > 0 the
// row shows a small "+<n> new" badge (tabs filed into this group by the last
// apply); expanding the row clears that count via `storage` so the badge
// doesn't linger. Expanding also shows a muted "Parked <Mon D>" line.
function parkedCard({ group, descriptions, newCount = 0, storage, send, setStatus, rerender, expander, onSplitProposal }) {
  const row = document.createElement('div');
  // A parked row gets its own look (dashed border, dimmer background, muted
  // name) via the extra class, so the user can tell it apart from an open one.
  row.className = 'boardRow boardRow--parked';
  const dot = document.createElement('span');
  dot.className = 'boardDot';
  dot.style.backgroundColor = DOT_COLORS[group.color] || DOT_COLORS.grey;
  // A small parked mark (a pause icon) sits before the name.
  const mark = parkedMark();
  const name = document.createElement('span');
  name.className = 'boardName';
  name.textContent = group.name || '(unnamed)';
  const meta = document.createElement('span');
  meta.className = 'boardCount';
  // Just the count on the row; the date shows on hover so
  // long names aren't cut off.
  meta.textContent = `${group.tabCount} tabs`;
  meta.title = lastSeenText(group.lastSeen);
  // The count/meta sits top-right, before the ⋯ button, with the "30+" split
  // hint (on a crowded parked group) and the "+n new" badge beside it, in a
  // right-aligned container.
  const countWrap = document.createElement('span');
  countWrap.className = 'boardCountWrap';
  countWrap.appendChild(meta);
  if (newCount > 0) {
    const newBadge = document.createElement('span');
    newBadge.className = 'boardNewBadge';
    newBadge.textContent = `+${newCount} new`;
    countWrap.appendChild(newBadge);
  }
  const badge = splitHintBadge(group.tabCount);
  if (badge) countWrap.appendChild(badge);
  row.append(dot, mark, name, countWrap);

  const description = descriptionFor(descriptions, group.name);
  const openEditor = () => {
    const existing = Array.from(row.children || []).find((c) => c && c.className === 'boardDescEditor');
    if (existing) return;
    row.appendChild(descriptionEditor({ name: group.name, description, send, setStatus }));
  };
  const items = [
    { label: 'Open', onChoose: async () => { await send({ cmd: 'openParked', name: group.name }); await rerender(); } },
    { label: 'Split this group…', onChoose: async () => {
      const res = await send({ cmd: 'splitGroup', name: group.name, fromBoard: true });
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
  // there's nothing to focus). Expanding also clears this group's "+n new"
  // badge: drop its stored count and remove the badge element from the row.
  if (expander) {
    const tabs = Array.isArray(group.tabs) ? group.tabs : [];
    const build = () => {
      if (newCount > 0) {
        clearNewCount(storage, group.name);
        const b = Array.from(countWrap.children || []).find((c) => c && c.className === 'boardNewBadge');
        detach(b);
      }
      return expandedArea({ name: group.name, description, suggested: '', tabs, parkedDate: parkedDateText(group), send, setStatus });
    };
    expander.wire(row, build);
  }
  return row;
}

// Drag-and-drop for the parked rows (HTML5 draggable). Each parked row calls
// `wire(row, name, box)` to become draggable, where `box` is the collection id
// it sits in (LOOSE_ID outside any collection). Dropping on another row hands
// `onMove({ name, to, target, after })` the dragged name, the target's box, the
// target name and which side of it; dropping on a box's title or its "Drag
// groups here" line (`wireBox`) lands the group at the end of that box, with no
// target. The move is computed from names rather than by moving DOM nodes, so
// it works the same in a real browser and in the tests' fake DOM; the handler
// saves it and re-renders. The drop marker is a class on the target row (a
// line above or below it) or on the box title.
function makeParkedDnd({ onMove }) {
  let dragging = null; // the name of the row being dragged
  let marked = null; // the row or box title showing the drop marker
  const MARKS = ['boardRow--dropBefore', 'boardRow--dropAfter', 'boardCollection--dropInto'];

  const setClass = (el, cls, on) => {
    if (!el) return;
    if (el.classList && typeof el.classList.toggle === 'function') { el.classList.toggle(cls, on); return; }
    const parts = String(el.className || '').split(/\s+/).filter((c) => c && c !== cls);
    if (on) parts.push(cls);
    el.className = parts.join(' ');
  };
  const clearIndicator = () => {
    if (marked) for (const cls of MARKS) setClass(marked, cls, false);
    marked = null;
  };
  const showIndicator = (el, cls) => {
    if (marked && marked !== el) clearIndicator();
    marked = el;
    for (const c of MARKS) setClass(el, c, c === cls);
  };
  const allow = (e) => {
    if (e && e.preventDefault) e.preventDefault(); // allow a drop
    if (e && e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  };

  const wire = (row, name, box) => {
    row.draggable = true;
    // dataset has only a getter in a real browser; the tests' fake rows have none.
    if (!row.dataset) row.dataset = {};
    row.dataset.parkedName = name;
    row.addEventListener('dragstart', (e) => {
      dragging = name;
      if (e && e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', name); } catch { /* ignore */ }
      }
    });
    row.addEventListener('dragend', () => { dragging = null; clearIndicator(); });
    const pointerAfter = (e) => {
      const rect = (typeof row.getBoundingClientRect === 'function') ? row.getBoundingClientRect() : null;
      return rect ? (e && e.clientY > rect.top + rect.height / 2) : false;
    };
    row.addEventListener('dragover', (e) => {
      if (dragging == null || dragging === name) return;
      allow(e);
      showIndicator(row, pointerAfter(e) ? 'boardRow--dropAfter' : 'boardRow--dropBefore');
    });
    row.addEventListener('drop', (e) => {
      if (dragging == null || dragging === name) { clearIndicator(); return; }
      if (e && e.preventDefault) e.preventDefault();
      const move = { name: dragging, to: box, target: name, after: pointerAfter(e) };
      dragging = null;
      clearIndicator();
      onMove(move);
    });
  };

  const wireBox = (el, box) => {
    el.addEventListener('dragover', (e) => {
      if (dragging == null) return;
      allow(e);
      showIndicator(el, 'boardCollection--dropInto');
    });
    el.addEventListener('dragleave', () => { if (marked === el) clearIndicator(); });
    el.addEventListener('drop', (e) => {
      if (dragging == null) { clearIndicator(); return; }
      if (e && e.preventDefault) e.preventDefault();
      const move = { name: dragging, to: box, target: null, after: false };
      dragging = null;
      clearIndicator();
      onMove(move);
    });
  };
  return { wire, wireBox };
}

// The box id for parked groups that aren't in any collection.
const LOOSE_ID = 'loose';

// A group name as a lookup key: trimmed and lower-cased, the way every other
// name match on the board works.
function nameKey(name) {
  return String(name || '').trim().toLowerCase();
}

// Move one group (by name) into box `to` (a collection id or LOOSE_ID): before
// or after `target`, a name in that box, or at its end when there's no target.
// The group leaves every other box. Returns the new { collections, looseOrder }
// and leaves the inputs unchanged.
function moveGroup({ collections, looseOrder }, { name, to, target, after }) {
  const k = nameKey(name);
  const without = (list) => list.filter((n) => nameKey(n) !== k);
  const insert = (list) => {
    const rest = without(list);
    const at = target == null ? -1 : rest.findIndex((n) => nameKey(n) === nameKey(target));
    const pos = at === -1 ? rest.length : (after ? at + 1 : at);
    rest.splice(pos, 0, name);
    return rest;
  };
  return {
    collections: collections.map((c) => ({ ...c, groups: c.id === to ? insert(c.groups) : without(c.groups) })),
    looseOrder: to === LOOSE_ID ? insert(looseOrder) : without(looseOrder),
  };
}

// Lay the parked groups (already in parkedOrder) out in collection boxes: each
// collection gets the parked groups it names, in its own order, and a group
// named by two collections sits in the first. Names with no parked group (a
// group open right now, say) are skipped but kept in the collection, so the
// group comes back to its box when it's parked again. The rest stay loose, in
// parked order. A collection keeps its box even when it's empty.
function layoutCollections(parked, collections) {
  const byKey = new Map(parked.map((g) => [nameKey(g.name), g]));
  const placed = new Set();
  const boxes = collections.map((c) => {
    const groups = [];
    for (const n of c.groups) {
      const k = nameKey(n);
      if (placed.has(k) || !byKey.has(k)) continue;
      placed.add(k);
      groups.push(byKey.get(k));
    }
    return { id: c.id, name: c.name, groups };
  });
  return { boxes, loose: parked.filter((g) => !placed.has(nameKey(g.name))) };
}

// A fresh collection id: unique enough for one person's handful of collections.
function newCollectionId(i = 0) {
  return `c${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`;
}

// The chrome.storage.local key holding the "last asked" dates, so we describe a
// given group at most once a day and opening new tabs doesn't call the model
// again and again.
const ASKED_KEY = 'boardDescribeAsked';

// The chrome.storage.local key holding the model's suggested descriptions, kept
// as { "<name-lowercased>": { description, date } } so the board can show a
// suggestion again on later renders without calling the model.
const SUGGESTIONS_KEY = 'boardDescribeSuggestions';

// The chrome.storage.local key holding how many tabs each parked group received
// in the last apply, kept as { "<name-lowercased>": <count> }. A parked card
// with a count > 0 shows a "+<n> new" badge until the user opens/expands it,
// which clears that group's entry.
const NEW_COUNTS_KEY = 'boardParkedNewCounts';

// The chrome.storage.local key holding the parked groups' order as a plain
// array of group names (in the user's chosen order). The board renders parked
// groups in this order; any parked group whose name isn't in the list follows
// after, in its current order. Drag-and-drop and the "Order ▾" menu both
// rewrite it.
const PARKED_ORDER_KEY = 'boardParkedOrder';

// The chrome.storage.local key holding the parked groups' collections: an array
// of { id, name, groups: [group names] } in the user's order. The AI suggests
// them ("Suggest collections…"); drag, rename and remove adjust them. Parked
// groups in none sit in a "Not in a collection" box after them.
const COLLECTIONS_KEY = 'boardCollections';

// The chrome.storage.local key holding the ids of the folded collection boxes
// (LOOSE_ID for the "Not in a collection" box).
const FOLDED_KEY = 'boardCollectionsFolded';

// The keys whose change in another window (the side panel or the new-tab page)
// repaints this board, so a drag in one shows in the other.
const SHARED_KEYS = [PARKED_ORDER_KEY, COLLECTIONS_KEY, FOLDED_KEY];

// The value of each shared key this page last wrote or repainted for (as JSON),
// so the storage listener repaints only for a change it hasn't seen.
const knownShared = new Map();

// Save a shared key, remembering the value so this page's own write doesn't
// repaint it a second time. A missing store (tests) writes nothing.
async function writeShared(storage, key, value) {
  if (!storage) return;
  knownShared.set(key, JSON.stringify(value));
  await storage.set({ [key]: value });
}

// Read the saved collections, dropping anything that isn't { id, name, groups }.
async function readCollections(storage) {
  if (!storage) return [];
  const got = await storage.get(COLLECTIONS_KEY);
  const list = got && got[COLLECTIONS_KEY];
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
    .map((c) => ({ id: c.id, name: c.name, groups: Array.isArray(c.groups) ? c.groups.map((g) => String(g || '')) : [] }));
}

// Read the folded box ids as a Set.
async function readFolded(storage) {
  if (!storage) return new Set();
  const got = await storage.get(FOLDED_KEY);
  const list = got && got[FOLDED_KEY];
  return new Set((Array.isArray(list) ? list : []).map((id) => String(id)));
}

// Save one box's folded state, skipping the write when nothing changed (Chrome
// fires a toggle event when a box is first drawn open or closed).
async function saveFold(storage, id, isFolded) {
  const folded = await readFolded(storage);
  if (folded.has(id) === isFolded) return;
  if (isFolded) folded.add(id); else folded.delete(id);
  await writeShared(storage, FOLDED_KEY, [...folded]);
}

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

// Read the per-parked-group "new tabs" counts ({ "<name-lowercased>": <count> }).
// A missing store (tests) reads {}.
async function readNewCounts(storage) {
  if (!storage) return {};
  const got = await storage.get(NEW_COUNTS_KEY);
  return (got && got[NEW_COUNTS_KEY]) || {};
}

// Clear one parked group's "new" count (by name, trimmed/case-insensitive) once
// the user opens/expands its card, so the "+n new" badge doesn't persist. A
// missing store (tests) does nothing.
async function clearNewCount(storage, name) {
  if (!storage) return;
  const counts = await readNewCounts(storage);
  const key = String(name || '').trim().toLowerCase();
  if (!(key in counts)) return;
  delete counts[key];
  await storage.set({ [NEW_COUNTS_KEY]: counts });
}

// Read the saved parked order: a plain array of group names. A missing store
// (tests) or a non-array value reads [].
async function readParkedOrder(storage) {
  if (!storage) return [];
  const got = await storage.get(PARKED_ORDER_KEY);
  const order = got && got[PARKED_ORDER_KEY];
  return Array.isArray(order) ? order : [];
}

// Save the parked order (an array of group names). A missing store (tests)
// writes nothing.
async function writeParkedOrder(storage, order) {
  await writeShared(storage, PARKED_ORDER_KEY, Array.isArray(order) ? order : []);
}

// Order the parked groups by a saved list of names (trimmed, case-insensitive):
// groups named in `order` come first in that order, then any parked group whose
// name isn't listed, in its current order. A name in `order` with no matching
// group is skipped. Never drops or duplicates a group.
function orderParked(parked, order) {
  const list = Array.isArray(parked) ? parked : [];
  const wanted = (Array.isArray(order) ? order : []).map((n) => String(n || '').trim().toLowerCase());
  const byKey = new Map();
  for (const g of list) {
    const key = String(g.name || '').trim().toLowerCase();
    if (!byKey.has(key)) byKey.set(key, g);
  }
  const out = [];
  const placed = new Set();
  for (const key of wanted) {
    if (placed.has(key)) continue;
    const g = byKey.get(key);
    if (g) { out.push(g); placed.add(key); }
  }
  for (const g of list) {
    const key = String(g.name || '').trim().toLowerCase();
    if (placed.has(key)) continue;
    placed.add(key);
    out.push(g);
  }
  return out;
}

// A comparable number for a parked group's "last used" or "time parked" times:
// the ISO string parsed to ms, or 0 when missing/unparseable. lastUsed falls
// back to parkedAt then lastSeen; parkedAt falls back to lastSeen, so older
// records written before these fields still order sensibly.
function timeMs(iso) {
  const t = Date.parse(String(iso || ''));
  return Number.isNaN(t) ? 0 : t;
}

// Compute a fresh parked order (an array of names) for one of the Order menu's
// choices: 'lastUsed' and 'parkedAt' sort newest first; 'alpha' sorts A→Z,
// case-insensitively. A stable sort keeps equal entries in their current order.
function sortedParkedNames(parked, mode) {
  const list = (Array.isArray(parked) ? parked : []).map((g, i) => ({ g, i }));
  const keyOf = (g) => {
    if (mode === 'lastUsed') return timeMs(g.lastUsed || g.parkedAt || g.lastSeen);
    if (mode === 'parkedAt') return timeMs(g.parkedAt || g.lastSeen);
    return 0;
  };
  list.sort((a, b) => {
    if (mode === 'alpha') {
      const cmp = String(a.g.name || '').toLowerCase().localeCompare(String(b.g.name || '').toLowerCase());
      return cmp || (a.i - b.i);
    }
    const diff = keyOf(b.g) - keyOf(a.g); // newest first
    return diff || (a.i - b.i);
  });
  return list.map((e) => e.g.name);
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

// Per board container: the AI's suggested collections waiting for Go (or an
// { error }), and the id of the collection whose name is being edited. Kept
// outside the DOM so a re-render draws them again.
const proposals = new WeakMap();
const renaming = new WeakMap();

// The Parked section: its title (count, Re-analyze, Order ▾), a row of
// collection tools, the AI's suggested collections when one is waiting, then
// the parked rows. With no collections the rows sit straight in the section,
// filling columns top to bottom on the new-tab page; with collections each
// collection is a box of its own (a Kanban column) and the rest sit in a "Not
// in a collection" box after them.
function parkedPart({ container, parked, collections, folded, descriptions, newCounts, storage, send, setStatus, rerender, expander, onSplitProposal, onTidyParked }) {
  const { boxes, loose } = layoutCollections(parked, collections);
  const hasCollections = collections.length > 0;
  const parkedSection = document.createElement('details');
  parkedSection.open = true;
  // The modifiers let the new-tab page stack parked groups top to bottom, or lay
  // the collection boxes out in rows.
  parkedSection.className = hasCollections ? 'boardSection boardSection--parked boardSection--collections' : 'boardSection boardSection--parked';
  const parkedSummary = document.createElement('summary');
  parkedSummary.textContent = `Parked · ${parked.length}`;
  parkedSection.appendChild(parkedSummary);
  // A small text button in the Parked header starts a "Re-analyze parked groups…"
  // proposal (merges + splits). It hands the proposal off via onTidyParked;
  // clicking it never toggles the fold (summary clicks default to that).
  const tidyBtn = document.createElement('button');
  tidyBtn.type = 'button';
  tidyBtn.className = 'boardTidyBtn';
  tidyBtn.textContent = 'Re-analyze parked groups…';
  tidyBtn.addEventListener('click', (e) => { if (e && e.preventDefault) e.preventDefault(); if (e && e.stopPropagation) e.stopPropagation(); onTidyParked(); });
  parkedSummary.appendChild(tidyBtn);
  // A small "Order ▾" text button opens a menu to reorder the parked groups in
  // one click: by last used, by time parked (both newest first), or A→Z. Each
  // choice rewrites parkedOrder once (and, with collections, the order inside
  // each one) and re-renders; dragging still works after. The button sits in
  // the summary, so a click mustn't also toggle the fold.
  if (parked.length) {
    const orderBtn = document.createElement('button');
    orderBtn.type = 'button';
    orderBtn.className = 'boardOrderBtn';
    orderBtn.textContent = 'Order ▾';
    const chooseOrder = async (mode) => {
      const names = sortedParkedNames(parked, mode);
      await writeParkedOrder(storage, names);
      if (hasCollections) {
        const rank = new Map(names.map((n, i) => [nameKey(n), i]));
        const byRank = (list) => [...list.filter((n) => rank.has(nameKey(n))).sort((x, y) => rank.get(nameKey(x)) - rank.get(nameKey(y))),
          ...list.filter((n) => !rank.has(nameKey(n)))];
        await writeShared(storage, COLLECTIONS_KEY, collections.map((c) => ({ ...c, groups: byRank(c.groups) })));
      }
      await rerender();
    };
    // The menu opens in a wrapper beside the button (a list of buttons inside a
    // button reopened the menu on every choice), and the wrapper swallows clicks
    // so choosing doesn't also fold the Parked section it sits in.
    const orderWrap = swallowClicks(document.createElement('span'));
    orderWrap.className = 'boardOrderWrap';
    orderBtn.addEventListener('click', (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      openMenu(orderWrap, [
        { label: 'Last used', onChoose: () => chooseOrder('lastUsed') },
        { label: 'Time parked', onChoose: () => chooseOrder('parkedAt') },
        { label: 'A to Z', onChoose: () => chooseOrder('alpha') },
      ]);
    });
    orderWrap.appendChild(orderBtn);
    parkedSummary.appendChild(orderWrap);
  }

  // Every box id on screen, for Fold all.
  const boxIds = [...boxes.map((b) => b.id), ...(loose.length ? [LOOSE_ID] : [])];
  if (parked.length >= 2 || hasCollections) {
    parkedSection.appendChild(collectionTools({
      hasCollections,
      allFolded: hasCollections && boxIds.length > 0 && boxIds.every((id) => folded.has(id)),
      pending: Boolean(proposals.get(container) && proposals.get(container).pending),
      onSuggest: async () => {
        // Groups already in a collection stay there; only the rest go to the AI.
        if (hasCollections && !loose.length) {
          proposals.set(container, { error: 'Every parked group is already in a collection.' });
          await rerender();
          return;
        }
        const started = Date.now();
        proposals.set(container, { pending: started });
        await rerender();
        // Tick the elapsed time on the card while the AI works.
        const tick = setInterval(() => {
          const clock = container.querySelector && container.querySelector('.boardProposalClock');
          if (clock) clock.textContent = elapsedLabel(Date.now() - started);
        }, 1000);
        let res;
        try {
          res = await send({ cmd: 'suggestCollections', current: boxes.map((b) => ({ name: b.name, groups: b.groups.map((g) => g.name) })) });
        } finally {
          clearInterval(tick);
        }
        if (!res || !res.ok) {
          proposals.set(container, { error: `The AI couldn't suggest collections${res && res.error ? `: ${res.error}` : '. Check that the helper is running, then try again.'}` });
        } else if (!Array.isArray(res.collections) || !res.collections.length) {
          proposals.set(container, { error: hasCollections ? 'The AI found no place for the groups that aren\'t in a collection.' : 'The AI found no collections for these groups.' });
        } else {
          proposals.set(container, { collections: res.collections });
        }
        await rerender();
      },
      onNew: async () => {
        const id = newCollectionId();
        await writeShared(storage, COLLECTIONS_KEY, [...collections, { id, name: 'New collection', groups: [] }]);
        renaming.set(container, id);
        await rerender();
      },
      onFoldAll: async (fold) => {
        await writeShared(storage, FOLDED_KEY, fold ? boxIds : []);
        await rerender();
      },
    }));
  }

  const proposal = proposals.get(container);
  if (proposal) {
    parkedSection.appendChild(proposalCard({
      proposal,
      existing: collections.map((c) => c.name),
      onGo: async () => {
        await writeShared(storage, COLLECTIONS_KEY, mergeSuggested(collections, proposal.collections));
        proposals.delete(container);
        await rerender();
      },
      onCancel: async () => { proposals.delete(container); await rerender(); },
    }));
  }

  if (!parked.length) {
    const empty = document.createElement('p');
    empty.className = 'boardEmpty';
    empty.textContent = 'Nothing parked yet';
    parkedSection.appendChild(empty);
    return parkedSection;
  }

  // A drop saves the move (the collections, and the loose order when it lands
  // there) and re-renders, so the board repaints in the saved order here and,
  // through the storage listener, in the other window too.
  const dnd = makeParkedDnd({
    onMove: async (move) => {
      const next = moveGroup({ collections, looseOrder: loose.map((g) => g.name) }, move);
      if (hasCollections) await writeShared(storage, COLLECTIONS_KEY, next.collections);
      if (move.to === LOOSE_ID) await writeParkedOrder(storage, next.looseOrder);
      await rerender();
    },
  });
  const card = (group, box) => {
    const row = parkedCard({ group, descriptions, newCount: newCounts[nameKey(group.name)] || 0, storage, send, setStatus, rerender, expander, onSplitProposal });
    dnd.wire(row, group.name || '', box);
    return row;
  };
  if (!hasCollections) {
    for (const group of parked) parkedSection.appendChild(card(group, LOOSE_ID));
    return parkedSection;
  }
  for (const box of boxes) {
    parkedSection.appendChild(collectionBox({
      box,
      folded: folded.has(box.id),
      editing: renaming.get(container) === box.id,
      cards: box.groups.map((g) => card(g, box.id)),
      storage,
      dnd,
      onRename: async () => { renaming.set(container, box.id); await rerender(); },
      onSaveName: async (name) => {
        renaming.delete(container);
        await writeShared(storage, COLLECTIONS_KEY, collections.map((c) => (c.id === box.id ? { ...c, name } : c)));
        await rerender();
      },
      onCancelName: async () => { renaming.delete(container); await rerender(); },
      onRemove: async () => {
        await writeShared(storage, COLLECTIONS_KEY, collections.filter((c) => c.id !== box.id));
        await rerender();
      },
    }));
  }
  if (loose.length) {
    parkedSection.appendChild(collectionBox({
      box: { id: LOOSE_ID, name: 'Not in a collection', groups: loose },
      loose: true,
      folded: folded.has(LOOSE_ID),
      cards: loose.map((g) => card(g, LOOSE_ID)),
      storage,
      dnd,
    }));
  }
  return parkedSection;
}

// A wrapper that keeps clicks inside it from reaching the <summary> it sits in,
// which would fold or unfold that section.
function swallowClicks(el) {
  el.addEventListener('click', (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
  });
  return el;
}

// The row of collection tools under the Parked title: Suggest collections…
// (…again once there are some), New collection, and Fold all / Unfold all.
// While the AI works, the Suggest button says so and can't be clicked twice.
function collectionTools({ hasCollections, allFolded, pending = false, onSuggest, onNew, onFoldAll }) {
  const row = document.createElement('div');
  row.className = 'boardCollectionTools';
  const suggest = document.createElement('button');
  suggest.type = 'button';
  suggest.className = 'boardToolBtn boardSuggestCollections';
  suggest.textContent = hasCollections ? 'Suggest collections again…' : 'Suggest collections…';
  suggest.disabled = pending;
  suggest.addEventListener('click', () => onSuggest());
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'boardToolBtn boardNewCollection';
  add.textContent = 'New collection';
  add.addEventListener('click', () => onNew());
  row.append(suggest, add);
  if (hasCollections) {
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'boardToolBtn boardFoldAll';
    fold.textContent = allFolded ? 'Unfold all' : 'Fold all';
    fold.addEventListener('click', () => onFoldAll(!allFolded));
    row.appendChild(fold);
  }
  return row;
}

// The AI's suggested collections, waiting for Go: each one's name and the
// groups it would get, with the ones that go into a collection you already
// have marked as such, and Go / Cancel. While the AI works the card says so,
// with a moving bar and the seconds so far. A failed suggestion shows its
// reason and a Dismiss button instead.
function proposalCard({ proposal, existing = [], onGo, onCancel }) {
  const card = document.createElement('div');
  card.className = 'boardCollectionProposal';
  const head = document.createElement('p');
  head.className = 'boardProposalHead';
  if (proposal.pending) {
    head.textContent = 'AI is sorting your groups into collections… ';
    const clock = document.createElement('span');
    clock.className = 'boardProposalClock';
    clock.textContent = elapsedLabel(Date.now() - proposal.pending);
    head.appendChild(clock);
    const bar = document.createElement('div');
    bar.className = 'boardProposalBar';
    card.append(head, bar);
    return card;
  }
  const buttons = document.createElement('div');
  buttons.className = 'boardProposalActions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'boardToolBtn';
  cancel.addEventListener('click', () => onCancel());
  if (proposal.error) {
    head.textContent = proposal.error;
    cancel.textContent = 'Dismiss';
    buttons.appendChild(cancel);
    card.append(head, buttons);
    return card;
  }
  const have = new Set(existing.map(nameKey));
  const n = proposal.collections.length;
  head.textContent = have.size
    ? 'The AI suggests where to put the groups that aren\'t in a collection. Your collections keep what\'s in them.'
    : `The AI suggests ${n} collection${n === 1 ? '' : 's'}.`;
  const list = document.createElement('ul');
  list.className = 'boardProposalList';
  for (const c of proposal.collections) {
    const li = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = c.name;
    const groups = document.createElement('span');
    groups.textContent = `${have.has(nameKey(c.name)) ? ' (add to it)' : have.size ? ' (new)' : ''} ${c.groups.join(', ')}`;
    li.append(name, groups);
    list.appendChild(li);
  }
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'boardGoBtn';
  go.textContent = 'Go';
  go.addEventListener('click', () => onGo());
  cancel.textContent = 'Cancel';
  buttons.append(go, cancel);
  card.append(head, list, buttons);
  return card;
}

// "m:ss" elapsed, like the side panel's scan clock.
function elapsedLabel(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// Fold the AI's suggestion into the saved collections without moving anything
// already in one: a suggested collection with the name of one you have adds its
// groups to the end of it, any other is a new collection after yours. A group
// that's already in a collection is skipped.
export function mergeSuggested(collections, suggested) {
  const out = collections.map((c) => ({ ...c, groups: c.groups.slice() }));
  const placed = new Set(out.flatMap((c) => c.groups.map(nameKey)));
  suggested.forEach((s, i) => {
    const groups = s.groups.filter((g) => !placed.has(nameKey(g)));
    groups.forEach((g) => placed.add(nameKey(g)));
    if (!groups.length) return;
    const same = out.find((c) => nameKey(c.name) === nameKey(s.name));
    if (same) same.groups.push(...groups);
    else out.push({ id: newCollectionId(i), name: s.name, groups });
  });
  return out;
}

// One collection box: a <details> whose title shows the name, how many groups
// it holds and (except on the "Not in a collection" box) a ⋯ menu with
// Rename… and Remove collection. Its title, and its "Drag groups here" line
// when it's empty, take a drop that lands a group at the end. Folding a box is
// saved, so it stays folded in every window. While `editing`, a name field sits
// under the title: Enter or Save keeps it, Escape or Cancel drops it.
function collectionBox({ box, loose = false, folded, editing = false, cards, storage, dnd, onRename, onSaveName, onCancelName, onRemove }) {
  const details = document.createElement('details');
  details.className = loose ? 'boardCollection boardCollection--loose' : 'boardCollection';
  details.open = editing || !folded;
  if (!details.dataset) details.dataset = {};
  details.dataset.collectionId = box.id;
  const summary = document.createElement('summary');
  summary.className = 'boardCollectionHead';
  const name = document.createElement('span');
  name.className = 'boardCollectionName';
  name.textContent = box.name;
  const count = document.createElement('span');
  count.className = 'boardCollectionCount';
  count.textContent = String(box.groups.length);
  summary.append(name, count);
  if (!loose) {
    const menuWrap = swallowClicks(document.createElement('span'));
    menuWrap.className = 'boardCollectionMenuWrap';
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'boardMenuBtn';
    menuBtn.textContent = '⋯';
    menuBtn.setAttribute?.('aria-label', `${box.name} options`);
    menuBtn.addEventListener('click', (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      openMenu(menuWrap, [
        { label: 'Rename…', onChoose: onRename },
        { label: 'Remove collection', onChoose: onRemove },
      ]);
    });
    menuWrap.appendChild(menuBtn);
    summary.appendChild(menuWrap);
  }
  details.appendChild(summary);
  dnd.wireBox(summary, box.id);
  if (editing) details.appendChild(nameEditor({ name: box.name, onSave: onSaveName, onCancel: onCancelName }));
  if (!cards.length) {
    const hint = document.createElement('p');
    hint.className = 'boardCollectionEmpty';
    hint.textContent = 'Drag groups here';
    dnd.wireBox(hint, box.id);
    details.appendChild(hint);
  }
  for (const c of cards) details.appendChild(c);
  details.addEventListener('toggle', () => { saveFold(storage, box.id, !details.open); });
  return details;
}

// The inline field for a collection's name: one line, at most 40 characters.
// An empty name cancels.
function nameEditor({ name, onSave, onCancel }) {
  const form = document.createElement('form');
  form.className = 'boardCollectionRename';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = name;
  input.maxLength = 40;
  input.setAttribute?.('aria-label', 'Collection name');
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const commit = () => {
    const next = String(input.value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (next) onSave(next); else onCancel();
  };
  form.addEventListener('submit', (e) => { if (e && e.preventDefault) e.preventDefault(); commit(); });
  input.addEventListener('keydown', (e) => { if (e && e.key === 'Escape') onCancel(); });
  cancel.addEventListener('click', () => onCancel());
  form.append(input, save, cancel);
  // Put the cursor in the field once it's on the page.
  setTimeout(() => { if (typeof input.focus === 'function') input.focus(); if (typeof input.select === 'function') input.select(); }, 0);
  return form;
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
export async function renderBoard(container, { send, setStatus = () => {}, storage = defaultStorage(), today = todayStr(), chromeApi = (typeof chrome !== 'undefined' ? chrome : undefined), debounceMs = 400, onSplitProposal = () => {}, onTidyParked = () => {} } = {}) {
  const rerender = () => renderBoard(container, { send, setStatus, storage, today, chromeApi, debounceMs, onSplitProposal, onTidyParked });
  const res = await send({ cmd: 'boardData' });
  const open = (res && res.open) || [];
  const parkedRaw = (res && res.parked) || [];
  const descriptions = (res && res.descriptions) || [];
  // Stored model suggestions, shown on open cards that have no saved
  // description (prefilled with a "Suggested" label) without re-asking.
  const suggestions = await readSuggestions(storage);
  // Per-parked-group "new tabs" counts from the last apply; a parked card with a
  // count > 0 shows a "+n new" badge until the user opens/expands it.
  const newCounts = await readNewCounts(storage);
  // The user's saved parked order (a list of names); parked groups render in
  // this order, with any not listed after them in their current order.
  const parkedOrder = await readParkedOrder(storage);
  // The parked groups' collections and which boxes are folded.
  const collections = await readCollections(storage);
  const folded = await readFolded(storage);
  // Drop any parked card whose name matches an open group (trimmed, case-
  // insensitive): a reopened group is "open now", so it shouldn't also appear
  // under "Parked, from the index". The full parkedRaw is still passed to open
  // cards so one can offer to add a same-named parked record's tabs back.
  const openNames = new Set(open.map((g) => String(g.name || '').trim().toLowerCase()).filter(Boolean));
  const parked = orderParked(parkedRaw.filter((g) => !openNames.has(String(g.name || '').trim().toLowerCase())), parkedOrder);
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

  const parkedSection = parkedPart({ container, parked, collections, folded, descriptions, newCounts, storage, send, setStatus, rerender, expander, onSplitProposal, onTidyParked });

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

// The tab-group and tab events that change what the board shows, plus a change
// to the parked order, collections or folds made in the other window. tabs.
// onUpdated fires on every title/favicon/status change too, so its handler only
// re-renders when groupId or url changed — the fields a card actually reflects.
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
  const storageEvents = chromeApi && chromeApi.storage && chromeApi.storage.onChanged;
  // Need the full event surface; a bare { query } stub (some tests) can't carry
  // listeners, so there's nothing live to attach.
  const hasEvents = tabGroups && tabGroups.onCreated && tabGroups.onUpdated
    && tabGroups.onRemoved && tabGroups.onMoved
    && tabs && tabs.onCreated && tabs.onRemoved && tabs.onUpdated
    && tabs.onAttached && tabs.onDetached;
  const hasStorage = storageEvents && typeof storageEvents.addListener === 'function';
  if (!hasEvents && !hasStorage) {
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
  // The other window (side panel or new-tab page) reordered, re-collected or
  // folded the parked groups: repaint. A value this page wrote itself, or has
  // already repainted for, is skipped.
  const onStorageChanged = (changes, area) => {
    if (area !== 'local' || !changes) return;
    let changed = false;
    for (const key of SHARED_KEYS) {
      if (!(key in changes)) continue;
      const json = JSON.stringify(changes[key] && changes[key].newValue);
      if (json === knownShared.get(key)) continue;
      knownShared.set(key, json);
      changed = true;
    }
    if (changed) schedule();
  };

  if (hasEvents) {
    tabGroups.onCreated.addListener(schedule);
    tabGroups.onUpdated.addListener(schedule);
    tabGroups.onRemoved.addListener(schedule);
    tabGroups.onMoved.addListener(schedule);
    tabs.onCreated.addListener(schedule);
    tabs.onRemoved.addListener(schedule);
    tabs.onUpdated.addListener(onTabUpdated);
    tabs.onAttached.addListener(schedule);
    tabs.onDetached.addListener(schedule);
  }
  if (hasStorage) storageEvents.addListener(onStorageChanged);

  const teardown = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (hasEvents) {
      tabGroups.onCreated.removeListener(schedule);
      tabGroups.onUpdated.removeListener(schedule);
      tabGroups.onRemoved.removeListener(schedule);
      tabGroups.onMoved.removeListener(schedule);
      tabs.onCreated.removeListener(schedule);
      tabs.onRemoved.removeListener(schedule);
      tabs.onUpdated.removeListener(onTabUpdated);
      tabs.onAttached.removeListener(schedule);
      tabs.onDetached.removeListener(schedule);
    }
    if (hasStorage && typeof storageEvents.removeListener === 'function') storageEvents.removeListener(onStorageChanged);
    liveUpdates.delete(container);
  };
  liveUpdates.set(container, { teardown });
  return teardown;
}
