import fs from 'node:fs';
import path from 'node:path';
import { hostHome } from './paths.js';

// Hard cap so a runaway groups file can never bloat every prompt.
const MAX_GROUPS_CHARS = 16000;

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
