import fs from 'node:fs';
import path from 'node:path';
import { hostHome } from './paths.js';

// The directory proposals.json lives in: BROWSER_ORGANIZER_INDEX_DIR when set
// (same location as the on-disk index — see index-file.js), else the host home.
function proposalsDir(env = process.env) {
  return env.BROWSER_ORGANIZER_INDEX_DIR || hostHome();
}

// Read proposals.json, the file an agent (e.g. Mycroft) writes to suggest tab
// groups and tabs to close. Format:
//   { "from": "Mycroft", "note": "...",
//     "groups": [{ "name": "...", "color": "...", "urls": ["https://..."] }],
//     "close":  [{ "url": "https://...", "reason": "..." }] }
// A missing or invalid file is treated as "no proposals": returns
// { groups: [], close: [] }, never throws. `from`/`note` are carried through
// when present so the UI can show them.
export function loadProposals({ env = process.env, readFile = fs.readFileSync } = {}) {
  const file = path.join(proposalsDir(env), 'proposals.json');
  try {
    const parsed = JSON.parse(String(readFile(file, 'utf8')));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { groups: [], close: [] };
    const out = {
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      close: Array.isArray(parsed.close) ? parsed.close : [],
    };
    if (typeof parsed.from === 'string') out.from = parsed.from;
    if (typeof parsed.note === 'string') out.note = parsed.note;
    return out;
  } catch {
    return { groups: [], close: [] };
  }
}
