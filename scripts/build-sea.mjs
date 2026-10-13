// Builds a single-file executable of the native host for the current OS/arch
// using Node's Single Executable Applications (SEA) support.
//
// Uses two build-time tools, fetched on demand via `npx --yes` at pinned versions
// so they are NOT project dependencies and never touch the lockfile: esbuild
// bundles the ESM host graph into one CJS file so SEA can consume it, and postject
// injects the SEA blob into a copy of the Node binary. Keeping them out of the
// lockfile keeps the runtime host and published npm package dependency-free and
// avoids pulling postject's transitive deps (e.g. commander) into supply-chain
// scans of this repo.
//
// Run: `npm run build:sea` (i.e. `node scripts/build-sea.mjs`).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Pinned build-time tools, fetched on demand (kept out of package.json/lockfile).
const ESBUILD = 'esbuild@0.25.12';
const POSTJECT = 'postject@1.0.0-alpha.6';
const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';
// Node 20.12+ refuses to spawn .cmd files without shell:true (EINVAL), so run
// npx through the shell on Windows. Args here have no spaces/metachars.
const npxOpts = { stdio: 'inherit', shell: isWin };
const outDir = 'dist/host';
fs.mkdirSync(outDir, { recursive: true });

// 1) Bundle the ESM host graph (native-host/host.js + local imports) into one
//    CommonJS file. SEA needs a single self-contained entry.
execFileSync(npx, ['--yes', ESBUILD, 'native-host/host.js', '--bundle', '--platform=node',
  '--format=cjs', `--outfile=${outDir}/host-bundle.cjs`], npxOpts);

// 2) Generate the SEA preparation blob from the bundle.
execFileSync(process.execPath, ['--experimental-sea-config', 'native-host/sea-config.json'],
  { stdio: 'inherit' });

// 3) Copy the running Node binary and inject the blob into it.
const isMac = process.platform === 'darwin';
const bin = path.join(outDir, isWin ? 'browser-sanity-host.exe' : 'browser-sanity-host');
fs.copyFileSync(process.execPath, bin);

const postjectArgs = [bin, 'NODE_SEA_BLOB', `${outDir}/sea-prep.blob`,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
// macOS Mach-O binaries need a named segment for the injected resource.
if (isMac) postjectArgs.push('--macho-segment-name', 'NODE_SEA');
execFileSync(npx, ['--yes', POSTJECT, ...postjectArgs], npxOpts);

if (!isWin) fs.chmodSync(bin, 0o700);
console.log(`SEA host built → ${bin}`);
