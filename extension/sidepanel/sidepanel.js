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
import { initMainPanel } from './main-panel.js';
import { renderBoard } from '../board/board.js';
import { showSplitProposal } from './split-view.js';
import { showTidyProposal } from './tidy-view.js';
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
// A "Split this group…" choice hands a proposal to the split card (below); the
// card's Apply refreshes the board afterwards.
function initBoardView() {
  const splitEls = {
    card: $('splitCard'),
    summary: $('splitSummary'),
    review: $('splitReview'),
    reviewList: $('splitReviewList'),
    apply: $('splitApply'),
    dismiss: $('splitDismiss'),
  };
  const tidyEls = {
    card: $('tidyCard'),
    summary: $('tidySummary'),
    list: $('tidyList'),
    apply: $('tidyApply'),
    dismiss: $('tidyDismiss'),
  };
  const paint = () => renderBoard($('boardBody'), { send, setStatus, onSplitProposal, onTidyParked });
  // Once a proposal is on screen, drop the stored copy so it can't come back
  // the next time the panel opens.
  const onSplitProposal = (proposal) => {
    showSplitProposal({ proposal, els: splitEls, send, setStatus, onDone: paint });
    send({ cmd: 'clearSplitProposal' });
  };
  // "Re-analyze parked groups…" (the Parked header button and the Parked-groups
  // part button): ask the service worker for a proposal, then show it on the tidy card. A
  // Split… line reuses the existing split flow (splitGroup by parked name); the
  // merge Apply refreshes the board.
  const onSplitByName = async (name) => {
    setStatus(`Working out a split for ${name}…`);
    const res = await send({ cmd: 'splitGroup', name });
    if (res && res.ok && res.proposal) { setStatus(''); onSplitProposal(res.proposal); }
    else setStatus(`Could not split ${name}.`);
  };
  const onTidyParked = async () => {
    setStatus('Re-analyzing parked groups…');
    const res = await send({ cmd: 'tidyParked' });
    if (!res || !res.ok) { setStatus('Could not re-analyze parked groups.'); return; }
    setStatus('');
    showTidyProposal({ proposal: res, els: tidyEls, send, setStatus, onSplit: onSplitByName, onDone: paint });
  };
  const moreTidy = $('reanalyzeParked');
  if (moreTidy) moreTidy.addEventListener('click', onTidyParked);
  // The new-tab page's "Re-analyze parked groups…" opens this panel and leaves a
  // pendingReanalyze timestamp. Run it here once, whether the panel was just
  // opened or already open; a flag older than a minute is stale and dropped.
  let reanalyzing = false;
  const runPendingReanalyze = async () => {
    if (reanalyzing || !chrome.storage || !chrome.storage.local) return;
    const { pendingReanalyze } = await chrome.storage.local.get('pendingReanalyze');
    if (!pendingReanalyze) return;
    reanalyzing = true;
    try {
      await chrome.storage.local.remove('pendingReanalyze');
      if (Date.now() - pendingReanalyze < 60000) await onTidyParked();
    } finally {
      reanalyzing = false;
    }
  };
  runPendingReanalyze();
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.pendingReanalyze && changes.pendingReanalyze.newValue) runPendingReanalyze();
    });
  }
  $('board').addEventListener('toggle', () => { if ($('board').open) paint(); });
  // A proposal may already be waiting — the new-tab page's Split action stores
  // one and opens the panel, so show it on first load.
  send({ cmd: 'getSplitProposal' }).then((res) => {
    if (res && res.ok && res.proposal) onSplitProposal(res.proposal);
  });
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
  initMainPanel();
  // First paint: plan (loads the stored plan), then settings + health + sessions.
  // Each step is independent — one throwing (e.g. loadSettings' direct storage/
  // crypto calls) must not leave the rest of the panel silently uninitialized.
  for (const step of [initPlanView, loadSettings, checkHealth, renderSessions, initBoardView]) {
    try { await step(); } catch (err) { console.error('[organizer] bootstrap step failed:', step.name, err); }
  }
})();
