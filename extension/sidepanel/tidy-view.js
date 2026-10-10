// The tidy-parked proposal card: when "Re-analyze parked groups…" produces a proposal
// (merges + splits over the parked groups), this fills the result card with one
// line per proposal. Each merge shows its reason and a checked Apply checkbox;
// each split shows its reason and a "Split…" button that starts the existing
// split flow for that group. "Apply merges" sends 'mergeParked' for the checked
// merges, then re-renders the board. Nothing changes until the user acts.
//
// All DOM is built with createElement/textContent — never innerHTML with data —
// so group names and reasons can't inject markup. The module takes its elements
// and the `send`/`setStatus`/`onSplit`/`onDone` callbacks as arguments so it
// stays unit-testable with a bare fake document (no chrome, no jsdom).

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

// One merge line: a checked checkbox, "Merge <from…> into <into>" and its reason
// in muted text. The checkbox element is returned on the <li> as `.checkbox` so
// Apply can read which merges stay checked.
function mergeLine(m) {
  const li = document.createElement('li');
  li.className = 'tidyMerge';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = true;
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

// One split line: "Split <name>", its reason, and a "Split…" button that starts
// the existing split flow for that parked group via `onSplit(name)`.
function splitLine(s, onSplit) {
  const li = document.createElement('li');
  li.className = 'tidySplit';
  const label = document.createElement('span');
  label.className = 'tidySplitLabel';
  label.textContent = `Split ${s.name}`;
  li.appendChild(label);
  if (s.reason) {
    const reason = document.createElement('span');
    reason.className = 'tidyReason';
    reason.textContent = s.reason;
    li.appendChild(reason);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tidySplitBtn';
  btn.textContent = 'Split…';
  btn.addEventListener('click', () => onSplit(s.name));
  li.appendChild(btn);
  return li;
}

// Fill the tidy card from a proposal and wire the merge checkboxes, the Split…
// buttons, and "Apply merges". `els` carries the card and its parts; `send`/
// `setStatus` reach the service worker and status line; `onSplit(name)` starts
// the split flow for a parked group; `onDone` is called after Apply so the host
// can refresh the board. Returns nothing — it mutates the given elements.
export function showTidyProposal({ proposal, els, send, setStatus = () => {}, onSplit = () => {}, onDone = () => {} }) {
  const { card, summary, list, apply } = els;
  if (!proposal || !card) return;
  const merges = Array.isArray(proposal.merge) ? proposal.merge : [];
  const splits = Array.isArray(proposal.split) ? proposal.split : [];
  if (summary) summary.textContent = tidySummaryText(proposal);

  const mergeLines = [];
  if (list) {
    list.textContent = '';
    for (const m of merges) {
      const li = mergeLine(m);
      mergeLines.push(li);
      list.appendChild(li);
    }
    for (const s of splits) list.appendChild(splitLine(s, onSplit));
  }

  if (apply) {
    apply.disabled = merges.length === 0;
    apply.onclick = async () => {
      const checked = mergeLines.filter((li) => li.checkbox && li.checkbox.checked).map((li) => li.merge);
      if (!checked.length) { setStatus('No merges selected.'); return; }
      setStatus('Applying merges…');
      for (const m of checked) {
        await send({ cmd: 'mergeParked', into: m.into, from: m.from });
      }
      card.hidden = true;
      setStatus(`Merged ${checked.length} ${checked.length === 1 ? 'group set' : 'group sets'}.`);
      await onDone();
    };
  }

  card.hidden = false;
}
