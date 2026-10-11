// The suggestions feature: the plan list and everything that mutates it — render,
// per-item edits, the run/command scans that produce a plan, and apply. These
// share the plan/selection state so they live together; other panels talk to this
// one only through initPlanView() (bootstrap) and showUndoToast() (undo module).
import { $, setStatus, flashStatus, send, fetchPlan, focusTab, currentScopeWindowId, confirmAction } from './dom.js';
import { startScanClock, stopScanClock, ensureScanPort } from './scan-clock.js';
import { showUndoToast } from './undo.js';
import { updateResultCard } from './main-panel.js';
import { isSelectedMode } from './main-panel.js';
import { hideResults } from './main-panel.js';
import { fileIntoParkedChecked } from './main-panel.js';
import { ignoreKey } from '../lib/orchestrator.js';
import { TAB_GROUP_COLORS as GROUP_COLORS } from '../lib/colors.js';
import { STATUS_LABELS } from '../lib/labels.js';
import {
  summarize, groupByAction, toggleSelection, selectedItems, actionLabel,
  excludeMember, renameGroup, recolorGroup, moveMember, toMarkdown,
  allItemIds, filterPlan, needsBulkConfirm, destructiveCount, groupByStatus, statusLabel,
} from './viewmodel.js';

let plan = [];
let planOrigin = null; // { label, at } — what made the plan, shown on the result card
let selection = new Set();
const expandedGroups = new Set();
let planFilter = '';
let groupBookmarksByStatus = false; // panel-local pref: bucket the Delete-bookmark group by status

// Display order for the bookmark status buckets. The priority list fixes the
// order of the known buckets; any bucket added to STATUS_LABELS later is appended
// automatically so it can't silently fail to render (it just lands before 'other').
const BUCKET_PRIORITY = ['http-404', 'http-410', 'unreachable', 'dead-other', 'duplicate', 'stale', 'other'];
const BUCKET_ORDER = [
  ...BUCKET_PRIORITY.filter((k) => k !== 'other'),
  ...Object.keys(STATUS_LABELS).filter((k) => !BUCKET_PRIORITY.includes(k)),
  'other',
];
const collapsedBuckets = new Set(); // status sub-groups the user has collapsed

// Persists an edited plan item locally and pushes the full plan to the
// service worker so it survives panel reloads.
function updatePlanItem(itemId, updater) {
  plan = plan.map((it) => (it.itemId === itemId ? updater(it) : it));
  send({ cmd: 'updatePlan', items: plan });
  renderPlan();
}

function renderGroupItem(item) {
  const li = document.createElement('li');
  li.className = 'item groupItem';

  const details = document.createElement('details');
  details.open = expandedGroups.has(item.itemId);
  details.addEventListener('toggle', () => {
    if (details.open) expandedGroups.add(item.itemId); else expandedGroups.delete(item.itemId);
  });

  const summaryEl = document.createElement('summary');

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'itemCheck';
  check.checked = selection.has(item.itemId);
  check.setAttribute('aria-label', `Select group ${item.data.groupName}`);
  check.addEventListener('click', (e) => e.stopPropagation()); // don't toggle the <details>
  check.addEventListener('change', () => { selection = toggleSelection(selection, item.itemId); });

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'groupName';
  nameInput.value = item.data.groupName;
  nameInput.setAttribute('aria-label', `Rename group ${item.data.groupName}`);
  nameInput.addEventListener('click', (e) => e.stopPropagation());
  nameInput.addEventListener('change', () => {
    updatePlanItem(item.itemId, (it) => renameGroup(it, nameInput.value));
  });

  const colorSelect = document.createElement('select');
  colorSelect.className = 'groupColor';
  colorSelect.setAttribute('aria-label', `Color for group ${item.data.groupName}`);
  for (const c of GROUP_COLORS) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === item.data.color) opt.selected = true;
    colorSelect.appendChild(opt);
  }
  colorSelect.addEventListener('click', (e) => e.stopPropagation());
  colorSelect.addEventListener('change', () => {
    updatePlanItem(item.itemId, (it) => recolorGroup(it, colorSelect.value));
  });

  const countSpan = document.createElement('span');
  countSpan.className = 'itemReason';
  countSpan.textContent = ` (${item.data.tabIds.length} tabs)`;

  summaryEl.append(check, nameInput, colorSelect, countSpan);
  details.appendChild(summaryEl);

  const memberList = document.createElement('ul');
  memberList.className = 'memberList';
  for (const m of item.data.members) {
    const mLi = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'focusable';
    label.setAttribute('role', 'link');
    label.setAttribute('tabindex', '0');
    label.textContent = m.title || m.url;
    label.title = 'Go to this tab';
    label.setAttribute('aria-label', `Go to tab: ${m.title || m.url}`);
    label.addEventListener('click', () => focusTab(m.tabId));
    label.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusTab(m.tabId); } });
    // "Move to" another proposed group.
    const otherGroups = plan.filter((i) => i.action === 'groupTabs' && i.itemId !== item.itemId);
    const moveSel = document.createElement('select');
    moveSel.setAttribute('aria-label', `Move "${m.title || m.url}" to another group`);
    const placeholder = document.createElement('option');
    placeholder.value = ''; placeholder.textContent = 'Move to…';
    moveSel.appendChild(placeholder);
    for (const g of otherGroups) {
      const opt = document.createElement('option');
      opt.value = g.itemId; opt.textContent = g.data.groupName;
      moveSel.appendChild(opt);
    }
    moveSel.addEventListener('change', () => {
      if (!moveSel.value) return;
      expandedGroups.add(item.itemId);
      expandedGroups.add(moveSel.value);
      plan = moveMember(plan, item.itemId, moveSel.value, m.tabId);
      send({ cmd: 'updatePlan', items: plan });
      renderPlan();
    });
    if (!otherGroups.length) moveSel.style.display = 'none';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      expandedGroups.add(item.itemId);
      updatePlanItem(item.itemId, (it) => excludeMember(it, m.tabId));
    });
    mLi.append(label, moveSel, removeBtn);
    memberList.appendChild(mLi);
  }
  details.appendChild(memberList);

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'applySection';
  applyBtn.textContent = 'Apply this group';
  applyBtn.addEventListener('click', () => applyItems([item.itemId]));
  details.appendChild(applyBtn);

  const ignoreBtn = document.createElement('button');
  ignoreBtn.type = 'button';
  ignoreBtn.className = 'itemIgnore';
  ignoreBtn.title = 'Never suggest this again';
  ignoreBtn.textContent = 'Never suggest this';
  ignoreBtn.addEventListener('click', () => ignoreItem(item));
  details.appendChild(ignoreBtn);

  li.appendChild(details);
  return li;
}

export function renderPlan(animate = false) {
  const container = $('plan');
  container.textContent = '';
  let enterIdx = 0; // staggers the entrance animation for fresh results only
  const shown = filterPlan(plan, planFilter);
  const counts = summarize(shown);
  const summary = $('summary');
  summary.hidden = plan.length === 0;
  const filterNote = planFilter && shown.length !== plan.length ? `  (filtered from ${plan.length})` : '';
  summary.textContent = Object.entries(counts).map(([a, n]) => `${actionLabel(a)}: ${n}`).join('  •  ') + filterNote;
  $('planTools').hidden = plan.length === 0;
  $('planActions').hidden = plan.length === 0; // contextual: apply/clear only when there's a plan

  const emptyEl = $('planEmptyState');
  if (emptyEl) {
    const onboarding = $('onboarding');
    const isOnboarding = onboarding && !onboarding.hidden;
    emptyEl.hidden = plan.length > 0 || isOnboarding;
  }
  const approveSelBtn = $('approveSelected');
  if (approveSelBtn) {
    approveSelBtn.textContent = selection.size
      ? `Apply selected (${selection.size})`
      : 'Apply selected';
  }

  const groups = groupByAction(shown);
  const tpl = $('itemTemplate');
  const stagger = (el) => {
    if (!animate) return;
    el.classList.add('enter');
    el.style.setProperty('--i', Math.min(enterIdx++, 10));
  };
  const appendItem = (ul, item) => {
    if (item.action === 'groupTabs') {
      const gEl = renderGroupItem(item);
      stagger(gEl);
      ul.appendChild(gEl);
      return;
    }
    const node = buildItemNode(item, tpl);
    stagger(node.querySelector('.item'));
    ul.appendChild(node);
  };
  for (const [action, items] of Object.entries(groups)) {
    const section = document.createElement('div');
    section.className = 'group';
    const h = document.createElement('h2');
    h.textContent = `${actionLabel(action)} (${items.length})`;
    section.appendChild(h);
    // Bookmark cleanup can optionally split into per-status sub-groups.
    if (action === 'deleteBookmark' && groupBookmarksByStatus) {
      const buckets = groupByStatus(items);
      for (const key of BUCKET_ORDER) {
        const bItems = buckets[key];
        if (!bItems || !bItems.length) continue;
        // <details> so each status sub-group collapses independently and the
        // Expand/Collapse-groups buttons can drive it.
        const sub = document.createElement('details');
        sub.className = 'subgroup';
        sub.open = !collapsedBuckets.has(key);
        sub.addEventListener('toggle', () => { if (sub.open) collapsedBuckets.delete(key); else collapsedBuckets.add(key); });
        const sm = document.createElement('summary');
        sm.textContent = `${statusLabel(key)} (${bItems.length})`;
        sub.appendChild(sm);
        const subUl = document.createElement('ul');
        for (const item of bItems) appendItem(subUl, item);
        sub.appendChild(subUl);
        section.appendChild(sub);
      }
    } else {
      const ul = document.createElement('ul');
      for (const item of items) appendItem(ul, item);
      section.appendChild(ul);
    }
    container.appendChild(section);
  }
  updateResultCard(plan, planOrigin); // keep the main-panel result card in sync with the plan
}

// Builds one suggestion row (checkbox, title/reason/url, ignore, optional
// go-to-tab) from the shared <template>. Returns the cloned fragment.
function buildItemNode(item, tpl) {
  const node = tpl.content.cloneNode(true);
  const check = node.querySelector('.itemCheck');
  check.checked = selection.has(item.itemId);
  check.addEventListener('change', () => { selection = toggleSelection(selection, item.itemId); });
  node.querySelector('.itemAction').textContent = item.data.groupName || item.data.title || item.data.url || '';
  const reasonEl = node.querySelector('.itemReason');
  if (item.action === 'moveBookmark' && item.data.toLabel) {
    // Show the destination as a chip ("Move to [Folder]"), full path on hover.
    reasonEl.textContent = '';
    const lead = document.createElement('span');
    lead.className = 'moveLead';
    lead.textContent = 'Move to ';
    const chip = document.createElement('span');
    chip.className = item.data.toNew ? 'destChip destChip--new' : 'destChip';
    chip.textContent = item.data.toLabel;
    chip.title = (item.data.toNew ? 'New folder: ' : '') + (item.data.toPath || item.data.toLabel);
    reasonEl.append(lead, chip);
  } else {
    reasonEl.textContent = item.reason || '';
  }
  node.querySelector('.itemUrl').textContent = item.data.url || (item.data.tabIds ? `${item.data.tabIds.length} tabs` : '');
  node.querySelector('.itemIgnore').addEventListener('click', () => ignoreItem(item));
  // Click-to-focus: only meaningful when the suggestion targets a live tab.
  if (item.data.tabId != null) {
    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'itemFocus';
    goBtn.textContent = 'Go to tab';
    goBtn.setAttribute('aria-label', `Go to tab: ${item.data.title || item.data.url || ''}`);
    goBtn.addEventListener('click', () => focusTab(item.data.tabId));
    node.querySelector('.item').appendChild(goBtn);
  }
  return node;
}

// Marks an item as "never suggest again": persists the key server-side and
// drops it from the currently displayed plan immediately.
async function ignoreItem(item) {
  const key = ignoreKey(item);
  await send({ cmd: 'ignore', keys: [key], items: [item] });
  plan = plan.filter((it) => it.itemId !== item.itemId);
  renderPlan();
  setStatus('Won’t suggest that again.');
}

async function startScan(features, { groupMode, regroupAll } = {}) {
  ensureScanPort();
  $('cancelRun').hidden = false;
  startScanClock('Analyzing… (running your local AI CLI)');
  const windowId = await currentScopeWindowId();
  const res = await send({ cmd: 'run', features, windowId, groupMode, regroupAll });
  stopScanClock();
  $('cancelRun').hidden = true;
  if (!res || !res.ok) { setStatus(`Error: ${(res && res.error) || 'the background worker did not respond — try again'}`); return; }
  ({ items: plan, origin: planOrigin } = await fetchPlan());
  selection = new Set();
  renderPlan(true);
  // Surface actionable warnings (e.g. an out-of-date helper) instead of the
  // misleading "looks tidy" when a phase couldn't run.
  if (res.warnings && res.warnings.length) { flashStatus(res.warnings[0]); return; }
  // The "N suggestions." count now lives in the result card; clear the status
  // line on success so it isn't duplicated above the card.
  setStatus(plan.length ? '' : 'Nothing to do — your browser looks tidy.');
}

// Toggles the two grouping-choice buttons under the Analyze button.
function showSortChoices(shown) {
  const el = $('sortChoices');
  if (el) el.hidden = !shown;
}

// "Analyze": count the loose and duplicate tabs in the chosen scope WITHOUT
// calling the model, show the counts, and reveal the two grouping choices.
async function analyze() {
  showSortChoices(false);
  const counts = $('analyzeCounts');
  if (counts) counts.hidden = true;
  // A fresh Analyze clears any earlier result so the old card and detailed list
  // can't linger while the new counts are gathered.
  plan = [];
  planOrigin = null;
  selection = new Set();
  hideResults();
  const toast = $('undoToast');
  if (toast) toast.hidden = true; // the last Apply's Undo belongs to the old result
  setStatus('Analyzing…');
  const selected = isSelectedMode();
  const windowId = selected ? null : await currentScopeWindowId();
  const res = await send({ cmd: 'analyze', windowId, selected });
  if (!res || !res.ok) { setStatus(`Error: ${(res && res.error) || 'the background worker did not respond — try again'}`); return; }
  setStatus('');
  if (counts) {
    const loose = res.loose || 0;
    const dupes = res.duplicates || 0;
    counts.textContent = `${loose} loose tab${loose === 1 ? '' : 's'}, ${dupes} duplicate${dupes === 1 ? '' : 's'}`;
    counts.hidden = false;
  }
  showSortChoices(true);
}

// A grouping choice ("Put into my groups" / "Suggest new groups"): run the
// grouping over the scope's loose tabs with the given mode. In "Selected tabs"
// scope the existing sortSelected path handles the highlighted tabs instead.
async function groupLoose(groupMode) {
  if (isSelectedMode()) { await sortSelectedTabs(); return; }
  await startScan({ groupTabs: true, staleTabs: false, importantBookmarks: false, cleanBookmarks: false, organizeBookmarks: false, dupeTabs: false }, { groupMode });
}

// "Re-sort all groups": regroup every web tab in scope (grouped or not) in mode
// 'mine', for this run only — it replaces the old regroupExisting setting.
async function resortAll() {
  await startScan({ groupTabs: true, staleTabs: false, importantBookmarks: false, cleanBookmarks: false, organizeBookmarks: false, dupeTabs: false }, { groupMode: 'mine', regroupAll: true });
}

// "Close duplicates": run only the duplicate-tab finder (no model) over scope.
async function closeDuplicates() {
  setStatus('Finding duplicate tabs…');
  const selected = isSelectedMode();
  const windowId = selected ? null : await currentScopeWindowId();
  const res = await send({ cmd: 'closeDuplicates', windowId, selected });
  if (!res || !res.ok) { setStatus(`Error: ${(res && res.error) || 'the background worker did not respond — try again'}`); return; }
  plan = res.items || [];
  selection = new Set();
  renderPlan(true);
  setStatus(plan.length ? '' : 'No duplicate tabs found.');
}

// "Load agent suggestions": fetch proposals.json via the host, mapped to the
// current open tabs, and show them as a normal plan. The file's note (and who
// it's from) is surfaced in the status line when present.
async function loadAgentSuggestions() {
  setStatus('Loading agent suggestions…');
  const windowId = await currentScopeWindowId();
  const res = await send({ cmd: 'proposals', windowId });
  if (!res || !res.ok) { setStatus(`Error: ${(res && res.error) || 'the background worker did not respond — try again'}`); return; }
  plan = res.items || [];
  selection = new Set();
  renderPlan(true);
  const note = res.note ? (res.from ? `${res.from}: ${res.note}` : res.note) : '';
  if (!plan.length) { setStatus(note || 'No agent suggestions matched your open tabs.'); return; }
  // The count shows in the result card; the status line carries only the note.
  setStatus(note);
}

// "Sort selected tabs": regroup just the tabs highlighted in the tab strip. The
// background builds a plan over those tabs only (grouping phase), then we show
// it as a normal plan so review/apply/undo are unchanged.
async function sortSelectedTabs() {
  setStatus('Sorting selected tabs… (running your local AI CLI)');
  const res = await send({ cmd: 'sortSelected' });
  if (!res || !res.ok) { setStatus(`Error: ${(res && res.error) || 'the background worker did not respond — try again'}`); return; }
  if (res.message) { setStatus(res.message); return; }
  plan = res.items || [];
  selection = new Set();
  renderPlan(true);
  setStatus(plan.length ? '' : 'Nothing to sort.');
}

// Confirms a large destructive batch via a modal before applying. Resolves true
// to proceed, false to cancel (Cancel button or Esc).
function confirmBulk(items) {
  return confirmAction({
    title: 'Apply changes?',
    message: `Apply ${items.length} changes — ${destructiveCount(items)} will close, suspend, or delete tabs/bookmarks. This can be undone, but continue?`,
    confirmLabel: 'Apply',
  });
}

// Disabled for the duration of an in-flight apply so a fast double-click can't
// fire it twice and gives the same busy feedback the scan button already has.
function setPlanActionsBusy(busy) {
  for (const id of ['approveSelected', 'approveAll', 'exportMarkdown', 'clearPlan']) {
    const el = $(id);
    if (el) el.disabled = busy;
  }
}

async function applyItems(itemIds) {
  if (!itemIds.length) { setStatus('Nothing selected.'); return; }
  const chosen = selectedItems(new Set(itemIds), plan);
  if (needsBulkConfirm(chosen)) {
    const ok = await confirmBulk(chosen);
    if (!ok) { setStatus('Cancelled — nothing applied.'); return; }
  }
  setStatus(`Applying ${itemIds.length}…`);
  setPlanActionsBusy(true);
  try {
    const res = await send({ cmd: 'apply', itemIds, fileIntoParked: fileIntoParkedChecked() });
    if (!res || !res.ok) { setStatus(`Error: ${(res && res.error) || 'the background worker did not respond — try again'}`); return; }
    ({ items: plan, origin: planOrigin } = await fetchPlan());
    selection = new Set();
    renderPlan();
    setStatus(`Applied ${res.applied.length}.${failedText(res)}`);
    await showUndoToast();
  } finally {
    setPlanActionsBusy(false);
  }
}

// " 1 failed: Group "Reading" (3 tabs): No tab with id: 12." for the status
// line, so a failure says what and why instead of only a count (Jeff,
// 2026-10-11: "Applied 12. 1 failed."). More than one names the first.
function failedText(res) {
  const n = (res.failed || []).length;
  if (!n) return '';
  const f = (res.failures || [])[0];
  if (!f) return ` ${n} failed.`;
  const more = n > 1 ? ` (and ${n - 1} more)` : '';
  const why = String(f.error).replace(/\.+$/, ''); // the sentence ends with our own period
  return ` ${n} failed: ${f.reason}: ${why}${more}.`;
}

// Per-action run buttons: run just one feature without touching settings.
const ALL_FEATURES = ['groupTabs', 'staleTabs', 'importantBookmarks', 'cleanBookmarks', 'organizeBookmarks'];

// Wire every control that reads or mutates the plan, load the panel-local
// group-by-status pref, then paint the stored plan. Called once from the bootstrap.
export async function initPlanView() {
  $('run').addEventListener('click', () => analyze());
  $('putMine').addEventListener('click', () => groupLoose('mine'));
  $('suggestGroups').addEventListener('click', () => groupLoose('suggest'));
  $('resortAll').addEventListener('click', () => resortAll());
  $('closeDuplicates').addEventListener('click', () => closeDuplicates());
  $('cancelRun').addEventListener('click', () => send({ cmd: 'cancel' }));
  $('updateIndex').addEventListener('click', async () => {
    setStatus('Updating index…');
    const res = await send({ cmd: 'syncIndex' });
    if (!res || !res.ok) { setStatus(`Error: ${(res && res.error) || 'the background worker did not respond — try again'}`); return; }
    const n = res.groups;
    setStatus(typeof n === 'number' ? `Index updated: ${n} group${n === 1 ? '' : 's'}` : 'Index updated.');
  });
  $('loadProposals').addEventListener('click', loadAgentSuggestions);
  $('sortSelected').addEventListener('click', sortSelectedTabs);
  for (const btn of $('runOne').querySelectorAll('button[data-feature]')) {
    btn.addEventListener('click', () => {
      const only = btn.dataset.feature;
      const features = Object.fromEntries(ALL_FEATURES.map((f) => [f, f === only]));
      startScan(features);
    });
  }

  $('clearPlan').addEventListener('click', async () => {
    plan = [];
    selection = new Set();
    planFilter = '';
    $('planFilter').value = '';
    await send({ cmd: 'updatePlan', items: [] }); // also clear the stored plan so it doesn't reappear on reload
    renderPlan();
    setStatus('Cleared.');
  });

  // Plan toolbar: filter, bulk-select, expand/collapse.
  $('planFilter').addEventListener('input', (e) => { planFilter = e.target.value; renderPlan(); });
  $('selectAll').addEventListener('click', () => { selection = new Set(allItemIds(filterPlan(plan, planFilter))); renderPlan(); });
  $('selectNone').addEventListener('click', () => { selection = new Set(); renderPlan(); });
  $('expandAll').addEventListener('click', () => {
    for (const it of plan) if (it.action === 'groupTabs') expandedGroups.add(it.itemId);
    collapsedBuckets.clear(); // status sub-groups all open
    renderPlan();
  });
  $('collapseAll').addEventListener('click', () => {
    expandedGroups.clear();
    for (const key of BUCKET_ORDER) collapsedBuckets.add(key); // status sub-groups all closed
    renderPlan();
  });

  // "Group bookmarks by status" toggle — panel-local pref persisted in storage.local.
  $('groupByStatus').addEventListener('change', (e) => {
    groupBookmarksByStatus = e.target.checked;
    chrome.storage.local.set({ groupBookmarksByStatus });
    renderPlan();
  });

  $('commandForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('commandInput');
    const instruction = input.value.trim();
    if (!instruction) return;
    setStatus('Running your command… (local Claude CLI)');
    const windowId = await currentScopeWindowId();
    const res = await send({ cmd: 'command', instruction, windowId });
    if (!res || !res.ok) { setStatus(`Error: ${(res && res.error) || 'the background worker did not respond — try again'}`); return; }
    plan = res.items || [];
    selection = new Set();
    renderPlan(true);
    setStatus(plan.length ? '' : 'No matching tabs found.');
    input.value = '';
  });

  $('approveSelected').addEventListener('click', () => applyItems([...selection]));
  $('approveAll').addEventListener('click', () => applyItems(plan.map((i) => i.itemId)));

  $('exportMarkdown').addEventListener('click', async () => {
    const md = toMarkdown(plan);
    try {
      await navigator.clipboard.writeText(md);
      setStatus('Markdown copied to clipboard.');
    } catch {
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'browser-organizer-export.md';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Markdown downloaded.');
    }
  });

  // Load the persisted group-by-status pref, then paint the stored plan.
  const { groupBookmarksByStatus: pref } = await chrome.storage.local.get('groupBookmarksByStatus');
  groupBookmarksByStatus = !!pref;
  $('groupByStatus').checked = groupBookmarksByStatus;
  ({ items: plan, origin: planOrigin } = await fetchPlan());
  renderPlan(true);
}
