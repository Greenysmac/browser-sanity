// The split proposal card: when the board's "Split this group…" produces a
// proposal, this fills the result card with a one-line summary — "Split <name>
// (<n> tabs) into <m> groups" — plus Apply and Review. Review lists each
// proposed sub-group (name, count, description, tab titles); nothing changes
// until Apply.
//
// Apply reuses the existing paths so Undo keeps working:
//   - open group:   one 'groupTabs' command per sub-group (each becomes a real
//                   Chrome tab group with the parent's color; the parent group
//                   disappears once empty), then 'groupsSplit' so the groups
//                   file gets the new lines/descriptions the user saw in Review.
//   - parked group: 'splitParked' (the host splits the index entry in place),
//                   then 'groupsSplit'.
//
// All DOM is built with createElement/textContent — never innerHTML with data —
// so group names, descriptions and tab titles can't inject markup. The module
// takes its elements and `send`/`setStatus` as arguments so it stays unit-
// testable with a bare fake document (no chrome, no jsdom).

// The one-line summary shown on the card.
export function splitSummaryText(proposal) {
  const name = (proposal && proposal.name) || '';
  const n = (proposal && proposal.tabCount) || 0;
  const m = (proposal && Array.isArray(proposal.subGroups)) ? proposal.subGroups.length : 0;
  return `Split ${name} (${n} ${n === 1 ? 'tab' : 'tabs'}) into ${m} ${m === 1 ? 'group' : 'groups'}`;
}

// The sub-groups shaped for the host's groups-split (name + description only).
function subGroupLines(proposal) {
  return (proposal.subGroups || []).map((g) => ({ name: g.name, description: g.description || '' }));
}

// Apply an open-group split: create each sub-group as its own Chrome tab group
// (carrying the parent's color) via the groupTabs path so Undo can reverse it,
// then record the new lines/descriptions in the groups file. The parent group
// empties out as its tabs move and Chrome drops it on its own.
async function applyOpenSplit(proposal, send) {
  for (const g of proposal.subGroups || []) {
    const tabIds = (g.tabs || []).map((t) => t.tabId).filter((id) => id != null);
    await send({ cmd: 'groupTabs', item: { data: { groupName: g.name, color: proposal.color, tabIds } } });
  }
  await send({ cmd: 'groupsSplit', name: proposal.name, groups: subGroupLines(proposal) });
}

// Apply a parked-group split: the host rewrites the index entry in place, then
// the groups file gets the new lines/descriptions.
async function applyParkedSplit(proposal, send) {
  await send({ cmd: 'splitParked', name: proposal.name, groups: (proposal.subGroups || []).map((g) => ({ name: g.name, description: g.description || '', urls: (g.tabs || []).map((t) => t.url) })) });
  await send({ cmd: 'groupsSplit', name: proposal.name, groups: subGroupLines(proposal) });
}

// Build the Review list: one <li> per sub-group with its name, count,
// description and the tab titles.
function buildReviewList(proposal) {
  const list = document.createElement('ul');
  list.className = 'splitReviewList';
  for (const g of proposal.subGroups || []) {
    const tabs = g.tabs || [];
    const li = document.createElement('li');
    li.className = 'splitSubGroup';
    const head = document.createElement('div');
    head.className = 'splitSubGroupHead';
    const nameEl = document.createElement('span');
    nameEl.className = 'splitSubGroupName';
    nameEl.textContent = g.name || '';
    const countEl = document.createElement('span');
    countEl.className = 'splitSubGroupCount';
    countEl.textContent = ` (${tabs.length} ${tabs.length === 1 ? 'tab' : 'tabs'})`;
    head.append(nameEl, countEl);
    li.appendChild(head);
    if (g.description) {
      const desc = document.createElement('p');
      desc.className = 'splitSubGroupDesc';
      desc.textContent = g.description;
      li.appendChild(desc);
    }
    const titles = document.createElement('ul');
    titles.className = 'splitSubGroupTabs';
    for (const t of tabs) {
      const tLi = document.createElement('li');
      tLi.textContent = (t && t.title) || (t && t.url) || '';
      titles.appendChild(tLi);
    }
    li.appendChild(titles);
    list.appendChild(li);
  }
  return list;
}

// Fill the split card from a proposal and wire Apply/Review. `els` carries the
// card and its parts; `send`/`setStatus` reach the service worker and status
// line; `onDone` is called after a successful Apply so the host can refresh the
// board. Returns nothing — it mutates the given elements.
export function showSplitProposal({ proposal, els, send, setStatus = () => {}, onDone = () => {} }) {
  const { card, summary, review, reviewList, apply, dismiss } = els;
  if (!proposal || !card) return;
  if (summary) summary.textContent = splitSummaryText(proposal);
  if (reviewList) {
    reviewList.textContent = '';
    const built = buildReviewList(proposal);
    // Copy first: in real Chrome children is a live list that shrinks as each
    // <li> moves, so looping it directly would skip every other sub-group.
    for (const li of Array.from(built.children || [])) reviewList.appendChild(li);
    reviewList.hidden = true;
  }
  if (review) {
    review.setAttribute('aria-expanded', 'false');
    review.onclick = () => {
      const shown = review.getAttribute('aria-expanded') === 'true';
      review.setAttribute('aria-expanded', String(!shown));
      if (reviewList) reviewList.hidden = shown;
    };
  }
  if (apply) {
    apply.onclick = async () => {
      setStatus('Applying split…');
      if (proposal.kind === 'parked') await applyParkedSplit(proposal, send);
      else await applyOpenSplit(proposal, send);
      card.hidden = true;
      setStatus(`Split "${proposal.name}" into ${(proposal.subGroups || []).length} groups.`);
      await onDone();
    };
  }
  if (dismiss) {
    // Dismiss hides the card and clears the stored proposal so it can't return.
    dismiss.onclick = () => { card.hidden = true; send({ cmd: 'clearSplitProposal' }); };
  }
  card.hidden = false;
}
