// Builds distributable zips (dependency-free ZIP writer: zlib deflate + CRC32).
//   npm run package            → browser-sanity-extension-<ver>.zip: extension/ ONLY (Web Store / Edge upload)
//   npm run package:selfhost   → self-host bundle: extension/ + native-host/ + install/ + docs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] === 'selfhost' ? 'selfhost' : 'store';
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8')).version;
const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });

// Generated launchers, OS cruft — never ship these.
const EXCLUDE = new Set(['.DS_Store', 'Thumbs.db', 'run.sh', 'run.bat']);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function walk(dir, base = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).sort()) {
    if (EXCLUDE.has(name)) continue;
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push({ rel, full });
  }
  return out;
}

function collect() {
  if (mode === 'store') return walk(path.join(ROOT, 'extension'));
  const files = [];
  for (const dir of ['extension', 'native-host']) {
    for (const f of walk(path.join(ROOT, dir))) files.push({ rel: `${dir}/${f.rel}`, full: f.full });
  }
  for (const doc of ['INSTALL.md', 'README.md', 'PRIVACY.md', 'docs/security-model.md']) {
    const p = path.join(ROOT, doc);
    if (fs.existsSync(p)) files.push({ rel: doc, full: p });
  }
  return files;
}

const DOS_DATE = 0x5221; // fixed (2021-01-01) → reproducible zips
const files = collect();
const parts = [];
const central = [];
let offset = 0;
for (const f of files) {
  let data = fs.readFileSync(f.full);
  // The Web Store rejects a manifest containing a `key` field (it's only for
  // pinning a stable ID for the LOCAL unpacked build). Strip it from the store
  // upload while leaving extension/manifest.json untouched for development.
  if (mode === 'store' && f.rel === 'manifest.json') {
    const m = JSON.parse(data.toString('utf8'));
    delete m.key;
    data = Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8');
  }
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(f.rel, 'utf8');
  const crc = crc32(data);
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0, 6);
  lfh.writeUInt16LE(8, 8); lfh.writeUInt16LE(0, 10); lfh.writeUInt16LE(DOS_DATE, 12);
  lfh.writeUInt32LE(crc, 14); lfh.writeUInt32LE(comp.length, 18); lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(name.length, 26); lfh.writeUInt16LE(0, 28);
  parts.push(lfh, name, comp);
  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(0, 8); cdh.writeUInt16LE(8, 10); cdh.writeUInt16LE(0, 12); cdh.writeUInt16LE(DOS_DATE, 14);
  cdh.writeUInt32LE(crc, 16); cdh.writeUInt32LE(comp.length, 20); cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(name.length, 28); cdh.writeUInt32LE(0, 30); cdh.writeUInt32LE(0, 34);
  cdh.writeUInt32LE(0, 38); cdh.writeUInt32LE(offset, 42);
  central.push(cdh, name);
  offset += lfh.length + name.length + comp.length;
}
const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16);
const outPath = path.join(outDir, `browser-sanity-${mode === 'store' ? 'extension' : 'selfhost'}-${version}.zip`);
fs.writeFileSync(outPath, Buffer.concat([...parts, centralBuf, eocd]));
console.log(`[${mode}] packaged ${files.length} files → ${path.relative(ROOT, outPath)} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
