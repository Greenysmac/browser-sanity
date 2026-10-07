// The new-tab board: a full-page version of the side panel's board. It reuses
// renderBoard from board/board.js and the same message channel to the service
// worker that the panel uses (chrome.runtime.sendMessage). The page paints the
// open groups immediately and, when the local helper (native host) is not
// reachable, still shows them with a one-line note that the parked groups need
// the helper. A search box at the top filters the cards by group name as the
// user types.
import { renderBoard } from '../board/board.js';

// One request/response round-trip to the service worker, same as the panel's
// dom.js send: resolves with whatever the handler returned, or undefined if the
// worker never replied (asleep/crashed).
export function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

// Show the cards whose group name contains `query` (case-insensitive, trimmed),
// hide the rest. An empty query shows every card. Matching is by the .boardName
// text inside each .boardCard, so it tracks whatever renderBoard drew.
export function filterCards(container, query) {
  const wanted = String(query || '').trim().toLowerCase();
  for (const card of container.querySelectorAll('.boardCard')) {
    const nameEl = card.querySelector('.boardName');
    const name = (nameEl && nameEl.textContent) ? nameEl.textContent.toLowerCase() : '';
    card.hidden = wanted !== '' && !name.includes(wanted);
  }
}

// Query the live open groups straight from the tab strip, shaped like the
// `open` entries boardData returns. Used as a fallback when the helper is down
// so the open groups still render even though the parked ones can't be read.
async function openGroupsFallback() {
  const out = [];
  const groups = await chrome.tabGroups.query({});
  for (const g of groups) {
    const tabs = await chrome.tabs.query({ groupId: g.id });
    out.push({ groupId: g.id, name: g.title || '', color: g.color, windowId: g.windowId, tabCount: tabs.length });
  }
  return out;
}

// Paint the board into `container` and, when the helper is unreachable, reveal
// the `note` element so the user knows the parked groups are missing because of
// it. The service worker's boardData handler rejects when the native host is
// down, so send resolves with undefined; in that case we still show the open
// groups by answering renderBoard's boardData request from the live tab strip.
// document/send are injectable so the whole thing is unit-testable.
export async function initNewtab({ container, note, search } = {}) {
  const doc = (typeof document !== 'undefined') ? document : undefined;
  container = container || (doc && doc.getElementById('board'));
  note = note || (doc && doc.getElementById('helperNote'));
  search = search || (doc && doc.getElementById('search'));

  // Intercept the boardData request: ask the service worker first, and if it
  // doesn't answer (helper down), fall back to the open groups we can read
  // locally and record that the helper was unreachable so the note can show.
  let helperReachable = true;
  const observingSend = async (message) => {
    const res = await send(message);
    if (message && message.cmd === 'boardData' && !res) {
      helperReachable = false;
      return { ok: true, open: await openGroupsFallback(), parked: [], descriptions: [] };
    }
    return res;
  };

  await renderBoard(container, { send: observingSend });
  if (note) note.hidden = helperReachable;

  if (search) {
    search.addEventListener('input', () => filterCards(container, search.value));
  }
}

// Only auto-run inside the browser; importing in a test harness won't paint.
if (typeof document !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime) {
  initNewtab();
}
