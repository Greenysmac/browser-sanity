import { isHttpUrl } from './url-utils.js';
import { idleDays } from './activity-tracker.js';

const DAY = 86400000;

export function toSnapshot(tab, activity, now, groupName = '') {
  const entry = activity[tab.id] || {};
  const lastActive = entry.lastActive ?? tab.lastAccessed ?? now;
  const firstSeen = entry.firstSeen ?? lastActive;
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: tab.title || '',
    url: tab.url || '',
    pinned: !!tab.pinned,
    groupId: tab.groupId ?? -1,
    groupName,
    lastActive,
    firstSeen,
    ageDays: Math.floor((now - firstSeen) / DAY),
    idleDays: idleDays({ lastActive }, now), // single source for the idle-days math
  };
}

export async function collectTabs(chromeApi = chrome, activity = {}, now = Date.now(), windowId = null) {
  const tabs = (await chromeApi.tabs.query({}))
    .filter((t) => isHttpUrl(t.url))
    .filter((t) => windowId == null || t.windowId === windowId);
  const names = new Map(); // groupId -> title, looked up once per group
  async function groupName(id) {
    if (id == null || id === -1 || !chromeApi.tabGroups) return '';
    if (names.has(id)) return names.get(id);
    let name = '';
    try { name = (await chromeApi.tabGroups.get(id)).title || ''; } catch { name = ''; }
    names.set(id, name);
    return name;
  }
  const out = [];
  for (const t of tabs) out.push(toSnapshot(t, activity, now, await groupName(t.groupId ?? -1)));
  return out;
}
