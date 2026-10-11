// TASK 1 — tabs go into live groups by default, not parked ones.
// Covers the service-worker's expandParkedMatches, which the Apply handler uses
// to turn parked-name matches into either parkTab items (when the user ticks the
// "file into parked groups" box) or ordinary live groups (the default).
// The worker registers chrome.* listeners at load, so a boot chrome mock stands
// in while the module imports (the clear-plan suite's approach).
import { test } from 'node:test';
import assert from 'node:assert/strict';

function listener() {
  const fns = [];
  return { addListener: (fn) => fns.push(fn), fire: (...args) => fns.map((fn) => fn(...args)), fns };
}

function bootChrome() {
  const noop = listener();
  return {
    runtime: { id: 'self', onConnect: noop, onInstalled: noop, onStartup: noop, onMessage: listener() },
    action: { onClicked: noop }, alarms: { onAlarm: noop, async create() {} },
    commands: { onCommand: noop }, omnibox: { onInputEntered: noop },
    notifications: { onClicked: noop }, storage: { onChanged: noop },
    tabs: { onActivated: noop, onUpdated: noop, onRemoved: noop },
  };
}
globalThis.chrome = bootChrome();
const { expandParkedMatches } = await import('../extension/background/service-worker.js');

// A parkedMatch group with two members, as mapGroupResult now emits.
function parkedGroup() {
  return {
    itemId: 'group-0-0',
    action: 'groupTabs',
    status: 'pending',
    data: {
      groupName: 'Hearing research', color: 'red', windowId: 9, parkedMatch: true,
      tabIds: [1, 2],
      members: [
        { tabId: 1, title: 'H1', url: 'https://h1.com', windowId: 9, index: 0 },
        { tabId: 2, title: 'H2', url: 'https://h2.com', windowId: 9, index: 1 },
      ],
    },
  };
}

// A plain live group, no parkedMatch flag.
function liveGroup() {
  return {
    itemId: 'group-1-0',
    action: 'groupTabs',
    status: 'pending',
    data: { groupName: 'Work', color: 'blue', windowId: 9, tabIds: [3, 4], members: [{ tabId: 3 }, { tabId: 4 }] },
  };
}

test('fileIntoParked true expands a parkedMatch group into one parkTab per member', () => {
  const chosen = [parkedGroup(), liveGroup()];
  const { toApply, expansions } = expandParkedMatches(chosen, true);
  const parks = toApply.filter((i) => i.action === 'parkTab');
  const groups = toApply.filter((i) => i.action === 'groupTabs');
  assert.equal(parks.length, 2, 'one parkTab per member of the parkedMatch group');
  assert.equal(groups.length, 1, 'the plain live group is untouched');
  // Each parkTab is exactly the shape mapGroupResult used to emit.
  assert.deepEqual(parks.map((p) => p.data.tabId), [1, 2]);
  assert.ok(parks.every((p) => p.data.groupName === 'Hearing research'));
  assert.deepEqual(parks[0].data, { tabId: 1, url: 'https://h1.com', title: 'H1', groupName: 'Hearing research', windowId: 9, index: 0 });
  assert.equal(parks[1].data.index, 1);
  assert.ok(parks.every((p) => p.status === 'pending'));
  // The expansion maps the original item id to its part ids.
  assert.deepEqual([...expansions.keys()], ['group-0-0']);
  assert.deepEqual(expansions.get('group-0-0'), ['group-0-0-park-0', 'group-0-0-park-1']);
  assert.equal(groups[0].itemId, 'group-1-0');
});

test('fileIntoParked false leaves the parkedMatch group as an ordinary live group', () => {
  const chosen = [parkedGroup(), liveGroup()];
  const { toApply, expansions } = expandParkedMatches(chosen, false);
  assert.deepEqual(toApply, chosen, 'nothing is expanded by default');
  assert.equal(expansions.size, 0, 'no expansions recorded');
  assert.ok(toApply.every((i) => i.action === 'groupTabs'), 'both items stay groupTabs');
});

test('fileIntoParked true ignores groupTabs items without the parkedMatch flag', () => {
  const { toApply, expansions } = expandParkedMatches([liveGroup()], true);
  assert.deepEqual(toApply, [liveGroup()]);
  assert.equal(expansions.size, 0);
});
