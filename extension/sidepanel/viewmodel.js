import { ACTION_LABELS, STATUS_LABELS } from '../lib/labels.js';
import { summarize, digestText } from '../lib/plan-summary.js';

export { summarize, digestText };

export function actionLabel(action) { return ACTION_LABELS[action] || action; }

// One plain-English line for the main-panel result card, built from the plan:
// counts the tabs moved into groups (groupTabs items' tabIds), the tabs filed
// into parked groups (parkTab items, with a per-group breakdown), and the tabs
// closed (closeTab items), e.g. "Move 9 tabs into 3 groups, file 4 into parked
// groups (Hearing research 3, Someday 1), close 37 duplicates". Omits a clause
// whose count is zero; returns '' for an empty plan.
export function planSummaryLine(plan) {
  const items = plan || [];
  const groups = items.filter((it) => it.action === 'groupTabs');
  const groupTabCount = groups.reduce((n, it) => n + ((it.data && it.data.tabIds && it.data.tabIds.length) || 0), 0);
  const parks = items.filter((it) => it.action === 'parkTab');
  const closeCount = items.filter((it) => it.action === 'closeTab').length;
  const parts = [];
  if (groupTabCount) {
    parts.push(`Move ${groupTabCount} tab${groupTabCount === 1 ? '' : 's'} into ${groups.length} group${groups.length === 1 ? '' : 's'}`);
  }
  if (parks.length) {
    // Count filed tabs per parked group, in first-seen order, for the breakdown.
    const byGroup = new Map();
    for (const it of parks) {
      const name = (it.data && it.data.groupName) || '';
      byGroup.set(name, (byGroup.get(name) || 0) + 1);
    }
    const breakdown = [...byGroup.entries()].map(([name, n]) => `${name} ${n}`).join(', ');
    parts.push(`file ${parks.length} into parked groups (${breakdown})`);
  }
  if (closeCount) {
    parts.push(`close ${closeCount} duplicate${closeCount === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

// Friendly display names for the known Claude model ids used by the two slots;
// any other id (free-text/custom or a backend's own list) passes through as-is.
const MODEL_DISPLAY_NAMES = {
  'claude-opus-5-5': 'Opus 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-haiku-4-5': 'Haiku 4.5',
};

export function modelDisplayName(id) {
  const key = String(id || '').trim();
  return MODEL_DISPLAY_NAMES[key] || key;
}

// The muted "models in use" line for the Sort card. Empty slots fall back to
// "endpoint default", and known Claude ids show their friendly name, e.g.
// "Big sorts: Sonnet 5.5 · Quick jobs: endpoint default".
export function modelsInUseLine(bigModel, quickModel) {
  const name = (m) => (m && String(m).trim() ? modelDisplayName(m) : 'endpoint default');
  return `Big sorts: ${name(bigModel)} · Quick jobs: ${name(quickModel)}`;
}

// The muted "what made this, and when" line a suggestion card shows under its
// summary, e.g. "From Analyze: Put into my groups, 9:40 AM". `origin` is the
// { label, at } an action stamps on its plan/proposal. Returns '' when there's
// no origin (or no label), so a card with no origin shows nothing.
export function originLine(origin) {
  if (!origin || !origin.label) return '';
  const at = origin.at;
  const time = at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  return time ? `From ${origin.label}, ${time}` : `From ${origin.label}`;
}

export function statusLabel(bucket) { return STATUS_LABELS[bucket] || bucket; }

// Maps a bookmark-cleanup proposal to a status bucket key for grouped display.
export function statusBucket(item) {
  if (item.category === 'duplicate') return 'duplicate';
  if (item.category === 'stale') return 'stale';
  if (item.category === 'dead') {
    const s = item.data?.httpStatus;
    if (s === 404) return 'http-404';
    if (s === 410) return 'http-410';
    if (s === 0) return 'unreachable';
    return 'dead-other';
  }
  return 'other';
}

export function groupByStatus(items) {
  const out = {};
  for (const it of items) (out[statusBucket(it)] ||= []).push(it);
  return out;
}

// Human-readable label for an ignore-list key ("closeTab:https://a.com/x").
export function describeIgnoreKey(key) {
  const idx = String(key).indexOf(':');
  if (idx < 0) return String(key);
  return `${actionLabel(key.slice(0, idx))}: ${key.slice(idx + 1)}`;
}

// The exact host-registration command for the onboarding screen. Includes the
// live extension id so it works for unpacked/dev installs too (where the id
// differs from the pinned store id the package defaults to).
export function installCommand(extensionId) {
  return `node native-host/cli.js install chrome,edge ${extensionId}`;
}

// Reassign a member tab from one proposed group to another (used by the editor).
export function moveMember(items, fromId, toId, tabId) {
  const from = items.find((i) => i.itemId === fromId);
  const member = from && from.data.members && from.data.members.find((m) => m.tabId === tabId);
  if (!member) return items;
  return items.map((it) => {
    if (it.itemId === fromId) {
      const members = it.data.members.filter((m) => m.tabId !== tabId);
      return { ...it, data: { ...it.data, members, tabIds: members.map((m) => m.tabId) } };
    }
    if (it.itemId === toId) {
      const members = [...it.data.members, member];
      return { ...it, data: { ...it.data, members, tabIds: members.map((m) => m.tabId) } };
    }
    return it;
  });
}

// Live client-side filter over open tabs (no AI): matches title, url, or host.
export function filterTabs(tabs, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return tabs;
  return tabs.filter((t) => {
    const host = (() => { try { return new URL(t.url).hostname.toLowerCase(); } catch { return ''; } })();
    return `${t.title}`.toLowerCase().includes(q) || `${t.url}`.toLowerCase().includes(q) || host.includes(q);
  });
}

export function groupByAction(items) {
  const out = {};
  for (const it of items) (out[it.action] ||= []).push(it);
  return out;
}

export function toggleSelection(selected, itemId) {
  const next = new Set(selected);
  if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
  return next;
}

export function selectedItems(selected, items) {
  return items.filter((it) => selected.has(it.itemId));
}

export function excludeMember(item, tabId) {
  const members = item.data.members.filter((m) => m.tabId !== tabId);
  return { ...item, data: { ...item.data, members, tabIds: members.map((m) => m.tabId) } };
}

// A renamed group no longer matches the parked group it was named after, so it
// drops parkedMatch (it can't be filed into a parked group it isn't).
export function renameGroup(item, name) {
  const { parkedMatch, ...data } = item.data;
  void parkedMatch;
  return { ...item, data: { ...data, groupName: name } };
}

export function recolorGroup(item, color) {
  return { ...item, data: { ...item.data, color } };
}

// All item ids, for bulk "Select all".
export function allItemIds(items) {
  return items.map((it) => it.itemId);
}

// Live client-side filter over plan items: matches group name, title, url,
// reason, or any group member's title/url.
export function filterPlan(items, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items;
  const hit = (s) => String(s || '').toLowerCase().includes(q);
  return items.filter((it) => {
    const d = it.data || {};
    if (hit(d.groupName) || hit(d.title) || hit(d.url) || hit(it.reason)) return true;
    if (Array.isArray(d.members)) return d.members.some((m) => hit(m.title) || hit(m.url));
    return false;
  });
}

const DESTRUCTIVE = new Set(['closeTab', 'discardTab', 'deleteBookmark']);

// Count of irreversible-feeling actions (close/suspend/delete) in a set.
export function destructiveCount(items) {
  return items.filter((it) => DESTRUCTIVE.has(it.action)).length;
}

// Whether a batch is large enough to warrant an explicit confirmation prompt.
export function needsBulkConfirm(items, threshold = 10) {
  return destructiveCount(items) >= threshold;
}

const ADAPTER_NOTES = {
  copilot: 'Lower assurance: Copilot CLI is agentic and runs with its default tool policy. Lock it down by setting BROWSER_SANITY_COPILOT_ARGS to a read-only/tool-deny flag list.',
};

// A caution note for adapters that can't be sandboxed as tightly as the others.
export function adapterNote(adapter) {
  return ADAPTER_NOTES[adapter] || '';
}

// "m:ss" elapsed clock for the scan heartbeat.
export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const ADAPTER_LABELS = { claude: 'Claude CLI', antigravity: 'Antigravity CLI', kiro: 'Kiro CLI', copilot: 'Copilot CLI', codex: 'Codex CLI', ollama: 'Ollama', openai: 'OpenAI-compatible API' };
const ADAPTER_CMDS = { claude: 'claude', antigravity: 'agy', kiro: 'kiro-cli', copilot: 'copilot', codex: 'codex', ollama: 'ollama' };
// Adapters that talk HTTP with a host-side key instead of spawning a CLI — their
// fix-it guidance is "set the env key", not "install/sign-in to a CLI".
const API_ADAPTERS = new Set(['openai']);

// The host version this extension build needs. Bumped whenever the extension
// starts relying on a newer host; the panel nudges an update when the installed
// bridge is older. No network — this is a compatibility contract, not a "latest"
// lookup (that's the opt-in checkHostUpdates path).
export const MIN_HOST_VERSION = '0.1.5';

// true if semver a < b (ignores any prerelease suffix; missing parts = 0).
export function semverLt(a, b) {
  const core = (v) => String(v || '0').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = core(a), y = core(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) < (y[i] || 0)) return true;
    if ((x[i] || 0) > (y[i] || 0)) return false;
  }
  return false;
}

export function healthMessage(health, extensionId = '<your-extension-id>') {
  const key = health && health.adapter;
  const label = ADAPTER_LABELS[key] || 'Claude CLI';
  const cmd = ADAPTER_CMDS[key] || 'claude';
  const bridge = health && health.hostVersion && health.hostVersion !== 'unknown' ? ` · bridge v${health.hostVersion}` : '';
  if (health && health.ready) {
    const r = { ok: true, text: `${label} connected (${health.version || 'ok'})${bridge}` };
    // The installed helper is older than this extension needs — nudge an update.
    if (health.hostVersion && health.hostVersion !== 'unknown' && semverLt(health.hostVersion, MIN_HOST_VERSION)) {
      r.update = `Helper out of date (v${health.hostVersion}, needs v${MIN_HOST_VERSION}). Update it: in the Browser Sanity folder run  git pull  then  npm run install-host , then reload the extension.`;
    }
    return r;
  }
  if (API_ADAPTERS.has(key)) {
    return {
      ok: false,
      text: [
        `Can't reach the ${label}.`,
        'Fix: open Settings below and enter your API key (and optional base URL / model),',
        'then save. The key is stored encrypted in this browser.',
      ].join('\n'),
    };
  }
  const err = String((health && health.error) || '');
  // Two very different causes need two different fixes. Native-messaging
  // connection failures ("host not found/disconnected") mean the helper isn't
  // registered; anything else from a reachable helper means the CLI itself
  // failed to start.
  // Only a native-MESSAGING failure means the helper isn't registered. Every such
  // error that reaches here carries native-host context — Chrome's lastError
  // ("Specified native messaging host not found", "Access to the specified native
  // messaging host is forbidden", "Native host has exited") and the client's own
  // fallbacks ("Native host disconnected/timed out"). A reachable helper whose CLI
  // errors (e.g. "spawn claude ENOENT", "command not found", "403 forbidden") never
  // does, so those correctly fall through to the "CLI didn't start" guidance below.
  const hostMissing = err === '' || /native (messaging )?host|specified native/i.test(err);
  if (hostMissing) {
    return {
      ok: false,
      text: [
        `Can't reach the helper app that runs your AI CLI (${label}).`,
        'Fix: open a terminal in the Browser Sanity folder (Node 20+) and run:',
        `    node native-host/cli.js install chrome,edge ${extensionId}`,
        'Then click the reload icon on this extension and reopen this panel.',
      ].join('\n'),
    };
  }
  return {
    ok: false,
    text: [
      `The helper app is running, but ${label} did not start.`,
      `Fix: make sure the "${cmd}" command is installed and signed in`,
      `(run "${cmd} --version" in a terminal), then reopen this panel.`,
    ].join('\n'),
  };
}

export function progressLabel(phase, done, total) {
  return `${phase}… (${done}/${total})`;
}

export function toMarkdown(items) {
  const lines = ['# Browser Sanity export', ''];
  for (const [action, list] of Object.entries(groupByAction(items))) {
    lines.push(`## ${actionLabel(action)}`);
    for (const it of list) {
      if (action === 'groupTabs') {
        lines.push(`- **${it.data.groupName}**`);
        for (const m of it.data.members || []) lines.push(`  - [${m.title || m.url}](${m.url})`);
      } else {
        const label = it.data.title || it.data.url || '';
        const reason = it.reason ? ` — ${it.reason}` : '';
        lines.push(it.data.url ? `- [${label}](${it.data.url})${reason}` : `- ${label}${reason}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function groupUndoByRun(entries) {
  const byRun = new Map();
  for (const e of entries) {
    if (!byRun.has(e.runId)) byRun.set(e.runId, { runId: e.runId, ts: e.ts, entries: [] });
    const r = byRun.get(e.runId);
    r.entries.push(e);
    r.ts = Math.max(r.ts, e.ts);
  }
  return [...byRun.values()].sort((a, b) => b.ts - a.ts);
}
