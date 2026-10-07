import fs from 'node:fs';
import path from 'node:path';
import { hostHome } from './paths.js';

// The directory the index lives in: BROWSER_ORGANIZER_INDEX_DIR when set, else
// the host home. Kept separate so tests can point it at a temp directory.
function indexDir(env = process.env) {
  return env.BROWSER_ORGANIZER_INDEX_DIR || hostHome();
}

// Key a group by name, trimmed and lowercased, so matches survive case and
// whitespace differences between runs.
function groupKey(name) {
  return String(name || '').trim().toLowerCase();
}

// Read the previous index.json, tolerating a missing or broken file: either
// case is treated as "no prior index", never an error.
function readPrevious(file, readFile) {
  try {
    const parsed = JSON.parse(String(readFile(file, 'utf8')));
    return Array.isArray(parsed.groups) ? parsed.groups : [];
  } catch {
    return [];
  }
}

// Merge the incoming payload groups with the previous index. Every group in the
// payload is 'open' with lastSeen set to now; a previously-seen group missing
// from the payload stays as 'closed' with its old tabs and lastSeen (the memory
// of groups the user closed). A closed group reappearing becomes open again.
function mergeGroups(payloadGroups, previousGroups, now) {
  const incoming = Array.isArray(payloadGroups) ? payloadGroups : [];
  const previous = Array.isArray(previousGroups) ? previousGroups : [];
  const merged = [];
  const seen = new Set();
  for (const g of incoming) {
    const key = groupKey(g.name);
    seen.add(key);
    merged.push({
      name: String(g.name || ''),
      color: g.color,
      windowId: g.windowId,
      tabs: Array.isArray(g.tabs) ? g.tabs.map((t) => ({ title: t.title, url: t.url })) : [],
      status: 'open',
      lastSeen: now,
    });
  }
  for (const p of previous) {
    const key = groupKey(p.name);
    if (seen.has(key)) continue; // already carried forward as 'open'
    merged.push({
      name: String(p.name || ''),
      color: p.color,
      windowId: p.windowId,
      tabs: Array.isArray(p.tabs) ? p.tabs.map((t) => ({ title: t.title, url: t.url })) : [],
      status: 'closed',
      lastSeen: p.lastSeen,
    });
  }
  return merged;
}

// Render the human/agent-readable markdown: open groups first, then closed ones
// with the tabs they had when last seen, and finally the ungrouped tabs.
function renderMarkdown(groups, ungrouped, now) {
  const lines = [];
  lines.push('# Tab Sanity index');
  lines.push(`Updated: ${now}. Open groups come first; closed groups keep the tabs they had when last seen.`);
  const open = groups.filter((g) => g.status === 'open');
  const closed = groups.filter((g) => g.status === 'closed');
  for (const g of open) {
    lines.push('');
    lines.push(`## ${g.name} (open, ${g.tabs.length} tabs)`);
    for (const t of g.tabs) lines.push(`- [${t.title}](${t.url})`);
  }
  for (const g of closed) {
    lines.push('');
    const day = String(g.lastSeen || '').slice(0, 10);
    lines.push(`## ${g.name} (closed, last seen ${day}, ${g.tabs.length} tabs)`);
    for (const t of g.tabs) lines.push(`- [${t.title}](${t.url})`);
  }
  lines.push('');
  lines.push(`## Ungrouped (${ungrouped.length} tabs)`);
  for (const t of ungrouped) lines.push(`- [${t.title}](${t.url})`);
  return `${lines.join('\n')}\n`;
}

// Write index.json and index.md, merging with any prior index.json. Returns the
// number of groups written. Only those two files are touched.
export function writeIndex(payload = {}, {
  env = process.env,
  readFile = fs.readFileSync,
  writeFile = fs.writeFileSync,
  mkdir = fs.mkdirSync,
  now = new Date().toISOString(),
} = {}) {
  const dir = indexDir(env);
  const jsonPath = path.join(dir, 'index.json');
  const mdPath = path.join(dir, 'index.md');
  const previous = readPrevious(jsonPath, readFile);
  const groups = mergeGroups(payload.groups, previous, now);
  const ungrouped = Array.isArray(payload.ungrouped)
    ? payload.ungrouped.map((t) => ({ title: t.title, url: t.url }))
    : [];
  mkdir(dir, { recursive: true });
  writeFile(jsonPath, `${JSON.stringify({ updated: now, groups, ungrouped }, null, 2)}\n`);
  writeFile(mdPath, renderMarkdown(groups, ungrouped, now));
  return groups.length;
}
