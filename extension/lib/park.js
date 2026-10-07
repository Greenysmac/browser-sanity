// Park an open tab group into the on-disk index and reopen it later. Parking
// hands the group's title, color and http(s) tabs to the native host (which
// records it as 'parked') and only closes those tabs once the host confirms, so
// a host failure never loses the tabs. Reopening reads the index, recreates the
// tabs in a window, regroups them under the saved title/color, then syncs the
// index so the group shows as open again.
import { isHttpUrl } from './url-utils.js';
import { TAB_GROUP_COLORS } from './colors.js';
import { syncIndex } from './index-sync.js';

const COLORS = new Set(TAB_GROUP_COLORS);

// Collect a group's title, color and its http(s) tabs (in tab order), send a
// 'park' message, and only after the host answers ok close those tabs. If the
// host fails nothing is closed, so the group is never lost. Returns the host
// reply, or throws if the host rejects.
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
    if (!isHttpUrl(t.url)) continue;
    tabs.push({ title: t.title || '', url: t.url });
    if (t.id != null) closeIds.push(t.id);
  }
  const res = await nativeClient.request({ type: 'park', payload: { group: { name, color, tabs } } });
  if (!res || !res.ok) throw new Error((res && res.error) || 'Park failed');
  if (closeIds.length) await chromeApi.tabs.remove(closeIds);
  return res;
}

// Read the index, find the parked group by name (trimmed, case-insensitive),
// open its URLs as new background tabs in `windowId` in order, group them, and
// restore the saved title and color. Then sync the index so it shows as open.
// Returns { ok: true, opened } on success. An unknown name returns
// { ok: false, error } without throwing.
export async function openParked({ chromeApi = chrome, nativeClient, name, windowId } = {}) {
  const index = await nativeClient.request({ type: 'index-read' });
  const groups = (index && Array.isArray(index.groups)) ? index.groups : [];
  const wanted = String(name || '').trim().toLowerCase();
  const group = groups.find((g) => String(g.name || '').trim().toLowerCase() === wanted);
  if (!group) return { ok: false, error: `No parked group named ${name}` };
  const tabs = Array.isArray(group.tabs) ? group.tabs : [];
  const tabIds = [];
  for (const t of tabs) {
    const created = await chromeApi.tabs.create({ windowId, url: t.url, active: false });
    if (created && created.id != null) tabIds.push(created.id);
  }
  if (tabIds.length) {
    const newGroupId = await chromeApi.tabs.group({ tabIds });
    await chromeApi.tabGroups.update(newGroupId, {
      title: group.name,
      color: COLORS.has(group.color) ? group.color : 'grey',
    });
  }
  await syncIndex({ chromeApi, nativeClient });
  return { ok: true, opened: tabIds.length };
}
