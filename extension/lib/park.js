// Park an open tab group into the on-disk index and reopen it later. Parking
// hands the group's title, color and http(s) tabs to the native host (which
// records it as 'parked') and only closes the group's tabs once the host
// confirms, so a host failure never loses the tabs. After a successful save the
// whole group is closed — including non-web tabs like new-tab pages, which
// aren't saved — so the group really goes away. Reopening reads the index,
// recreates the tabs in a window, regroups them under the saved title/color,
// then syncs the index so the group shows as open again.
import { isHttpUrl } from './url-utils.js';
import { TAB_GROUP_COLORS } from './colors.js';
import { syncIndex } from './index-sync.js';

const COLORS = new Set(TAB_GROUP_COLORS);

// Collect a group's title, color and its http(s) tabs (in tab order), send a
// 'park' message, and only after the host answers ok close every tab in the
// group — web or not. Non-web tabs (like new-tab pages) aren't saved, just
// closed, so the group really goes away. If the host fails nothing is closed,
// so the group is never lost. Returns the host reply, or throws if the host
// rejects.
//
// lastUsed is the most recent lastActive (from chrome.storage.local tabActivity)
// among the group's tabs, so a parked group can be ordered by when it was last
// touched; it falls back to now when nothing is recorded.
export async function parkGroup({ chromeApi = chrome, nativeClient, groupId } = {}) {
  let name = '';
  let color;
  try {
    const g = await chromeApi.tabGroups.get(groupId);
    name = g.title || '';
    color = g.color;
  } catch { /* group gone — park with empty name */ }
  const groupTabs = await chromeApi.tabs.query({ groupId });
  const tabs = [];
  const closeIds = [];
  for (const t of groupTabs) {
    if (t.id != null) closeIds.push(t.id);
    if (!isHttpUrl(t.url)) continue;
    tabs.push({ title: t.title || '', url: t.url });
  }
  const lastUsed = await mostRecentActive(chromeApi, groupTabs);
  const res = await nativeClient.request({ type: 'park', payload: { group: { name, color, tabs, lastUsed } } });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Park failed');
  if (closeIds.length) await chromeApi.tabs.remove(closeIds);
  return res;
}

// The most recent lastActive (as an ISO string) among the group's tabs, read
// from chrome.storage.local 'tabActivity' ({ [tabId]: { lastActive } }, ms).
// Falls back to now when the store is empty or none of the tabs are tracked.
async function mostRecentActive(chromeApi, groupTabs) {
  let activity = {};
  try {
    const got = await chromeApi.storage.local.get('tabActivity');
    activity = (got && got.tabActivity) || {};
  } catch { /* no store — fall back to now */ }
  let latest = 0;
  for (const t of groupTabs) {
    const entry = t && t.id != null ? activity[t.id] : undefined;
    const when = entry && typeof entry.lastActive === 'number' ? entry.lastActive : 0;
    if (when > latest) latest = when;
  }
  return new Date(latest || Date.now()).toISOString();
}

// Read the index, find the parked group by name (trimmed, case-insensitive),
// open its URLs as new background tabs in `windowId` in order, group them, and
// restore the saved title and color. Then sync the index so it shows as open.
// Returns { ok: true, opened } on success. An unknown name returns
// { ok: false, error } without throwing.
// Read the index, find the parked group by name (trimmed, case-insensitive),
// open its URLs as new background tabs in `windowId` in order, group them, and
// restore the saved title and color. Then sync the index so it shows as open.
// Returns { ok: true, opened } on success. An unknown name returns
// { ok: false, error } without throwing.
//
// When `groupId` names an existing open group, the opened tabs join that group
// instead of forming a new one — this is the board's "Add them back" path,
// folding a same-named parked record's tabs into the group that's already open.
export async function openParked({ chromeApi = chrome, nativeClient, name, windowId, groupId } = {}) {
  const index = await nativeClient.request({ type: 'index-read' });
  const groups = (index && Array.isArray(index.groups)) ? index.groups : [];
  const wanted = String(name || '').trim().toLowerCase();
  const group = groups.find((g) => String(g.name || '').trim().toLowerCase() === wanted);
  if (!group) return { ok: false, error: `No parked group named ${name}` };
  // An open group's record holds its live tabs in `tabs` and its saved half in
  // `parkedTabs`; "Add back" opens the saved half. A parked record opens whole.
  const tabs = group.status === 'open'
    ? (Array.isArray(group.parkedTabs) ? group.parkedTabs : [])
    : (Array.isArray(group.tabs) ? group.tabs : []);
  const tabIds = [];
  for (const t of tabs) {
    const created = await chromeApi.tabs.create({ windowId, url: t.url, active: false });
    if (created && created.id != null) tabIds.push(created.id);
  }
  if (tabIds.length) {
    if (groupId != null) {
      // Fold the tabs into the group that's already open under this name.
      await chromeApi.tabs.group({ groupId, tabIds });
    } else {
      const newGroupId = await chromeApi.tabs.group({ tabIds });
      await chromeApi.tabGroups.update(newGroupId, {
        title: group.name,
        color: COLORS.has(group.color) ? group.color : 'grey',
      });
    }
  }
  await syncIndex({ chromeApi, nativeClient });
  return { ok: true, opened: tabIds.length };
}
