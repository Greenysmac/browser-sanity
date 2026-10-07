// Builds the on-disk index payload from the live tabs and sends it to the native
// host (which merges and writes index.json/index.md). The host remembers groups
// the user has since closed, so the extension just reports the current state.
import { isHttpUrl } from './url-utils.js';

// Snapshot every open tab in window + tab order, bucketed into named groups and
// a flat ungrouped list. Each group's title and color are looked up once (via
// tabGroups.get) and reused for all its tabs. Non-http(s) tabs are skipped.
export async function buildIndexPayload(chromeApi = chrome) {
  const tabs = await chromeApi.tabs.query({});
  const groupInfo = new Map(); // groupId -> { name, color, windowId }
  async function infoFor(groupId, windowId) {
    if (groupInfo.has(groupId)) return groupInfo.get(groupId);
    let info = { name: '', color: undefined, windowId };
    try {
      const g = await chromeApi.tabGroups.get(groupId);
      info = { name: g.title || '', color: g.color, windowId };
    } catch { /* group gone — fall back to empty name */ }
    groupInfo.set(groupId, info);
    return info;
  }

  const groups = []; // in first-seen order, which is window + tab order
  const byGroupId = new Map(); // groupId -> group object in `groups`
  const ungrouped = [];
  for (const t of tabs) {
    // A freshly reopened tab has only pendingUrl (no url yet); treat that as
    // its url so the group it belongs to is indexed as open, not left parked.
    const url = t.url || t.pendingUrl;
    if (!isHttpUrl(url)) continue;
    const entry = { title: t.title || '', url };
    const groupId = t.groupId ?? -1;
    if (groupId === -1 || !chromeApi.tabGroups) { ungrouped.push(entry); continue; }
    let group = byGroupId.get(groupId);
    if (!group) {
      const info = await infoFor(groupId, t.windowId);
      group = { name: info.name, color: info.color, windowId: info.windowId, tabs: [] };
      byGroupId.set(groupId, group);
      groups.push(group);
    }
    group.tabs.push(entry);
  }
  return { groups, ungrouped };
}

// Build the payload and hand it to the native host. Never throws: on any error
// it logs and returns { ok: false } so callers (apply flow, the button) can keep
// going. On success returns the host's { ok, groups } reply. When `dissolved` is
// given (group titles that existed before an apply and are gone after), it rides
// along so the host drops them from the index instead of parking them.
export async function syncIndex({ chromeApi = chrome, nativeClient, dissolved } = {}) {
  try {
    const payload = await buildIndexPayload(chromeApi);
    if (Array.isArray(dissolved) && dissolved.length) payload.dissolved = dissolved;
    const res = await nativeClient.request({ type: 'index', payload });
    return res || { ok: false };
  } catch (err) {
    console.error('[organizer] index sync failed:', err);
    return { ok: false };
  }
}

// Collect the titles of the currently open tab groups, deduped. Used around an
// apply to compute which groups a re-sort emptied (existed before, gone after).
export async function openGroupTitles(chromeApi = chrome) {
  try {
    const groups = await chromeApi.tabGroups.query({});
    const titles = new Set();
    for (const g of groups) {
      const title = String((g && g.title) || '').trim();
      if (title) titles.add(title);
    }
    return [...titles];
  } catch {
    return [];
  }
}
