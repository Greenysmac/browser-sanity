// Side-panel bootstrap. Each feature lives in its own view module (plan, tabs,
// settings, sessions, muted, health, undo); this file just wires them up and does
// the first paint. See dom.js for the shared primitives they all build on.
import { initPlanView } from './plan-view.js';
import { initTabsView } from './tabs-view.js';
import { initSettingsView, loadSettings } from './settings-view.js';
import { initSessionsView, renderSessions } from './sessions-view.js';
import { initMutedView } from './muted-view.js';
import { initHealthView, checkHealth } from './health-view.js';
import { initUndoHistory } from './undo.js';
import { renderBoard } from '../board/board.js';
import { $, send, setStatus } from './dom.js';

// chrome.i18n scaffolding: replace the text of any [data-i18n] element with its
// localized message. Static English remains in the HTML as the fallback.
function applyI18n() {
  if (!chrome.i18n) return;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const msg = chrome.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
}

// Paint the board (open + parked groups) and repaint it whenever the user
// re-opens its fold, so it reflects any changes made since it was last shown.
function initBoardView() {
  const paint = () => renderBoard($('boardBody'), { send, setStatus });
  $('board').addEventListener('toggle', () => { if ($('board').open) paint(); });
  return paint();
}

(async () => {
  applyI18n();
  // Wire every panel's listeners first so the UI is responsive immediately.
  initTabsView();
  initSettingsView();
  initSessionsView();
  initMutedView();
  initHealthView();
  initUndoHistory();
  // First paint: plan (loads the stored plan), then settings + health + sessions.
  // Each step is independent — one throwing (e.g. loadSettings' direct storage/
  // crypto calls) must not leave the rest of the panel silently uninitialized.
  for (const step of [initPlanView, loadSettings, checkHealth, renderSessions, initBoardView]) {
    try { await step(); } catch (err) { console.error('[organizer] bootstrap step failed:', step.name, err); }
  }
})();
