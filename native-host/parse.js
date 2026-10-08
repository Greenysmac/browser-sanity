// Strip ANSI/CSI escape sequences (colors, cursor moves) some CLIs emit even
// when piped — their '[' would otherwise fool bracket extraction.
function stripAnsi(s) {
  // Only real ANSI CSI sequences start with ESC (\x1b); the old bare-[ pattern corrupted JSON values like "Docs [v2]".
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

// Extract the *balanced* {…}/[…] block that starts at index `start`, respecting
// string literals/escapes so a brace inside a string doesn't end it early.
// `budget` is a shared {n} counter decremented per character examined; when it
// runs out the scan bails (returns null). This bounds the whole extraction to
// O(budget) total work instead of O(n²) on adversarial unbalanced input.
function extractBalancedAt(t, start, budget) {
  const open = t[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    if (--budget.n < 0) return null; // shared scan budget exhausted (always supplied)
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return t.slice(start, i + 1); }
  }
  return null;
}

// Total characters the balanced-block scanner may examine across all start
// positions. Generous enough for any real model answer (JSON near the top),
// small enough that the worst case stays in the low-millisecond range.
const MAX_SCAN_CHARS = 2_000_000;

export function parseJsonBlock(text) {
  const t = stripAnsi(String(text)).trim();
  try { return JSON.parse(t); } catch { /* try harder */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* fall through */ } }
  // Scan every { or [ and return the first balanced block that parses — handles
  // adapters that print prose (even prose with braces) before the JSON answer.
  // A shared scan budget caps total work: adversarial model output (e.g. the
  // `prompt` passthrough emitting hundreds of KB of "{") would otherwise drive
  // this O(n²) and freeze the single-threaded host event loop for minutes.
  const budget = { n: MAX_SCAN_CHARS };
  for (let i = 0; i < t.length; i++) {
    if (budget.n < 0) break;
    if (t[i] !== '{' && t[i] !== '[') continue;
    const block = extractBalancedAt(t, i, budget);
    if (block) { try { return JSON.parse(block); } catch { /* keep scanning */ } }
  }
  throw new Error('No JSON found in model output');
}

import { TAB_GROUP_COLORS } from './colors.js';

const COLORS = new Set(TAB_GROUP_COLORS);

// Normalizers operate on an already-parsed array (reused by the command path
// without a JSON re-serialize round-trip); the parse* wrappers add text parsing.
export function normalizeGroups(groups) {
  if (!Array.isArray(groups)) throw new Error('Expected {"groups":[...]}');
  return groups
    .map((g) => ({
      name: String(g.name ?? 'Group').slice(0, 40),
      color: COLORS.has(g.color) ? g.color : 'grey',
      tabIds: (Array.isArray(g.tabIds) ? g.tabIds : []).map(Number).filter(Number.isInteger),
    }))
    .filter((g) => g.tabIds.length > 0);
}

export function normalizeImportant(important) {
  if (!Array.isArray(important)) throw new Error('Expected {"important":[...]}');
  return important
    .filter((i) => Number.isInteger(Number(i.tabId)))
    .map((i) => ({
      tabId: Number(i.tabId),
      folderPath: (Array.isArray(i.folderPath) ? i.folderPath : []).map(String).filter(Boolean),
      reason: String(i.reason ?? ''),
    }));
}

function normalizeClose(close) {
  return (Array.isArray(close) ? close : [])
    .filter((c) => Number.isInteger(Number(c.tabId)))
    .map((c) => ({ tabId: Number(c.tabId), reason: String(c.reason ?? ''), suggestBookmark: !!c.suggestBookmark }));
}

export function parseGroupResult(text) {
  const obj = parseJsonBlock(text);
  return normalizeGroups(obj && obj.groups);
}

// One line, no control characters, capped. Sub-group names and descriptions are
// cleaned the same way describe suggestions are (dispatch.cleanSuggestion), but
// kept here so parseSplitResult stays self-contained.
// eslint-disable-next-line no-control-regex
const SPLIT_CONTROL = /[\u0000-\u001f\u007f]/g;
function cleanLine(text, max) {
  return String(text ?? '').replace(SPLIT_CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Parse a proposed split of one group into sub-groups. Lenient like
// parseGroupResult: only tabIds that were actually sent are kept, names and
// descriptions are flattened to one clean line (names ≤ 60, descriptions ≤ 200),
// and any sent tab the model left out lands in the first sub-group so nothing is
// lost. `sentTabIds` is the list of ids handed to the model.
export function parseSplitResult(text, sentTabIds) {
  const obj = parseJsonBlock(text);
  if (!obj || !Array.isArray(obj.groups)) throw new Error('Expected {"groups":[...]}');
  const sent = new Set((Array.isArray(sentTabIds) ? sentTabIds : []).map(Number).filter(Number.isInteger));
  const seen = new Set();
  const groups = obj.groups
    .map((g) => ({
      name: cleanLine(g && g.name ? g.name : 'Group', 60) || 'Group',
      description: cleanLine(g && g.description, 200),
      tabIds: (Array.isArray(g && g.tabIds) ? g.tabIds : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && sent.has(id) && !seen.has(id) && seen.add(id)),
    }))
    .filter((g) => g.tabIds.length > 0);
  const leftOut = [...sent].filter((id) => !seen.has(id));
  if (leftOut.length) {
    if (groups.length) groups[0].tabIds.push(...leftOut);
    else groups.push({ name: 'Group', description: '', tabIds: leftOut });
  }
  return groups;
}

export function parseStaleResult(text) {
  const obj = parseJsonBlock(text);
  if (!obj || !Array.isArray(obj.close)) throw new Error('Expected {"close":[...]}');
  return obj.close
    .filter((c) => Number.isInteger(Number(c.tabId)))
    .map((c) => ({ tabId: Number(c.tabId), reason: String(c.reason ?? ''), suggestBookmark: !!c.suggestBookmark, action: c.action === 'suspend' ? 'suspend' : 'close' }));
}

export function parseImportantResult(text) {
  const obj = parseJsonBlock(text);
  return normalizeImportant(obj && obj.important);
}

// Bookmark ids are strings (chrome bookmark ids), unlike numeric tabIds. Each
// move must carry a destination (existing targetFolderId or a newFolderPath).
export function normalizeOrganize(moves) {
  if (!Array.isArray(moves)) throw new Error('Expected {"moves":[...]}');
  return moves
    .filter((m) => m && m.bookmarkId != null)
    .map((m) => {
      const out = { bookmarkId: String(m.bookmarkId), reason: String(m.reason ?? '') };
      if (m.targetFolderId != null) out.targetFolderId = String(m.targetFolderId);
      const path = Array.isArray(m.newFolderPath) ? m.newFolderPath.map(String).filter(Boolean) : [];
      if (path.length) out.newFolderPath = path;
      return out;
    })
    .filter((m) => m.targetFolderId || m.newFolderPath);
}

export function parseOrganizeResult(text) {
  const obj = parseJsonBlock(text);
  return normalizeOrganize(obj && obj.moves);
}

// Descriptions are [{ name, description }]; both are coerced to trimmed strings
// and entries without a name are dropped. Leniently handles missing fields.
export function normalizeDescriptions(descriptions) {
  if (!Array.isArray(descriptions)) throw new Error('Expected {"descriptions":[...]}');
  return descriptions
    .map((d) => ({ name: String((d && d.name) ?? '').trim(), description: String((d && d.description) ?? '').trim() }))
    .filter((d) => d.name);
}

export function parseDescribeResult(text) {
  const obj = parseJsonBlock(text);
  return normalizeDescriptions(obj && obj.descriptions);
}

// Parse a proposed tidy of parked groups into merges and splits. Lenient like
// the other parsers: a name is kept only when it is in `existingNames` (trimmed,
// case-insensitive) and is rewritten to that canonical spelling. A merge never
// keeps a `from` equal to its `into` (a group can't merge into itself) and
// drops duplicate `from` names; a merge left with no valid `from`, or a split
// for an unknown name, is dropped. `existingNames` is the list of parked group
// names the model was shown.
export function parseTidyResult(text, existingNames) {
  const obj = parseJsonBlock(text) || {};
  const byKey = new Map();
  for (const n of (Array.isArray(existingNames) ? existingNames : [])) {
    byKey.set(String(n ?? '').trim().toLowerCase(), String(n ?? ''));
  }
  const exists = (name) => byKey.has(String(name ?? '').trim().toLowerCase());
  const canon = (name) => byKey.get(String(name ?? '').trim().toLowerCase());
  const sameKey = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

  const merge = (Array.isArray(obj.merge) ? obj.merge : [])
    .filter((m) => m && exists(m.into))
    .map((m) => {
      const into = canon(m.into);
      const seen = new Set([String(into).trim().toLowerCase()]);
      const from = (Array.isArray(m.from) ? m.from : [])
        .filter((f) => exists(f) && !sameKey(f, into)) // keep only real names, never self-merge
        .map((f) => canon(f))
        .filter((f) => { const k = String(f).trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
      return { into, from, reason: String(m.reason ?? '') };
    })
    .filter((m) => m.from.length > 0);

  const split = (Array.isArray(obj.split) ? obj.split : [])
    .filter((s) => s && exists(s.name))
    .map((s) => ({ name: canon(s.name), reason: String(s.reason ?? '') }));

  return { merge, split };
}

export function parseCommandResult(text) {
  const obj = parseJsonBlock(text) || {}; // model may emit literal null
  return {
    close: normalizeClose(obj.close),
    groups: Array.isArray(obj.groups) ? normalizeGroups(obj.groups) : [],
    important: Array.isArray(obj.important) ? normalizeImportant(obj.important) : [],
  };
}
