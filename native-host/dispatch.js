import { getAdapter as defaultGetAdapter, adapterNames } from './adapters/registry.js';
import { listModels as openaiListModels } from './adapters/openai.js';
import { buildGroupPrompt, buildStalePrompt, buildImportantPrompt, buildCommandPrompt, buildOrganizePrompt, buildDescribePrompt, buildSplitPrompt } from './prompts.js';
import { parseGroupResult, parseStaleResult, parseImportantResult, parseCommandResult, parseOrganizeResult, parseDescribeResult, parseSplitResult, parseJsonBlock } from './parse.js';
import { sanitizeOptions, sanitizeConfig, sanitizeCli } from './config.js';
import { hostVersion } from './version.js';
import { loadGroupsFile, readGroups, writeGroupDescription, writeGroupSplit } from './groups-file.js';
import { writeIndex, parkGroup, readIndex, listIndexHistory, restoreIndexHistory, splitParkedGroup } from './index-file.js';
import { loadProposals } from './proposals-file.js';

// Fold the user's "my groups" file into the rules the model sees. When the file
// is empty this returns the incoming rules unchanged, so prompts stay identical
// to today unless a groups file exists.
function withGroups(rules, groupsText) {
  if (!groupsText) return rules;
  return [rules, `MY GROUPS (when a tab fits one of these, use that exact group name): ${groupsText}`].filter(Boolean).join('\n');
}

// One line, no control characters, at most 200 characters.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
function cleanSuggestion(text) {
  return String(text || '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// What this host can do, so the extension can feature-detect instead of probing
// by catching "Unknown task" errors. `passthrough` is the generic `prompt` task
// that lets the extension ship new AI operations without a host edit.
function capabilities() {
  return {
    types: ['health', 'models', 'organize', 'command', 'prompt', 'index', 'park', 'split-parked', 'index-read', 'index-history', 'index-restore', 'proposals', 'groups-read', 'groups-write', 'groups-split', 'describe'],
    tasks: ['group', 'stale', 'important', 'organize-bookmarks', 'split'],
    passthrough: true,
    adapters: adapterNames(),
  };
}

export async function handle(msg, deps = {}) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('Invalid message: expected an object');
  const getAdapter = deps.getAdapter || defaultGetAdapter;
  const adapter = getAdapter(msg.adapter || 'claude');
  // opts.config carries the openai adapter's UI-entered key/base/model (if any);
  // sanitizeConfig guarantees it's just those three strings, nothing executable.
  // Only attach it when present so other adapters' opts stay {timeoutMs} exactly.
  const opts = sanitizeOptions(msg.cliOptions);
  const cfg = sanitizeConfig(msg.config);
  if (cfg) opts.config = cfg;
  // Advanced-settings CLI controls (MCP/plugins toggles + guarded extra flags).
  // sanitizeCli enforces this adapter's flag ALLOWLIST host-side; adapters apply it.
  opts.cli = sanitizeCli(msg.cli, adapter.allowedExtraFlags);

  if (msg.type === 'health') {
    try {
      const info = await adapter.health(opts);
      return { adapter: adapter.name, ready: true, version: info.version, hostVersion: hostVersion(), capabilities: capabilities() };
    } catch (err) {
      return { adapter: adapter.name, ready: false, error: String((err && err.message) || err), hostVersion: hostVersion(), capabilities: capabilities() };
    }
  }

  // List the models the selected backend offers, so the extension can populate
  // a model picker instead of making the user type an id. The openai adapter
  // GETs <base>/models (host-side key + SSRF guards reused from the adapter);
  // Claude Code has no models endpoint, so return the current fixed line-up.
  // Any other backend reports an empty list (no enumeration available).
  if (msg.type === 'models') {
    const name = msg.adapter || 'claude';
    if (name === 'claude') return { models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'] };
    if (name === 'openai') {
      const listModels = deps.listModels || openaiListModels;
      return { models: await listModels(opts) };
    }
    return { models: [] };
  }

  // Generic passthrough: the extension supplies the full prompt and gets the
  // model's raw text back (optionally leniently parsed as JSON). This is the
  // extension-only extensibility path — new AI features need no host edit. The
  // CLI is still locked down by resolveArgs + the sanitizeCli allowlist, so the
  // blast radius is the same as the existing `rules`/`instruction` fields.
  if (msg.type === 'prompt') {
    const payload = msg.payload || {};
    const prompt = String(payload.prompt || '');
    if (!prompt) throw new Error('prompt task requires payload.prompt');
    const out = await adapter.run(prompt, opts);
    if (payload.parse) {
      let json = null;
      try { json = parseJsonBlock(out); } catch { /* not JSON — return raw only */ }
      return { raw: out, json };
    }
    return { raw: out };
  }

  if (msg.type === 'organize') {
    const { task } = msg;
    const payload = msg.payload || {};
    const loadGroups = deps.loadGroups || loadGroupsFile;
    const groupsText = loadGroups();
    const rules = withGroups(payload.rules || '', groupsText);
    if (task === 'group') {
      // A loaded groups file can define many named buckets, so lift the cap.
      const out = groupsText
        ? await adapter.run(buildGroupPrompt(payload.tabs, rules, { maxGroups: 15 }), opts)
        : await adapter.run(buildGroupPrompt(payload.tabs, rules), opts);
      return { task, groups: parseGroupResult(out) };
    }
    if (task === 'stale') {
      const out = await adapter.run(buildStalePrompt(payload.tabs, payload.thresholdDays, rules), opts);
      return { task, stale: parseStaleResult(out) };
    }
    if (task === 'important') {
      const out = await adapter.run(buildImportantPrompt(payload.tabs, rules), opts);
      return { task, important: parseImportantResult(out) };
    }
    if (task === 'organize-bookmarks') {
      const out = await adapter.run(buildOrganizePrompt(payload.bookmarks, payload.folders, payload.mode, rules), opts);
      return { task, moves: parseOrganizeResult(out) };
    }
    // Split one group into sub-groups. The groups file is deliberately NOT fed
    // in here (via rules): the split concerns this single group alone, so the
    // model should only see its tabs. Left-out tabs are recovered in the parser.
    if (task === 'split') {
      const tabs = Array.isArray(payload.tabs) ? payload.tabs : [];
      const out = await adapter.run(buildSplitPrompt(payload.groupName, tabs, { maxPerGroup: payload.maxPerGroup }), opts);
      const sentIds = tabs.map((t) => Number(t.tabId)).filter(Number.isInteger);
      return { task, groups: parseSplitResult(out, sentIds) };
    }
    throw new Error(`Unknown task: ${task}`);
  }

  if (msg.type === 'command') {
    const payload = msg.payload || {};
    const loadGroups = deps.loadGroups || loadGroupsFile;
    const rules = withGroups(payload.rules || '', loadGroups());
    const out = await adapter.run(buildCommandPrompt(payload.instruction, payload.tabs, rules), opts);
    return parseCommandResult(out);
  }

  // Write (and merge) the on-disk index of every group, remembering ones the
  // user has since closed. The file work lives in index-file.js; a missing or
  // broken previous index is treated as empty there, never an error.
  if (msg.type === 'index') {
    const writeIdx = deps.writeIndex || writeIndex;
    const count = writeIdx(msg.payload || {});
    return { ok: true, groups: count };
  }

  // Park a single group into the index: write it as 'parked' with lastSeen now,
  // replacing any entry with the same name. The file work lives in index-file.js.
  if (msg.type === 'park') {
    const park = deps.parkGroup || parkGroup;
    const payload = msg.payload || {};
    park(payload.group || {});
    return { ok: true };
  }

  // Split a parked group into sub-groups in the index, in place. Sub-group tabs
  // are drawn only from the parent's own tabs (foreign urls are ignored), so
  // nothing new is injected. The file work lives in index-file.js; returns
  // { ok: true, groups } or { ok: false, error } when the parent isn't found.
  if (msg.type === 'split-parked') {
    const split = deps.splitParkedGroup || splitParkedGroup;
    const payload = msg.payload || {};
    return split({ name: payload.name, groups: payload.groups });
  }

  // Read the parsed index.json so the extension can reopen a parked group. A
  // missing or broken file yields { groups: [], ungrouped: [] } (handled in
  // index-file.js), never an error.
  if (msg.type === 'index-read') {
    const read = deps.readIndex || readIndex;
    return read();
  }

  // List the dated copies of index.json kept in index-history, newest first,
  // each as { name, time }. A missing folder yields an empty list (handled in
  // index-file.js), never an error.
  if (msg.type === 'index-history') {
    const list = deps.listIndexHistory || listIndexHistory;
    return { history: list() };
  }

  // Restore a dated copy as index.json (after snapshotting the current one) and
  // rewrite index.md from it. payload.name must be a plain file name from the
  // history folder; index-file.js rejects slashes and '..'.
  if (msg.type === 'index-restore') {
    const restore = deps.restoreIndexHistory || restoreIndexHistory;
    const payload = msg.payload || {};
    return restore(payload.name);
  }

  // Read the agent-written proposals.json (same directory as the index) and
  // return its parsed content. A missing or invalid file yields the empty shape
  // { groups: [], close: [] }, so the extension always gets a usable response.
  if (msg.type === 'proposals') {
    const load = deps.loadProposals || loadProposals;
    return load();
  }

  // Describe the given groups: ask the model for one sentence per group and
  // return them as SUGGESTIONS only. Nothing is written here. Tab titles are
  // untrusted page text, and the groups file is fed back into every later
  // prompt as rules, so model output must never reach that file without the
  // user seeing it: the extension shows each suggestion and only an explicit
  // Save ('groups-write') stores it (security review, 2026-10-07). Suggestions
  // are kept only for groups that were asked about, flattened to one line,
  // stripped of control characters and capped at 200 characters.
  if (msg.type === 'describe') {
    const payload = msg.payload || {};
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    const asked = new Set(groups.map((g) => String(g.name || '').trim().toLowerCase()));
    const out = await adapter.run(buildDescribePrompt(groups), opts);
    const descriptions = parseDescribeResult(out)
      .filter((d) => d.description && asked.has(String(d.name || '').trim().toLowerCase()))
      .map((d) => ({ name: d.name, description: cleanSuggestion(d.description) }));
    return { descriptions, written: 0 };
  }

  // Read the group descriptions the model sees, so the extension can show and
  // edit them. Returns { groups: [{ name, description }] }; a missing file
  // yields { groups: [] } (handled in groups-file.js), never an error.
  if (msg.type === 'groups-read') {
    const read = deps.readGroups || readGroups;
    return { groups: read() };
  }

  // Set one group's description in the groups file, writing it back through the
  // same path (which may be a symlink). The file work lives in groups-file.js.
  if (msg.type === 'groups-write') {
    const write = deps.writeGroupDescription || writeGroupDescription;
    const payload = msg.payload || {};
    return write(payload.name, payload.description);
  }

  // Replace the parent group's line in the groups file with one line per
  // sub-group (names/descriptions cleaned), keeping every other line exactly.
  // The file work lives in groups-file.js.
  if (msg.type === 'groups-split') {
    const split = deps.writeGroupSplit || writeGroupSplit;
    const payload = msg.payload || {};
    return split(payload.name, payload.groups);
  }

  throw new Error(`Unknown message type: ${msg.type}`);
}
