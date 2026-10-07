import { getAdapter as defaultGetAdapter, adapterNames } from './adapters/registry.js';
import { buildGroupPrompt, buildStalePrompt, buildImportantPrompt, buildCommandPrompt, buildOrganizePrompt } from './prompts.js';
import { parseGroupResult, parseStaleResult, parseImportantResult, parseCommandResult, parseOrganizeResult, parseJsonBlock } from './parse.js';
import { sanitizeOptions, sanitizeConfig, sanitizeCli } from './config.js';
import { hostVersion } from './version.js';
import { loadGroupsFile } from './groups-file.js';
import { writeIndex } from './index-file.js';

// Fold the user's "my groups" file into the rules the model sees. When the file
// is empty this returns the incoming rules unchanged, so prompts stay identical
// to today unless a groups file exists.
function withGroups(rules, groupsText) {
  if (!groupsText) return rules;
  return [rules, `MY GROUPS (when a tab fits one of these, use that exact group name): ${groupsText}`].filter(Boolean).join('\n');
}

// What this host can do, so the extension can feature-detect instead of probing
// by catching "Unknown task" errors. `passthrough` is the generic `prompt` task
// that lets the extension ship new AI operations without a host edit.
function capabilities() {
  return {
    types: ['health', 'organize', 'command', 'prompt', 'index'],
    tasks: ['group', 'stale', 'important', 'organize-bookmarks'],
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

  throw new Error(`Unknown message type: ${msg.type}`);
}
