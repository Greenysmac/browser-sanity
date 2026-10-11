import fs from 'node:fs';
import path from 'node:path';
import { hostHome } from './paths.js';

// Hard cap so a runaway groups file can never bloat every prompt.
const MAX_GROUPS_CHARS = 16000;

// Descriptions are single-line and bounded, so one group's line can never bloat
// the file or smuggle in extra lines.
const MAX_DESCRIPTION_CHARS = 500;

// The path to the groups file: BROWSER_ORGANIZER_GROUPS_FILE when set, else
// groups.md in the host home. Shared by loadGroupsFile and the read/write helpers.
function groupsFilePath(env = process.env) {
  return env.BROWSER_ORGANIZER_GROUPS_FILE || path.join(hostHome(), 'groups.md');
}

// A group line is '- Name: description'; the first colon splits name from
// description. Returns null for any line that isn't a group line.
function matchGroupLine(line) {
  const m = /^- ([^:]+):(.*)$/.exec(line);
  if (!m) return null;
  return { name: m[1].trim(), description: m[2].trim() };
}

// Collapse a description to a single trimmed line and cap its length, so it can
// never add newlines or overflow the file.
function cleanDescription(description) {
  return String(description || '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION_CHARS);
}

// Collapse a group name to a single trimmed line with no colon, so it can never
// add newlines or break the '- Name: description' shape when written back.
function cleanName(name) {
  return String(name || '').replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
}

// Parse the group lines ('- Name: description') out of the text, keeping their
// order. Non-group lines (free text) are ignored here.
export function parseGroups(text) {
  const groups = [];
  for (const line of String(text || '').split('\n')) {
    const g = matchGroupLine(line);
    if (g) groups.push(g);
  }
  return groups;
}

// Return new text with the given group's line set to the (cleaned) description.
// The name is matched trimmed and case-insensitively. An existing group's line
// is replaced in place; a new group's line is appended right after the last
// group line, so any trailing free text stays below the groups. All other lines
// are kept exactly.
export function setGroupDescription(text, name, description) {
  const key = String(name || '').trim().toLowerCase();
  const desc = cleanDescription(description);
  const str = String(text || '');
  // An empty file has no lines; start fresh so a new group isn't prefixed by a
  // stray blank line.
  const lines = str === '' ? [] : str.split('\n');
  let lastGroupIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const g = matchGroupLine(lines[i]);
    if (!g) continue;
    lastGroupIndex = i;
    if (g.name.toLowerCase() === key) {
      // Keep the existing group's name (and its casing); only the description changes.
      lines[i] = `- ${g.name}: ${desc}`;
      return lines.join('\n');
    }
  }
  // New group: insert after the last group line (before any trailing free text),
  // or append at the end when there are no group lines yet.
  const newLine = `- ${String(name || '').trim()}: ${desc}`;
  if (lastGroupIndex === -1) lines.push(newLine);
  else lines.splice(lastGroupIndex + 1, 0, newLine);
  return lines.join('\n');
}

// Return new text with the parent group's '- Name: description' line replaced
// by one line per sub-group (names/descriptions cleaned), keeping all other
// lines exactly. The parent name is matched trimmed and case-insensitively. When
// the parent has no line, the sub-group lines are appended after the last group
// line (or at the end when there are no group lines yet), just like
// setGroupDescription. Blank-named sub-groups are skipped so no empty line forms.
// "Someday" is the groups file's catch-all: splitting it keeps its line and
// inserts the sub-group lines after it instead of replacing it.
export function splitGroupLines(text, name, subGroups = []) {
  const key = String(name || '').trim().toLowerCase();
  const subs = (Array.isArray(subGroups) ? subGroups : [])
    .map((s) => ({ name: cleanName(s && s.name), description: cleanDescription(s && s.description) }))
    .filter((s) => s.name);
  const newLines = subs.map((s) => `- ${s.name}: ${s.description}`);
  const str = String(text || '');
  const lines = str === '' ? [] : str.split('\n');
  let lastGroupIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const g = matchGroupLine(lines[i]);
    if (!g) continue;
    lastGroupIndex = i;
    if (g.name.toLowerCase() === key) {
      // "Someday" is the groups file's catch-all: never replace it. Keep its
      // line and insert the new sub-group lines right after it.
      if (key === 'someday') lines.splice(i + 1, 0, ...newLines);
      else lines.splice(i, 1, ...newLines);
      return lines.join('\n');
    }
  }
  // No parent line: append the sub-group lines after the last group line, or at
  // the end when there are no group lines yet.
  if (lastGroupIndex === -1) lines.push(...newLines);
  else lines.splice(lastGroupIndex + 1, 0, ...newLines);
  return lines.join('\n');
}

// Return new text reflecting a merge of the `from` groups into `into`: every
// `from` group's line is removed. If `into` already has a line it is kept as-is
// (its description stays); if it has no line, the first removed `from` line is
// renamed to `into` (keeping that group's description) and left in that first
// group's position. All names are matched trimmed and case-insensitively; a
// `from` equal to `into` is ignored. All other lines are kept exactly.
export function mergeGroupLines(text, into, from = []) {
  const intoKey = String(into || '').trim().toLowerCase();
  const fromKeys = new Set((Array.isArray(from) ? from : [])
    .map((f) => String(f || '').trim().toLowerCase())
    .filter((k) => k && k !== intoKey));
  const str = String(text || '');
  const lines = str === '' ? [] : str.split('\n');
  const hasInto = lines.some((l) => { const g = matchGroupLine(l); return g && g.name.toLowerCase() === intoKey; });
  const out = [];
  let renamed = false;
  for (const line of lines) {
    const g = matchGroupLine(line);
    if (g && fromKeys.has(g.name.toLowerCase())) {
      // Drop each `from` line. When `into` has no line of its own, promote the
      // first dropped line to `into`, keeping its description and position.
      if (!hasInto && !renamed) {
        renamed = true;
        out.push(`- ${String(into || '').trim()}: ${g.description}`);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
export function readGroups({ env = process.env, readFile = fs.readFileSync } = {}) {
  try {
    return parseGroups(String(readFile(groupsFilePath(env), 'utf8')));
  } catch {
    return [];
  }
}

// Set one group's description in the groups file, writing it back through the
// same path (which may be a symlink). A missing file starts from empty text.
// Returns { ok: true }.
export function writeGroupDescription(name, description, {
  env = process.env,
  readFile = fs.readFileSync,
  writeFile = fs.writeFileSync,
} = {}) {
  const file = groupsFilePath(env);
  let text = '';
  try {
    text = String(readFile(file, 'utf8'));
  } catch {
    text = '';
  }
  writeFile(file, setGroupDescription(text, name, description));
  return { ok: true };
}

// Replace the parent group's line in the groups file with one line per
// sub-group, writing it back through the same path (which may be a symlink). A
// missing file starts from empty text. The file work lives in splitGroupLines.
// Returns { ok: true }.
export function writeGroupSplit(name, subGroups, {
  env = process.env,
  readFile = fs.readFileSync,
  writeFile = fs.writeFileSync,
} = {}) {
  const file = groupsFilePath(env);
  let text = '';
  try {
    text = String(readFile(file, 'utf8'));
  } catch {
    text = '';
  }
  writeFile(file, splitGroupLines(text, name, subGroups));
  return { ok: true };
}

// Apply a merge to the groups file: remove each `from` group's line, keeping the
// `into` line (or promoting the first `from` line to `into` when it has none),
// writing it back through the same path (which may be a symlink). A missing file
// starts from empty text. The file work lives in mergeGroupLines.
// Returns { ok: true }.
export function writeGroupMerge(into, from, {
  env = process.env,
  readFile = fs.readFileSync,
  writeFile = fs.writeFileSync,
} = {}) {
  const file = groupsFilePath(env);
  let text = '';
  try {
    text = String(readFile(file, 'utf8'));
  } catch {
    text = '';
  }
  writeFile(file, mergeGroupLines(text, into, from));
  return { ok: true };
}

// Load the user's optional "my groups" file. Its path is
// BROWSER_ORGANIZER_GROUPS_FILE when set, else groups.md in the host home.
// Returns the trimmed text (capped), or '' when the file is missing, empty,
// or unreadable — never throws, so a bad file silently disables the feature.
export function loadGroupsFile({ env = process.env, readFile = fs.readFileSync } = {}) {
  const file = env.BROWSER_ORGANIZER_GROUPS_FILE || path.join(hostHome(), 'groups.md');
  try {
    return String(readFile(file, 'utf8')).trim().slice(0, MAX_GROUPS_CHARS);
  } catch {
    return '';
  }
}
