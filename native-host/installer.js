import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CLI_ADAPTERS } from './adapters/catalog.js';
import { PROD_EXTENSION_ID, hostHome, hostBinName } from './paths.js';

export const HOST_NAME = 'com.browser_sanity.host';

const DIRS = {
  linux: {
    chrome: '.config/google-chrome/NativeMessagingHosts',
    chromium: '.config/chromium/NativeMessagingHosts',
    edge: '.config/microsoft-edge/NativeMessagingHosts',
    // "Chrome for Testing" — the build Playwright uses as its bundled Chromium.
    'chrome-for-testing': '.config/google-chrome-for-testing/NativeMessagingHosts',
  },
  darwin: {
    chrome: 'Library/Application Support/Google/Chrome/NativeMessagingHosts',
    chromium: 'Library/Application Support/Chromium/NativeMessagingHosts',
    edge: 'Library/Application Support/Microsoft Edge/NativeMessagingHosts',
    'chrome-for-testing': 'Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts',
  },
};

export function manifestDir(browser, platform = process.platform, home = os.homedir()) {
  const rel = DIRS[platform]?.[browser];
  if (!rel) throw new Error(`Unsupported platform/browser: ${platform}/${browser}`);
  return path.join(home, rel);
}

export function buildHostManifest({ execPath, extensionId }) {
  return {
    name: HOST_NAME,
    description: 'Browser Sanity native host',
    path: execPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

export function winManifestPath(nativeHostDir) {
  return path.join(nativeHostDir, `${HOST_NAME}.json`);
}

const WIN_REG_ROOTS = {
  chrome: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  edge: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
  chromium: 'HKCU\\Software\\Chromium\\NativeMessagingHosts',
};

// Returns argv arrays (not shell strings) so they can be run without a shell —
// no metacharacter injection from a manifest path containing " & % etc.
export function registryCommands(browsers, manifestPath) {
  return browsers.map((b) => {
    const root = WIN_REG_ROOTS[b];
    if (!root) throw new Error(`Unsupported browser for win32: ${b}`);
    return ['reg', 'add', `${root}\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'];
  });
}

export function registryDeleteCommands(browsers) {
  return browsers.map((b) => {
    const root = WIN_REG_ROOTS[b];
    if (!root) throw new Error(`Unsupported browser for win32: ${b}`);
    return ['reg', 'delete', `${root}\\${HOST_NAME}`, '/f'];
  });
}

// Runs the win32 registry argv arrays returned by install()/uninstall() (no shell,
// so a manifest path with " & % can't inject). No-op off win32 / when there are
// none. Callers (installer CLI and the npm `bin`) must invoke this on Windows —
// the browser finds native hosts via the registry there, not the manifest file.
export function runRegistryCommands(cmds, spawnFn = spawnSync) {
  for (const argv of cmds || []) {
    console.log('Running: ' + argv.join(' '));
    // Capture output (rather than inherit) so we can tell an already-absent key
    // apart from a real failure; echo it so the caller still sees what ran.
    const r = spawnFn(argv[0], argv.slice(1), { encoding: 'utf8' });
    const output = `${(r && r.stdout) || ''}${(r && r.stderr) || ''}`;
    if (output.trim()) console.log(output.trim());
    // A command failed if it couldn't spawn, exited non-zero, or was killed by a
    // signal (status is null in that case, so check r.signal explicitly).
    const failed = r && (r.error || r.signal || (typeof r.status === 'number' && r.status !== 0));
    if (!failed) continue;
    // `reg delete` of an already-absent key is expected during uninstall — tolerate
    // ONLY that. Permission/execution/other delete failures still propagate.
    if (argv[1] === 'delete' && /unable to find|cannot find|not find the specified/i.test(output)) {
      console.warn('  (skipped: registry key already absent)');
      continue;
    }
    const reason = (r.error && r.error.message) || (r.signal ? `killed by ${r.signal}` : `exit code ${r.status}`);
    throw new Error(`Registry command failed (${argv.slice(0, 3).join(' ')}): ${reason}`);
  }
}

// Resolves the absolute path to the `claude` CLI using the platform's lookup
// tool (which/where). Host-side only — never influenced by extension messages.
export function resolveCliPath(platform = process.platform, spawnSyncFn = spawnSync, binary = 'claude') {
  const finder = platform === 'win32' ? 'where' : 'which';
  try {
    const res = spawnSyncFn(finder, [binary], { encoding: 'utf8' });
    const line = String(res.stdout || '').split(/\r?\n/).find(Boolean);
    return line ? line.trim() : null;
  } catch { return null; }
}

// Values are baked verbatim into a double-quoted string in a generated,
// executable script. Reject (never silently mangle a path) anything that could
// break out of that quoting: `"` and newlines on both platforms, plus shell
// metachars ($ `) on POSIX and the batch variable-expansion char (%) on win32.
function assertSafeForLauncher(value, platform) {
  if (/["\r\n]/.test(value)) throw new Error(`Unsafe launcher value (quote/newline): ${JSON.stringify(value)}`);
  const bad = platform === 'win32' ? /%/ : /[`$]/;
  if (bad.test(value)) throw new Error(`Unsafe launcher value: ${JSON.stringify(value)}`);
}

export function buildLauncherScript({ platform, nodePath, hostEntry, vars = [] }) {
  // `vars` is [[ENV_NAME, absolutePath], …] for each CLI found; bake them so the
  // host resolves each adapter's binary even under a bare browser launch env.
  vars = vars.filter(([, v]) => v);
  assertSafeForLauncher(nodePath, platform);
  assertSafeForLauncher(hostEntry, platform);
  for (const [, v] of vars) assertSafeForLauncher(v, platform);
  if (platform === 'win32') {
    const sets = vars.map(([k, v]) => `set "${k}=${v}"\r\n`).join('');
    return `@echo off\r\n${sets}"${nodePath}" "${hostEntry}" %*\r\n`;
  }
  const exports = vars.map(([k, v]) => `${k}="${v}"\nexport ${k}\n`).join('');
  // Prepend common CLI locations so the host finds node and the CLIs even under a bare browser PATH.
  return `#!/bin/sh\nexport PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"\n${exports}exec "${nodePath}" "${hostEntry}"\n`;
}

// Writes a launcher that calls node (absolute path) on host.js, then registers
// the host manifest for each requested browser. Returns the files it wrote.
export function defaultHostDir() {
  // installer.js lives in native-host/ — its own directory is the host source dir.
  return path.dirname(fileURLToPath(import.meta.url));
}

// Files under native-host/ that make up the runnable host. Copied verbatim into
// the stable per-user home so the manifest can point at a permanent location
// (not the repo, an npx cache, or a deletable bundle). Generated launchers are
// re-created at install time, never copied.
const HOST_COPY_SKIP = new Set(['run.sh', 'run.bat']);

export function copyHostTo(destDir, srcDir = defaultHostDir()) {
  const copyDir = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      if (HOST_COPY_SKIP.has(name)) continue;
      const src = path.join(from, name);
      const dst = path.join(to, name);
      if (fs.statSync(src).isDirectory()) copyDir(src, dst);
      else fs.copyFileSync(src, dst);
    }
  };
  copyDir(srcDir, destDir);
  return path.join(destDir, 'host.js');
}

// Removes the native-host manifests (and returns registry-delete argv on win32)
// so users/installers can cleanly unregister. Returns the list of files removed.
export function uninstall({
  browsers,
  platform = process.platform,
  home = os.homedir(),
  copyTo = hostHome(platform, process.env, home),
} = {}) {
  const removed = [];
  const known = platform === 'win32' ? Object.keys(WIN_REG_ROOTS) : Object.keys(DIRS[platform] || {});
  const requested = browsers || known;
  const removingSet = new Set(requested);
  const removingAll = known.every((b) => removingSet.has(b));
  if (platform === 'win32') {
    const manifestPath = winManifestPath(copyTo);
    // On Windows the manifest is a single shared file used by every browser, so
    // only remove it when unregistering all of them; the registry keys are per-browser.
    if (removingAll && fs.existsSync(manifestPath)) { fs.rmSync(manifestPath); removed.push(manifestPath); }
    removed._registryCommands = registryDeleteCommands(requested);
  } else {
    for (const browser of requested) {
      const file = path.join(manifestDir(browser, platform, home), `${HOST_NAME}.json`);
      if (fs.existsSync(file)) { fs.rmSync(file); removed.push(file); }
    }
  }
  // The host home (binary/launcher/shared manifest) is shared across browsers.
  // Only delete it when no still-registered browser could still be using it —
  // otherwise a `--uninstall chrome` would silently break an installed Edge.
  const othersRemain = !removingAll && (platform === 'win32'
    ? true // conservative: keep the shared home unless removing every browser
    : known.some((b) => !removingSet.has(b) && fs.existsSync(path.join(manifestDir(b, platform, home), `${HOST_NAME}.json`))));
  if (copyTo && !othersRemain && fs.existsSync(copyTo)) { fs.rmSync(copyTo, { recursive: true, force: true }); removed.push(copyTo); }
  return removed;
}

// Re-run install: idempotent re-copy + re-register. Repairs a broken manifest.
export function repair(opts = {}) { return install(opts); }

export function install({
  extensionId = PROD_EXTENSION_ID,
  browsers,
  platform = process.platform,
  home = os.homedir(),
  copyTo = hostHome(platform, process.env, home),
  nodePath = process.execPath,
} = {}) {
  const nativeHostDir = copyTo;
  const isWin = platform === 'win32';
  const known = isWin ? Object.keys(WIN_REG_ROOTS) : Object.keys(DIRS[platform] || {});
  const requested = browsers || (isWin ? known : ['chrome', 'edge']);

  // Two install shapes point the manifest at different targets:
  //  1) SEA binary present in copyTo → point the manifest straight at the binary
  //     (the standalone-installer path; no Node, no launcher, no copied sources).
  //  2) No binary → copy the host sources in and write a node launcher (the npx
  //     path). This fallback must keep working exactly as before.
  const binPath = path.join(nativeHostDir, hostBinName(platform));
  let launcher;
  if (fs.existsSync(binPath)) {
    fs.mkdirSync(nativeHostDir, { recursive: true });
    launcher = binPath;
  } else {
    // Copy the host sources into the stable per-user home, then target that copy.
    const hostEntry = copyHostTo(nativeHostDir);
    // Resolve every catalogued adapter's binary path in one pass (declarative).
    const vars = CLI_ADAPTERS.map((a) => [a.cmdEnv, resolveCliPath(platform, spawnSync, a.bin)]);
    launcher = path.join(nativeHostDir, isWin ? 'run.bat' : 'run.sh');
    fs.writeFileSync(launcher, buildLauncherScript({ platform, nodePath, hostEntry, vars }));
    if (!isWin) fs.chmodSync(launcher, 0o700);
  }

  if (isWin) {
    const manifestPath = winManifestPath(nativeHostDir);
    fs.writeFileSync(manifestPath, JSON.stringify(buildHostManifest({ execPath: launcher, extensionId }), null, 2));
    const written = [launcher, manifestPath];
    written._registryCommands = registryCommands(requested, manifestPath);
    return written;
  }

  const manifest = buildHostManifest({ execPath: launcher, extensionId });
  const written = [launcher];
  for (const browser of requested) {
    const dir = manifestDir(browser, platform, home);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${HOST_NAME}.json`);
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    written.push(file);
  }
  return written;
}

// CLI entry (defaults extensionId to the pinned production id):
//   node native-host/installer.js [<extensionId>] [chrome,edge]   → install
//   node native-host/installer.js uninstall [chrome,edge]         → remove
// import.meta.url is undefined inside the SEA bundle, where this file is imported
// (not run as the entry) — guard so importing installer.js never throws there.
if (import.meta.url && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv[2] === 'uninstall') {
    const browsers = (process.argv[3] || 'chrome,edge').split(',').filter(Boolean);
    const removed = uninstall({ browsers });
    console.log(removed.length ? 'Removed:\n' + removed.map((f) => '  ' + f).join('\n') : 'Nothing to remove.');
    runRegistryCommands(removed._registryCommands);
  } else {
    // Support both `node installer.js [extensionId] [browsers]` and
    // `node installer.js [browsers] [extensionId]` (matching cli.js)
    const arg1 = process.argv[2];
    const arg2 = process.argv[3];
    let extensionId = PROD_EXTENSION_ID;
    let browsers = (arg2 || 'chrome,edge').split(',').filter(Boolean);
    if (arg1) {
      if (/^[a-z]{32}$/.test(arg1)) {
        extensionId = arg1;
      } else {
        browsers = arg1.split(',').filter(Boolean);
        if (arg2) extensionId = arg2;
      }
    }
    const files = install({ extensionId, browsers });
    console.log('Wrote:\n' + files.map((f) => '  ' + f).join('\n'));
    runRegistryCommands(files._registryCommands);
  }
}
