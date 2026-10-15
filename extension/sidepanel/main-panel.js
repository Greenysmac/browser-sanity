// The redesigned main panel top: the version chip in the header, the Sort card
// (segmented scope control + "models in use" line driving the hidden scope
// select / sortSelected), and the result card (one summary line + Apply +
// Review). Everything that mutates the plan still lives in plan-view.js; this
// module only drives the new surfaces and reuses the existing control ids
// (run / scope / sortSelected / approveAll) so current behavior is unchanged.
import { $ } from './dom.js';
import { getSettings } from '../lib/storage.js';
import { planSummaryLine, modelsInUseLine, originLine } from './viewmodel.js';

// Reflect the extension version in the header: version_name preferred (it reads
// "0.2.2 Browser Sanity"), falling back to the bare version. Guarded so unit
// tests without chrome.runtime.getManifest don't throw.
function paintVersion() {
  const el = $('appVersion');
  if (!el) return;
  const m = (chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest()) || {};
  el.textContent = m.version_name || m.version || '';
}

// Fill the muted "models in use" line from the two model slots.
async function paintModelsInUse() {
  const el = $('modelsInUse');
  if (!el) return;
  try {
    const s = await getSettings();
    el.textContent = modelsInUseLine(s.bigModel, s.quickModel);
  } catch {
    el.textContent = modelsInUseLine('', '');
  }
}

// Point the three-way segmented control at the existing machinery: "This window"
// and "All windows" set the hidden scope <select>; "Selected tabs" is a mode
// that routes the Sort button to sortSelected instead of the full Analyze run.
let selectedMode = false;
function setScope(scope) {
  const seg = $('scopeSegment');
  if (seg) {
    for (const b of seg.querySelectorAll('button[data-scope]')) {
      b.setAttribute('aria-pressed', String(b.dataset.scope === scope));
    }
  }
  selectedMode = scope === 'selected';
  const sel = $('scope');
  if (sel && scope !== 'selected') sel.value = scope === 'all' ? 'all' : 'window';
}

export function isSelectedMode() {
  return selectedMode;
}

// The parked-match checkbox the result card shows when the plan has groupTabs
// items flagged data.parkedMatch. CHECKED by default: tabs that belong to a
// parked group are put away into it (saved and closed), so a parked group stays
// out of sight; tabs for open groups join them and stay open. Unchecking keeps
// this plan's parked-group tabs open in live groups instead. (Jeff, 2026-10-15:
// "if things are live, I want them grouped but live. If I've parked something
// like self-hosting, I want it visually gone.")
let parkedCheckbox = null;
let parkedPref = true; // the user's choice for the current plan; back to true for the next

// Whether the user has opted to file parked-name matches into the parked record.
// The apply path (plan-view) reads this to set the message's fileIntoParked.
export function fileIntoParkedChecked() {
  return !!(parkedCheckbox && parkedCheckbox.checked);
}

// A per-group count line for the label, e.g. "Hearing research 1, Someday 1",
// built from the parkedMatch items in first-seen order.
function parkedBreakdown(parked) {
  const byGroup = new Map();
  for (const it of parked) {
    const name = (it.data && it.data.groupName) || '';
    byGroup.set(name, (byGroup.get(name) || 0) + tabsIn(it));
  }
  return [...byGroup.entries()].map(([name, n]) => `${name} ${n}`).join(', ');
}

// Add or remove the parked-match checkbox under the summary. Shown only when the
// plan has parkedMatch groupTabs items; rebuilt each paint so its label/count
// track the current plan, and always starts unchecked.
const tabsIn = (it) => ((it.data && it.data.tabIds && it.data.tabIds.length) || 0);

function paintParkedToggle(card, items) {
  // A repaint of the same plan (an edit in Review) keeps the user's choice.
  if (parkedCheckbox) parkedPref = parkedCheckbox.checked;
  if (parkedCheckbox && parkedCheckbox._row && parkedCheckbox._row.parentNode) {
    parkedCheckbox._row.parentNode.removeChild(parkedCheckbox._row);
  }
  parkedCheckbox = null;
  const parked = items.filter((it) => it.action === 'groupTabs' && it.data && it.data.parkedMatch);
  if (!parked.length) return;
  const tabCount = parked.reduce((n, it) => n + tabsIn(it), 0);
  const row = document.createElement('label');
  row.className = 'parkedToggle';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'fileIntoParked';
  box.checked = parkedPref;
  const text = document.createElement('span');
  text.textContent = `Put the ${tabCount} tab${tabCount === 1 ? '' : 's'} for parked groups away in them (${parkedBreakdown(parked)}). They're saved and closed. Uncheck to keep them open.`;
  row.appendChild(box);
  row.appendChild(text);
  box._row = row;
  parkedCheckbox = box;
  // Below the summary and its From line.
  const after = (originEl && originEl.parentNode === card) ? originEl : $('resultSummary');
  if (after && after.parentNode === card) after.insertAdjacentElement('afterend', row);
  else card.appendChild(row);
}

// The muted "From <label>, <time>" line under the summary — what made the plan
// and when. Built with createElement/textContent so a label can't inject markup.
// Rebuilt each paint and inserted after the summary; removed when there's no
// origin (an edited-away or stale plan).
let originEl = null;
function paintResultOrigin(card, origin) {
  if (originEl && originEl.parentNode) originEl.parentNode.removeChild(originEl);
  originEl = null;
  const text = originLine(origin);
  if (!text) return;
  const p = document.createElement('p');
  p.className = 'resultOrigin';
  p.textContent = text;
  originEl = p;
  const summary = $('resultSummary');
  if (summary && summary.parentNode === card) summary.insertAdjacentElement('afterend', p);
  else card.appendChild(p);
}

// Update the result card from the current plan: one plain summary line, a muted
// "From <label>, <time>" origin line, plus the "N suggestions." count (shown
// only here, not in the status line above). The card is shown whenever there's
// a plan to apply. `origin` is the { label, at } the plan carries, or null.
export function updateResultCard(plan, origin = null) {
  const card = $('resultCard');
  if (!card) return;
  const items = plan || [];
  const line = planSummaryLine(items);
  const hasResult = items.length > 0;
  card.hidden = !hasResult;
  const summary = $('resultSummary');
  if (summary) summary.textContent = line;
  paintResultOrigin(card, hasResult ? origin : null);
  const count = $('resultCount');
  if (count) count.textContent = hasResult ? `${items.length} suggestion${items.length === 1 ? '' : 's'}.` : '';
  if (!hasResult) { parkedPref = true; if (parkedCheckbox) parkedCheckbox.checked = true; } // a fresh plan starts at the default
  paintParkedToggle(card, items);
}

// Review toggles the detailed suggestion list (and its toolbar/actions), which
// is hidden by default. Returns the new shown state.
function setReviewShown(shown) {
  const btn = $('reviewToggle');
  if (btn) btn.setAttribute('aria-expanded', String(shown));
  for (const id of ['plan', 'planTools', 'planActions', 'summary']) {
    const el = $(id);
    if (el) el.classList.toggle('reviewHidden', !shown);
  }
}

// Clear the result card and collapse the detailed list — called when a fresh
// Analyze starts so yesterday's "Move N tabs into M groups" card can't linger.
export function hideResults() {
  updateResultCard([]);
  setReviewShown(false);
}

export function initMainPanel() {
  paintVersion();
  paintModelsInUse();

  // The ⋯ opens the More view (board tools, sessions, muted) and "Done" returns,
  // mirroring the Settings view: body[data-view="more"] swaps the main content.
  const setView = (view) => { if (document.body) document.body.dataset.view = view; };
  const openMore = $('openMore');
  if (openMore) openMore.addEventListener('click', () => setView('more'));
  const moreDone = $('moreDone');
  if (moreDone) moreDone.addEventListener('click', () => setView('main'));

  const seg = $('scopeSegment');
  if (seg) {
    for (const btn of seg.querySelectorAll('button[data-scope]')) {
      btn.addEventListener('click', () => setScope(btn.dataset.scope));
    }
  }
  setScope('window');
  setReviewShown(false); // detailed list hidden until Review is clicked

  const applyBtn = $('resultApply');
  const approveAll = $('approveAll');
  if (applyBtn && approveAll) applyBtn.addEventListener('click', () => approveAll.click());

  const reviewBtn = $('reviewToggle');
  if (reviewBtn) {
    reviewBtn.addEventListener('click', () => {
      const shown = reviewBtn.getAttribute('aria-expanded') === 'true';
      setReviewShown(!shown);
    });
  }
}
