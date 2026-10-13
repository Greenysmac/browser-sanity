import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_NAME, manifestDir, buildHostManifest, buildLauncherScript, registryCommands, winManifestPath } from '../native-host/installer.js';

test('manifestDir resolves per browser on linux', () => {
  const d = manifestDir('chrome', 'linux', '/home/u');
  assert.equal(d, '/home/u/.config/google-chrome/NativeMessagingHosts');
  assert.match(manifestDir('edge', 'linux', '/home/u'), /microsoft-edge/);
});

test('manifestDir resolves per browser on darwin', () => {
  assert.match(manifestDir('chrome', 'darwin', '/Users/u'), /Google\/Chrome\/NativeMessagingHosts/);
  assert.match(manifestDir('edge', 'darwin', '/Users/u'), /Microsoft Edge\/NativeMessagingHosts/);
});

test('manifestDir throws for unsupported combo', () => {
  assert.throws(() => manifestDir('safari', 'linux', '/home/u'), /Unsupported/);
});

test('buildHostManifest wires name, path, and allowed_origins', () => {
  const m = buildHostManifest({ execPath: '/x/run.sh', extensionId: 'abc123' });
  assert.equal(m.name, HOST_NAME);
  assert.equal(m.type, 'stdio');
  assert.equal(m.path, '/x/run.sh');
  assert.deepEqual(m.allowed_origins, ['chrome-extension://abc123/']);
});

test('unix launcher exports the CLI path and a PATH before exec', () => {
  const s = buildLauncherScript({ platform: 'linux', nodePath: '/usr/bin/node', hostEntry: '/x/host.js', vars: [['BROWSER_SANITY_CLI', '/home/u/.local/bin/claude']] });
  assert.match(s, /^#!\/bin\/sh/);
  assert.match(s, /BROWSER_SANITY_CLI="\/home\/u\/\.local\/bin\/claude"/);
  assert.match(s, /export PATH=/);
  assert.match(s, /exec "\/usr\/bin\/node" "\/x\/host\.js"/);
});

test('win32 launcher still works normally for an ordinary Windows path', () => {
  const s = buildLauncherScript({ platform: 'win32', nodePath: 'C:\\node.exe', hostEntry: 'C:\\Users\\u\\host.js', vars: [['BROWSER_SANITY_CLI', 'C:\\Users\\u\\claude.exe']] });
  assert.match(s, /^@echo off/);
  assert.match(s, /set "BROWSER_SANITY_CLI=C:\\Users\\u\\claude\.exe"/);
  assert.match(s, /"C:\\node\.exe" "C:\\Users\\u\\host\.js" %\*/);
});

test('buildLauncherScript rejects a CLI path containing shell metacharacters instead of interpolating it verbatim', () => {
  const evil = '/usr/bin/claude"; rm -rf ~; echo "';
  assert.throws(
    () => buildLauncherScript({ platform: 'linux', nodePath: '/usr/bin/node', hostEntry: '/x/host.js', vars: [['BROWSER_SANITY_CLI', evil]] }),
    /Unsafe launcher value/,
  );
});

test('buildLauncherScript rejects shell-expansion metacharacters ($ and `) on POSIX', () => {
  assert.throws(
    () => buildLauncherScript({ platform: 'linux', nodePath: '/usr/bin/node', hostEntry: '/x/host.js', vars: [['BROWSER_SANITY_CLI', '/usr/bin/$(rm -rf ~)']] }),
    /Unsafe launcher value/,
  );
  assert.throws(
    () => buildLauncherScript({ platform: 'linux', nodePath: '/usr/bin/node', hostEntry: '/x/host.js', vars: [['BROWSER_SANITY_CLI', '/usr/bin/`rm -rf ~`']] }),
    /Unsafe launcher value/,
  );
});

test('buildLauncherScript rejects batch variable-expansion metacharacters (%) on win32', () => {
  assert.throws(
    () => buildLauncherScript({ platform: 'win32', nodePath: 'C:\\node.exe', hostEntry: 'C:\\host.js', vars: [['BROWSER_SANITY_CLI', 'C:\\%WINDIR%\\evil.exe']] }),
    /Unsafe launcher value/,
  );
});

test('buildLauncherScript rejects an unsafe nodePath or hostEntry, not just vars', () => {
  assert.throws(
    () => buildLauncherScript({ platform: 'linux', nodePath: '/usr/bin/node"; rm -rf ~; echo "', hostEntry: '/x/host.js', vars: [] }),
    /Unsafe launcher value/,
  );
  assert.throws(
    () => buildLauncherScript({ platform: 'linux', nodePath: '/usr/bin/node', hostEntry: '/x/host.js"; rm -rf ~; echo "', vars: [] }),
    /Unsafe launcher value/,
  );
});

test('registryCommands builds HKCU reg add argv (no shell) for chrome and edge', () => {
  const cmds = registryCommands(['chrome', 'edge'], 'C:\\hosts\\com.browser_sanity.host.json');
  assert.equal(cmds.length, 2);
  assert.deepEqual(cmds[0].slice(0, 3), ['reg', 'add', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.browser_sanity.host']);
  assert.ok(cmds[1][2].includes('Microsoft\\Edge'));
  assert.ok(cmds[0].includes('C:\\hosts\\com.browser_sanity.host.json'));
  assert.equal(cmds[0].at(-1), '/f');
});

test('winManifestPath is under the native host dir', () => {
  assert.match(winManifestPath('C:\\ext\\native-host'), /native-host.*com\.browser_sanity\.host\.json$/);
});

// --- stable-home install (Phase A) ---
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { install, copyHostTo, uninstall, repair, runRegistryCommands } from '../native-host/installer.js';
import { PROD_EXTENSION_ID, hostBinName } from '../native-host/paths.js';

test('copyHostTo copies host sources but not generated launchers', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-copy-'));
  try {
    const entry = copyHostTo(dest);
    assert.equal(entry, path.join(dest, 'host.js'));
    assert.ok(fs.existsSync(path.join(dest, 'host.js')));
    assert.ok(fs.existsSync(path.join(dest, 'dispatch.js')));
    assert.ok(fs.existsSync(path.join(dest, 'adapters', 'catalog.js')));
    assert.ok(!fs.existsSync(path.join(dest, 'run.sh')));  // generated, never copied
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('install copies the host into a stable home and points the manifest there', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-home-'));
  try {
    const copyTo = path.join(home, '.browser-sanity');
    const written = install({ browsers: ['chrome'], platform: 'linux', home, copyTo });
    assert.ok(written.some((f) => f.startsWith(copyTo)));
    const manifestFile = written.find((f) => f.endsWith('.json'));
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    assert.ok(manifest.path.startsWith(copyTo)); // points at the copy, not defaultHostDir()
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${PROD_EXTENSION_ID}/`]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install defaults extensionId to the pinned production id', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-defid-'));
  try {
    const written = install({ browsers: ['chrome'], platform: 'linux', home, copyTo: path.join(home, '.borg') });
    const manifest = JSON.parse(fs.readFileSync(written.find((f) => f.endsWith('.json')), 'utf8'));
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${PROD_EXTENSION_ID}/`]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('uninstall removes the copied host home and the manifests', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-unins-'));
  try {
    const copyTo = path.join(home, '.browser-sanity');
    install({ browsers: ['chrome'], platform: 'linux', home, copyTo });
    assert.ok(fs.existsSync(path.join(copyTo, 'host.js')));
    const removed = uninstall({ browsers: ['chrome'], platform: 'linux', home, copyTo });
    assert.ok(!fs.existsSync(copyTo));                        // copied host gone
    assert.ok(removed.some((f) => f.endsWith('.json')));      // manifest gone
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('repair is idempotent — re-running yields a working manifest', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-repair-'));
  try {
    const copyTo = path.join(home, '.browser-sanity');
    install({ browsers: ['chrome'], platform: 'linux', home, copyTo });
    const written = repair({ browsers: ['chrome'], platform: 'linux', home, copyTo });
    const manifest = JSON.parse(fs.readFileSync(written.find((f) => f.endsWith('.json')), 'utf8'));
    assert.ok(manifest.path.startsWith(copyTo));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// --- SEA-binary install target (Phase C) ---

test('install points the manifest at a pre-existing SEA binary and skips run.sh', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-sea-'));
  try {
    const copyTo = path.join(home, '.browser-sanity');
    // A packaged installer drops the binary into copyTo before registering it.
    fs.mkdirSync(copyTo, { recursive: true });
    const bin = path.join(copyTo, hostBinName('linux'));
    fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(bin, 0o700);

    const written = install({ browsers: ['chrome'], platform: 'linux', home, copyTo });
    const manifestFile = written.find((f) => f.endsWith('.json'));
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    assert.equal(manifest.path, bin);                       // manifest targets the binary directly
    assert.ok(!fs.existsSync(path.join(copyTo, 'run.sh'))); // no launcher written
    assert.ok(!written.includes(path.join(copyTo, 'run.sh')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install without a binary still copies sources and writes run.sh (npx path)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-nosea-'));
  try {
    const copyTo = path.join(home, '.browser-sanity');
    const written = install({ browsers: ['chrome'], platform: 'linux', home, copyTo });
    const launcher = path.join(copyTo, 'run.sh');
    assert.ok(fs.existsSync(launcher));
    assert.ok(written.includes(launcher));
    const manifest = JSON.parse(fs.readFileSync(written.find((f) => f.endsWith('.json')), 'utf8'));
    assert.equal(manifest.path, launcher);
    assert.ok(fs.existsSync(path.join(copyTo, 'host.js')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('runRegistryCommands runs each argv via the injected spawn (no shell) and no-ops on none', () => {
  const calls = [];
  runRegistryCommands(
    [
      ['reg', 'add', 'HKCU\\...\\host', '/ve', '/d', 'C:\\p.json', '/f'],
      ['reg', 'add', 'HKCU\\...\\host2', '/f'],
    ],
    (bin, args) => calls.push({ bin, args }),
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].bin, 'reg');
  assert.deepEqual(calls[0].args, ['add', 'HKCU\\...\\host', '/ve', '/d', 'C:\\p.json', '/f']);
  // undefined (non-win32 install returns no _registryCommands) is a safe no-op.
  const c2 = [];
  runRegistryCommands(undefined, (b) => c2.push(b));
  assert.equal(c2.length, 0);
});

test('runRegistryCommands throws on a failed reg add (no false success)', () => {
  // Non-zero exit (denied / other) must NOT be silently reported as success.
  assert.throws(
    () => runRegistryCommands([['reg', 'add', 'HKCU\\...\\host', '/f']], () => ({ status: 1, stderr: 'ERROR: Access is denied.' })),
    /Registry command failed .*reg add/,
  );
  // A spawn error (e.g. reg.exe missing) also propagates.
  assert.throws(
    () => runRegistryCommands([['reg', 'add', 'HKCU\\...\\host', '/f']], () => ({ error: new Error('ENOENT') })),
    /Registry command failed/,
  );
});

test('runRegistryCommands treats a signal-killed command as a failure', () => {
  // spawnSync returns status:null + a signal when the process is killed.
  assert.throws(
    () => runRegistryCommands([['reg', 'add', 'HKCU\\...\\host', '/f']], () => ({ status: null, signal: 'SIGKILL' })),
    /killed by SIGKILL/,
  );
});

test('runRegistryCommands tolerates an already-absent key on delete, but not other delete failures', () => {
  // Missing key is expected during uninstall → skipped, no throw.
  assert.doesNotThrow(() => runRegistryCommands(
    [['reg', 'delete', 'HKCU\\...\\host', '/f']],
    () => ({ status: 1, stderr: 'ERROR: The system was unable to find the specified registry key or value.' }),
  ));
  // A different delete failure (e.g. permission denied) must still propagate.
  assert.throws(
    () => runRegistryCommands([['reg', 'delete', 'HKCU\\...\\host', '/f']], () => ({ status: 1, stderr: 'ERROR: Access is denied.' })),
    /Registry command failed .*reg delete/,
  );
});

test('uninstall of one browser keeps the shared host home for the other', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-uninstall-'));
  try {
    const copyTo = path.join(home, '.browser-sanity');
    fs.mkdirSync(copyTo, { recursive: true });
    fs.writeFileSync(path.join(copyTo, 'host.js'), '// stub');
    for (const b of ['chrome', 'edge']) {
      const dir = manifestDir(b, 'linux', home);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${HOST_NAME}.json`), '{}');
    }
    // Uninstalling only chrome must not delete the shared home Edge still uses.
    uninstall({ browsers: ['chrome'], platform: 'linux', home, copyTo });
    assert.equal(fs.existsSync(path.join(manifestDir('chrome', 'linux', home), `${HOST_NAME}.json`)), false);
    assert.equal(fs.existsSync(path.join(manifestDir('edge', 'linux', home), `${HOST_NAME}.json`)), true);
    assert.equal(fs.existsSync(copyTo), true, 'shared home kept while edge still registered');
    // Removing the last browser cleans up the shared home.
    uninstall({ browsers: ['edge'], platform: 'linux', home, copyTo });
    assert.equal(fs.existsSync(copyTo), false, 'shared home removed after last browser');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('install() and repair() default browsers and do not throw when browsers option is omitted', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-default-browsers-'));
  try {
    const copyTo = path.join(home, '.browser-sanity');
    const written = install({ platform: 'linux', home, copyTo });
    assert.ok(written.length >= 3); // launcher + chrome manifest + edge manifest
    assert.ok(fs.existsSync(path.join(manifestDir('chrome', 'linux', home), `${HOST_NAME}.json`)));
    assert.ok(fs.existsSync(path.join(manifestDir('edge', 'linux', home), `${HOST_NAME}.json`)));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

