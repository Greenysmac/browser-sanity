// The tidy-parked proposal card: when "Re-analyze parked groups…" produces a proposal
// (merges + splits over the parked groups), this fills the result card with one
// line per proposal. Each merge shows its reason and an unchecked checkbox; each
// split shows its proposed sub-group names, its reason, and an unchecked
// checkbox (the user ticks what they want). "Apply checked" sends 'mergeParked'
// for the checked merges, then splits each checked group into its proposed
// sub-group names (splitGroup → applyParkedSplit), then re-renders the board.
// Nothing changes until the user acts.
//
// All DOM is built with createElement/textContent — never innerHTML with data —
// so group names and reasons can't inject markup. The module takes its elements
// and the `send`/`setStatus`/`onDone` callbacks as arguments so it stays
// unit-testable with a bare fake document (no chrome, no jsdom).
import { originLine } from './viewmodel.js';
import { applyParkedSplit } from './split-view.js';

// The one-line summary shown on the card.
export function tidySummaryText(proposal) {
  const merges = (proposal && Array.isArray(proposal.merge)) ? proposal.merge.length : 0;
  const splits = (proposal && Array.isArray(proposal.split)) ? proposal.split.length : 0;
  if (!merges && !splits) return 'Parked groups look fine. Nothing to merge or split.';
  const parts = [];
  if (merges) parts.push(`${merges} ${merges === 1 ? 'merge' : 'merges'}`);
  if (splits) parts.push(`${splits} ${splits === 1 ? 'split' : 'splits'}`);
  return `Re-analyze parked groups: ${parts.join(', ')}`;
}

// One merge line: an unchecked checkbox, "Merge <from…> into <into>" and its
// reason in muted text. The user ticks the merges they want. The checkbox
// element is returned on the <li> as `.checkbox` so Apply can read which merges
// are checked.
function mergeLine(m) {
  const li = document.createElement('li');
  li.className = 'tidyMerge';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = false;
  const label = document.createElement('span');
  label.className = 'tidyMergeLabel';
  label.textContent = `Merge ${(m.from || []).join(', ')} into ${m.into}`;
  li.append(checkbox, label);
  if (m.reason) {
    const reason = document.createElement('span');
    reason.className = 'tidyReason';
    reason.textContent = m.reason;
    li.appendChild(reason);
  }
  li.checkbox = checkbox;
  li.merge = m;
  return li;
}

// One split line: an unchecked checkbox, "Split <name> into A, B, C" and its
// reason in muted text. The user ticks the splits they want. The checkbox
// element is returned on the <li> as `.checkbox` so Apply can read which splits
// are checked; the split itself is kept on `.split`.
function splitLine(s) {
  const li = document.createElement('li');
  li.className = 'tidySplit';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = false;
  const label = document.createElement('span');
  label.className = 'tidySplitLabel';
  label.textContent = `Split ${s.name} into ${(s.into || []).join(', ')}`;
  li.append(checkbox, label);
  if (s.reason) {
    const reason = document.createElement('span');
    reason.className = 'tidyReason';
    reason.textContent = s.reason;
    li.appendChild(reason);
  }
  li.checkbox = checkbox;
  li.split = s;
  return li;
}

// Insert (or replace) the muted "From <label>, <time>" line after the card's
// summary. Built with createElement/textContent only. A card can carry at most
// one, tracked by the .resultOrigin class so re-renders don't stack them.
function renderOrigin(card, summary, origin) {
  const existing = Array.from(card.children || []).find((c) => c && c.className === 'resultOrigin');
  if (existing && existing.remove) existing.remove();
  const text = originLine(origin);
  if (!text) return;
  const p = document.createElement('p');
  p.className = 'resultOrigin';
  p.textContent = text;
  if (summary && summary.insertAdjacentElement) summary.insertAdjacentElement('afterend', p);
  else card.appendChild(p);
}

// Fill the tidy card from a proposal and wire the merge and split checkboxes and
// "Apply checked". `els` carries the card and its parts; `send`/`setStatus`
// reach the service worker and status line; `onDone` is called after Apply so
// the host can refresh the board. `origin` is the { label, at } the card shows
// as a muted "From <label>, <time>" line; it defaults to "Re-analyze parked
// groups" stamped now (the moment the proposal came back). Returns nothing — it
// mutates the given elements.
export function showTidyProposal({ proposal, els, send, setStatus = () => {}, onDone = () => {}, origin = null }) {
  const { card, summary, list, apply, dismiss } = els;
  const from = origin || { label: 'Re-analyze parked groups', at: Date.now() };
  if (!proposal || !card) return;
  const merges = Array.isArray(proposal.merge) ? proposal.merge : [];
  const splits = Array.isArray(proposal.split) ? proposal.split : [];
  if (summary) summary.textContent = tidySummaryText(proposal);
  renderOrigin(card, summary, from);

  const mergeLines = [];
  const splitLines = [];
  if (list) {
    list.textContent = '';
    for (const m of merges) {
      const li = mergeLine(m);
      mergeLines.push(li);
      list.appendChild(li);
    }
    for (const s of splits) {
      const li = splitLine(s);
      splitLines.push(li);
      list.appendChild(li);
    }
  }

  if (apply) {
    apply.textContent = 'Apply checked';
    apply.disabled = merges.length === 0 && splits.length === 0;
    apply.onclick = async () => {
      const checkedMerges = mergeLines.filter((li) => li.checkbox && li.checkbox.checked).map((li) => li.merge);
      const checkedSplits = splitLines.filter((li) => li.checkbox && li.checkbox.checked).map((li) => li.split);
      if (!checkedMerges.length && !checkedSplits.length) { setStatus('Nothing checked.'); return; }
      // Merges first, as before.
      for (const m of checkedMerges) {
        await send({ cmd: 'mergeParked', into: m.into, from: m.from });
      }
      // Then each checked split in turn: ask the service worker to split the
      // parked group into the proposed sub-group names, then apply the returned
      // parked proposal directly with the split card's own calls — no card.
      let splitOk = 0;
      const failed = [];
      for (const s of checkedSplits) {
        setStatus(`Splitting ${s.name}…`);
        const res = await send({ cmd: 'splitGroup', name: s.name, names: s.into });
        if (res && res.ok && res.proposal) {
          await applyParkedSplit(res.proposal, send);
          // splitGroup also stores the proposal for the new-tab hand-off; it's
          // applied now, so drop it before it can show up as a split card.
          await send({ cmd: 'clearSplitProposal' });
          splitOk += 1;
        } else {
          failed.push(s.name);
        }
      }
      card.hidden = true;
      setStatus(`Merged ${checkedMerges.length}, split ${splitOk}.${failed.length ? ` Could not split ${failed.join(', ')}.` : ''}`);
      await onDone();
    };
  }

  if (dismiss) {
    // Dismiss just hides the card; the proposal was never persisted.
    dismiss.onclick = () => { card.hidden = true; };
  }

  card.hidden = false;
}
