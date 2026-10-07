import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeIndex, parkGroup, listIndexHistory, restoreIndexHistory } from '../native-host/index-file.js';
import { handle } from '../native-host/dispatch.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'borg-history-'));
}

function historyFiles(dir) {
  return fs.readdirSync(path.join(dir, 'index-history')).filter((f) => /^index-.*\.json$/.test(f));
}

function readJson(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
}

test('writeIndex makes no history copy on the very first write (no prior index)', () => {
  const dir = tempDir();
  writeIndex({ groups: [{ name: 'A', tabs: [] }], ungrouped: [] }, { env: { BROWSER_ORGANIZER_INDEX_DIR: dir }, now: '2026-10-01T00:00:00.000Z' });
  assert.equal(fs.existsSync(path.join(dir, 'index-history')), false);
});

test('writeIndex copies the current index.json into index-history before each later write', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex({ groups: [{ name: 'A', tabs: [] }], ungrouped: [] }, { env, now: '2026-10-01T00:00:00.000Z' });
  writeIndex({ groups: [{ name: 'B', tabs: [] }], ungrouped: [] }, { env, now: '2026-10-02T12:30:45.000Z' });
  const copies = historyFiles(dir);
  assert.equal(copies.length, 1);
  // Name derives from the time of the write that displaced it, ':' → '-'.
  assert.equal(copies[0], 'index-2026-10-02T12-30-45.000Z.json');
  // The copy holds the previous content (group A), not the fresh one.
  const snap = JSON.parse(fs.readFileSync(path.join(dir, 'index-history', copies[0]), 'utf8'));
  assert.equal(snap.groups[0].name, 'A');
});

test('parkGroup also snapshots the current index before writing', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex({ groups: [{ name: 'A', tabs: [] }], ungrouped: [] }, { env, now: '2026-10-01T00:00:00.000Z' });
  parkGroup({ name: 'B', tabs: [{ title: 't', url: 'https://b' }] }, { env, now: '2026-10-03T00:00:00.000Z' });
  const copies = historyFiles(dir);
  assert.equal(copies.length, 1);
  assert.equal(copies[0], 'index-2026-10-03T00-00-00.000Z.json');
});

test('history keeps only the newest 50 copies', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  // 53 writes: the first makes no copy, the other 52 each snapshot the prior.
  for (let i = 0; i < 53; i += 1) {
    const now = `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`;
    writeIndex({ groups: [{ name: `G${i}`, tabs: [] }], ungrouped: [] }, { env, now });
  }
  const copies = historyFiles(dir).sort();
  assert.equal(copies.length, 50);
  // 52 snapshots were taken (writes 2..53, each named for its own time); the
  // two oldest were pruned, leaving the 4th write's time as the earliest kept.
  assert.equal(copies[0], 'index-2026-11-04T00-00-00.000Z.json');
  assert.equal(copies[49], 'index-2026-11-53T00-00-00.000Z.json');
});

test('listIndexHistory returns name and time, newest first', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex({ groups: [], ungrouped: [] }, { env, now: '2026-10-01T00:00:00.000Z' });
  writeIndex({ groups: [], ungrouped: [] }, { env, now: '2026-10-02T00:00:00.000Z' });
  writeIndex({ groups: [], ungrouped: [] }, { env, now: '2026-10-03T00:00:00.000Z' });
  const list = listIndexHistory({ env });
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'index-2026-10-03T00-00-00.000Z.json');
  assert.equal(list[0].time, '2026-10-03T00:00:00.000Z'); // colons restored
  assert.equal(list[1].name, 'index-2026-10-02T00-00-00.000Z.json');
  assert.equal(list[1].time, '2026-10-02T00:00:00.000Z');
});

test('listIndexHistory yields an empty list when there is no history folder', () => {
  const dir = tempDir();
  assert.deepEqual(listIndexHistory({ env: { BROWSER_ORGANIZER_INDEX_DIR: dir } }), []);
});

test('restoreIndexHistory restores a copy as index.json and rewrites index.md', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex({ groups: [{ name: 'Original', tabs: [{ title: 'A', url: 'https://a' }] }], ungrouped: [] }, { env, now: '2026-10-01T00:00:00.000Z' });
  writeIndex({ groups: [{ name: 'Changed', tabs: [] }], ungrouped: [] }, { env, now: '2026-10-02T00:00:00.000Z' });
  // The snapshot taken before the second write holds the Original group.
  const copy = historyFiles(dir)[0];
  const r = restoreIndexHistory(copy, { env, now: '2026-10-05T00:00:00.000Z' });
  assert.deepEqual(r, { ok: true });
  const json = readJson(dir);
  assert.equal(json.groups[0].name, 'Original');
  const md = fs.readFileSync(path.join(dir, 'index.md'), 'utf8');
  assert.match(md, /## Original \(open, 1 tabs\)/);
});

test('restoreIndexHistory snapshots the current index before overwriting it', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex({ groups: [{ name: 'V1', tabs: [] }], ungrouped: [] }, { env, now: '2026-10-01T00:00:00.000Z' });
  writeIndex({ groups: [{ name: 'V2', tabs: [] }], ungrouped: [] }, { env, now: '2026-10-02T00:00:00.000Z' });
  const copy = historyFiles(dir)[0]; // snapshot of V1
  restoreIndexHistory(copy, { env, now: '2026-10-05T00:00:00.000Z' });
  // The restore itself snapshotted V2 under its own time.
  assert.ok(historyFiles(dir).includes('index-2026-10-05T00-00-00.000Z.json'));
  const snap = JSON.parse(fs.readFileSync(path.join(dir, 'index-history', 'index-2026-10-05T00-00-00.000Z.json'), 'utf8'));
  assert.equal(snap.groups[0].name, 'V2');
});

test('restoreIndexHistory refuses a name with a slash or ..', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  assert.throws(() => restoreIndexHistory('../index.json', { env }), /Invalid history name/);
  assert.throws(() => restoreIndexHistory('sub/index.json', { env }), /Invalid history name/);
  assert.throws(() => restoreIndexHistory('..', { env }), /Invalid history name/);
  assert.throws(() => restoreIndexHistory('', { env }), /Invalid history name/);
});

test('a failing snapshot never fails the write', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex({ groups: [{ name: 'A', tabs: [] }], ungrouped: [] }, { env, now: '2026-10-01T00:00:00.000Z' });
  // mkdir throws only for the history folder; the main write still proceeds.
  const mkdir = (p, opts) => {
    if (String(p).endsWith('index-history')) throw new Error('boom');
    return fs.mkdirSync(p, opts);
  };
  assert.doesNotThrow(() => {
    writeIndex({ groups: [{ name: 'B', tabs: [] }], ungrouped: [] }, { env, now: '2026-10-02T00:00:00.000Z', mkdir });
  });
  assert.equal(readJson(dir).groups[0].name, 'B');
});

test('dispatch index-history returns the listing', async () => {
  const r = await handle(
    { type: 'index-history' },
    { listIndexHistory: () => [{ name: 'index-x.json', time: 'x' }] },
  );
  assert.deepEqual(r, { history: [{ name: 'index-x.json', time: 'x' }] });
});

test('dispatch index-restore forwards the name and returns the result', async () => {
  let seen = null;
  const r = await handle(
    { type: 'index-restore', payload: { name: 'index-x.json' } },
    { restoreIndexHistory: (name) => { seen = name; return { ok: true }; } },
  );
  assert.equal(seen, 'index-x.json');
  assert.deepEqual(r, { ok: true });
});

test('health advertises the index-history and index-restore message types', async () => {
  const getAdapter = () => ({ name: 'fake', async run() { return ''; }, async health() { return { version: 't' }; } });
  const r = await handle({ type: 'health' }, { getAdapter });
  assert.ok(r.capabilities.types.includes('index-history'));
  assert.ok(r.capabilities.types.includes('index-restore'));
});
