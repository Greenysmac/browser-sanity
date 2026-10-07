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

// Read and parse the groups file into [{ name, description }]. A missing or
// unreadable file yields [], never throws.
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
