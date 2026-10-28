// The new-tab board: a full-page version of the side panel's board. It reuses
// renderBoard from board/board.js and the same message channel to the service
// worker that the panel uses (chrome.runtime.sendMessage). The page paints the
// open groups immediately and, when the local helper (native host) is not
// reachable, still shows them with a one-line note that the parked groups need
// the helper. A search box at the top filters the cards by group name as the
// user types.
import { renderBoard } from '../board/board.js';
import { isHttpUrl } from '../lib/url-utils.js';

// One request/response round-trip to the service worker, same as the panel's
// dom.js send: resolves with whatever the handler returned, or undefined if the
// worker never replied (asleep/crashed).
export function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

// Show the rows whose group name contains `query` (case-insensitive, trimmed),
// hide the rest. An empty query shows every row. Matching is by the .boardName
// text inside each .boardRow, so it tracks whatever renderBoard drew. A
// collection box left with no matching row is hidden too.
export function filterCards(container, query) {
  const wanted = String(query || '').trim().toLowerCase();
  for (const card of container.querySelectorAll('.boardRow')) {
    const nameEl = card.querySelector('.boardName');
    const name = (nameEl && nameEl.textContent) ? nameEl.textContent.toLowerCase() : '';
    card.hidden = wanted !== '' && !name.includes(wanted);
  }
  for (const box of container.querySelectorAll('.boardCollection')) {
    box.hidden = wanted !== '' && !Array.from(box.querySelectorAll('.boardRow')).some((r) => !r.hidden);
  }
}

// Open the side panel for the current window, keeping the chrome.sidePanel.open
// call inside the user gesture so Chrome accepts it. Resolves true on success
// and false when sidePanel is missing or open() throws, so the caller can show
// the fallback note. The window id (or tab id) comes from the live APIs.
export async function openSidePanel(api = (typeof chrome !== 'undefined' ? chrome : undefined)) {
  if (!api || !api.sidePanel || typeof api.sidePanel.open !== 'function') return false;
  try {
    const win = api.windows && api.windows.getCurrent ? await api.windows.getCurrent() : undefined;
    if (win && win.id != null) {
      await api.sidePanel.open({ windowId: win.id });
    } else {
      const tab = api.tabs && api.tabs.getCurrent ? await api.tabs.getCurrent() : undefined;
      await api.sidePanel.open({ tabId: tab && tab.id });
    }
    return true;
  } catch {
    return false;
  }
}

// Whether this window's side panel is open: the extension's SIDE_PANEL contexts
// (runtime.getContexts, Chrome 116+) list one per open panel with its window
// id. Resolves false when the API is missing, so the button says "Open".
export async function isSidePanelOpen(windowId, api = (typeof chrome !== 'undefined' ? chrome : undefined)) {
  if (windowId == null || !api || !api.runtime || typeof api.runtime.getContexts !== 'function') return false;
  try {
    const contexts = await api.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
    return (contexts || []).some((c) => c && c.windowId === windowId);
  } catch {
    return false;
  }
}

// Close this window's side panel: sidePanel.close() where Chrome has it (141+),
// else ask the panel to close itself (sidepanel.js listens for closeSidePanel).
// Resolves false when neither is possible.
export async function closeSidePanel(windowId, api = (typeof chrome !== 'undefined' ? chrome : undefined)) {
  if (!api) return false;
  try {
    if (api.sidePanel && typeof api.sidePanel.close === 'function') {
      await api.sidePanel.close({ windowId });
      return true;
    }
    if (api.runtime && typeof api.runtime.sendMessage === 'function') {
      // Read lastError so Chrome doesn't log it when no one answers.
      api.runtime.sendMessage({ cmd: 'closeSidePanel', windowId }, () => void api.runtime.lastError);
      return true;
    }
  } catch { /* fall through */ }
  return false;
}

// Keep `refresh` running when the side panel may have opened or closed some
// other way (the toolbar icon, the panel's own close button): Chrome's
// sidePanel.onOpened/onClosed where it has them, whenever this page comes back
// into view, and once a second while it's visible. The timer doesn't hold a
// test process open.
function watchSidePanel(refresh, api, doc) {
  for (const ev of ['onOpened', 'onClosed']) {
    const e = api && api.sidePanel && api.sidePanel[ev];
    if (e && typeof e.addListener === 'function') e.addListener(() => { refresh(); });
  }
  if (doc && typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', () => { if (!doc.hidden) refresh(); });
  if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener('focus', () => { refresh(); });
  const timer = setInterval(() => { if (!doc || !doc.hidden) refresh(); }, 1000);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

// Query the live open groups straight from the tab strip, shaped like the
// `open` entries boardData returns. Used as a fallback when the helper is down
// so the open groups still render even though the parked ones can't be read.
async function openGroupsFallback() {
  const out = [];
  const groups = await chrome.tabGroups.query({});
  for (const g of groups) {
    const tabs = await chrome.tabs.query({ groupId: g.id });
    const webTabCount = tabs.filter((t) => isHttpUrl(t.url)).length;
    out.push({ groupId: g.id, name: g.title || '', color: g.color, windowId: g.windowId, tabCount: tabs.length, webTabCount });
  }
  return out;
}

// Paint the board into `container` and, when the helper is unreachable, reveal
// the `note` element so the user knows the parked groups are missing because of
// it. The service worker's boardData handler rejects when the native host is
// down, so send resolves with undefined; in that case we still show the open
// groups by answering renderBoard's boardData request from the live tab strip.
// document/send are injectable so the whole thing is unit-testable.
export async function initNewtab({ container, note, search, panelBtn, panelNote, storageApi = (typeof chrome !== 'undefined' ? chrome.storage : undefined) } = {}) {
  const doc = (typeof document !== 'undefined') ? document : undefined;
  const byId = (id) => (doc && typeof doc.getElementById === 'function') ? doc.getElementById(id) : undefined;
  container = container || byId('board');
  note = note || byId('helperNote');
  search = search || byId('search');
  panelBtn = panelBtn || byId('openPanel');
  panelNote = panelNote || byId('panelNote');

  // Intercept the boardData request: ask the service worker first, and if it
  // doesn't answer (helper down), fall back to the open groups we can read
  // locally and record that the helper was unreachable so the note can show.
  // Also, after a 'Sort this group' or 'Split this group…' click, open the side
  // panel so the suggestions / split proposal it produces are visible there.
  let helperReachable = true;
  const observingSend = async (message) => {
    const res = await send(message);
    if (message && message.cmd === 'boardData' && !res) {
      helperReachable = false;
      return { ok: true, open: await openGroupsFallback(), parked: [], descriptions: [] };
    }
    if (message && (message.cmd === 'sortGroup' || message.cmd === 'splitGroup')) {
      const opened = await openSidePanel();
      if (!opened && panelNote) panelNote.hidden = false;
    }
    return res;
  };

  // "Re-analyze parked groups…" runs in the side panel, where its result card
  // lives: leave a pendingReanalyze flag for the panel, then open it inside
  // this click so Chrome allows it.
  const onTidyParked = async () => {
    try { Promise.resolve(storageApi.local.set({ pendingReanalyze: Date.now() })).catch(() => {}); } catch { /* no storage: the panel just opens */ }
    const opened = await openSidePanel();
    if (!opened && panelNote) panelNote.hidden = false;
  };

  await renderBoard(container, { send: observingSend, onTidyParked });
  if (note) note.hidden = helperReachable;

  if (search) {
    search.addEventListener('input', () => filterCards(container, search.value));
  }

  // The side-panel button says "Close side panel" while this window's panel is
  // open, and closes it.
  if (panelBtn) {
    const api = (typeof chrome !== 'undefined') ? chrome : undefined;
    let windowId = null;
    let panelOpen = false;
    const paint = () => { panelBtn.textContent = panelOpen ? 'Close side panel' : 'Open side panel'; };
    const refresh = async () => {
      if (windowId == null && api && api.windows && typeof api.windows.getCurrent === 'function') {
        try { windowId = (await api.windows.getCurrent()).id; } catch { /* no window: stay on Open */ }
      }
      panelOpen = await isSidePanelOpen(windowId, api);
      paint();
    };
    panelBtn.addEventListener('click', async () => {
      if (panelOpen) {
        if (await closeSidePanel(windowId, api)) { panelOpen = false; paint(); }
        return;
      }
      const opened = await openSidePanel();
      if (!opened && panelNote) panelNote.hidden = false;
      if (opened) { panelOpen = true; paint(); }
    });
    await refresh();
    watchSidePanel(refresh, api, doc);
  }
}

// "Version 0.8.0" in the footer under the board.
export function paintNewtabVersion(doc = (typeof document !== 'undefined' ? document : undefined), api = (typeof chrome !== 'undefined' ? chrome : undefined)) {
  const el = doc && typeof doc.getElementById === 'function' ? doc.getElementById('ntVersion') : null;
  const m = (api && api.runtime && api.runtime.getManifest && api.runtime.getManifest()) || {};
  if (el) el.textContent = m.version ? `Version ${m.version}` : '';
}

// Only auto-run inside the browser; importing in a test harness won't paint.
if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime) {
  paintNewtabVersion();
  initNewtab();
}
