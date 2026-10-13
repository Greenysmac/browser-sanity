import os from 'node:os';
import path from 'node:path';

// Pinned Chrome/Edge id derived from the manifest `key` — identical across builds.
export const PROD_EXTENSION_ID = 'kebmdofdghcjmknaecnojcglkibcacgn';

// Stable per-user directory the host is copied into. Deliberately independent of
// cwd, the repo, and any npx/temp cache so the browser manifest never dangles.
export function hostHome(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    // path.win32 so separators are correct even when computed on a non-Windows host.
    const base = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(base, 'BrowserSanity');
  }
  return path.posix.join(home, '.browser-sanity');
}

// The name of the self-contained SEA executable. `install` targets this binary
// directly when it is present in the host home; otherwise it falls back to the
// node launcher (the npx path). Kept here so the name lives in one place.
export function hostBinName(platform = process.platform) {
  return platform === 'win32' ? 'browser-sanity-host.exe' : 'browser-sanity-host';
}
