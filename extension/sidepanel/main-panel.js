// The redesigned main panel top: the version chip in the header, the Sort card
// (segmented scope control + "models in use" line driving the hidden scope
// select / sortSelected), and the result card (one summary line + Apply +
// Review). Everything that mutates the plan still lives in plan-view.js; this
// module only drives the new surfaces and reuses the existing control ids
// (run / scope / sortSelected / approveAll) so current behavior is unchanged.
import { $ } from './dom.js';
import { getSettings } from '../lib/storage.js';
import { planSummaryLine, modelsInUseLine } from './viewmodel.js';

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

// Update the result card from the current plan: one plain summary line, shown
// only when there's something to apply. Called by plan-view after every render.
export function updateResultCard(plan) {
  const card = $('resultCard');
  if (!card) return;
  const line = planSummaryLine(plan);
  const hasResult = (plan && plan.length > 0) && !!line;
  card.hidden = !hasResult;
  const summary = $('resultSummary');
  if (summary) summary.textContent = line;
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

export function initMainPanel() {
  paintVersion();
  paintModelsInUse();

  const seg = $('scopeSegment');
  if (seg) {
    for (const btn of seg.querySelectorAll('button[data-scope]')) {
      btn.addEventListener('click', () => setScope(btn.dataset.scope));
    }
  }
  setScope('window');
  setReviewShown(false); // detailed list hidden until Review is clicked

  // "Selected tabs" mode reroutes the Sort button to the existing sortSelected
  // path; otherwise it falls through to the normal Analyze run (plan-view wired
  // #run already). We intercept in the capture phase only for selected mode.
  const runBtn = $('run');
  const sortSelectedBtn = $('sortSelected');
  if (runBtn && sortSelectedBtn) {
    runBtn.addEventListener('click', (e) => {
      if (selectedMode) {
        e.stopImmediatePropagation();
        e.preventDefault();
        sortSelectedBtn.click();
      }
    }, true);
  }

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
