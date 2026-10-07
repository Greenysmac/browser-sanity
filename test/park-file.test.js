import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeIndex, parkGroup, readIndex } from '../native-host/index-file.js';
import { handle } from '../native-host/dispatch.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'borg-park-'));
}

function readJson(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
}

function readMd(dir) {
  return fs.readFileSync(path.join(dir, 'index.md'), 'utf8');
}

test('parkGroup writes a parked group with status parked and lastSeen now', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  const count = parkGroup(
    { name: 'Work', color: 'blue', tabs: [{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }] },
    { env, now: '2026-10-07T00:00:00.000Z' },
  );
  assert.equal(count, 1);
  const json = readJson(dir);
  assert.equal(json.groups.length, 1);
  assert.equal(json.groups[0].name, 'Work');
  assert.equal(json.groups[0].color, 'blue');
  assert.equal(json.groups[0].status, 'parked');
  assert.equal(json.groups[0].lastSeen, '2026-10-07T00:00:00.000Z');
  assert.deepEqual(json.groups[0].tabs, [{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }]);
  const md = readMd(dir);
  assert.match(md, /## Work \(parked, last seen 2026-10-07, 2 tabs\)/);
});

test('parkGroup merges into an existing entry with the same name (trimmed, case-insensitive)', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  // Seed an open Work group plus a Play group via writeIndex.
  writeIndex(
    { groups: [{ name: 'Work', tabs: [{ title: 'Old', url: 'https://old' }] }, { name: 'Play', tabs: [{ title: 'P', url: 'https://p' }] }], ungrouped: [{ title: 'U', url: 'https://u' }] },
    { env, now: '2026-10-01T00:00:00.000Z' },
  );
  const count = parkGroup(
    // One already-known url (kept, not duplicated) and one new one (appended).
    { name: '  WORK  ', color: 'red', tabs: [{ title: 'Old', url: 'https://old' }, { title: 'New', url: 'https://new' }] },
    { env, now: '2026-10-07T00:00:00.000Z' },
  );
  assert.equal(count, 2); // Work merged (not duplicated), Play kept
  const json = readJson(dir);
  const work = json.groups.filter((g) => g.name.trim().toLowerCase() === 'work');
  assert.equal(work.length, 1);
  assert.equal(work[0].status, 'parked');
  assert.equal(work[0].lastSeen, '2026-10-07T00:00:00.000Z');
  // Old tab kept, new tab appended, no duplicate for the shared url.
  assert.deepEqual(work[0].tabs, [{ title: 'Old', url: 'https://old' }, { title: 'New', url: 'https://new' }]);
  // Other groups and the ungrouped list are untouched.
  assert.ok(json.groups.find((g) => g.name === 'Play'));
  assert.deepEqual(json.ungrouped, [{ title: 'U', url: 'https://u' }]);
});

test('parkGroup with zero tabs leaves an existing entry untouched', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex(
    { groups: [{ name: 'Work', color: 'blue', tabs: [{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }] }], ungrouped: [] },
    { env, now: '2026-10-01T00:00:00.000Z' },
  );
  const count = parkGroup({ name: 'Work', tabs: [] }, { env, now: '2026-10-07T00:00:00.000Z' });
  assert.equal(count, 1); // not removed, not duplicated
  const json = readJson(dir);
  const work = json.groups.filter((g) => g.name.trim().toLowerCase() === 'work');
  assert.equal(work.length, 1);
  // The existing tabs survive a zero-tab park.
  assert.deepEqual(work[0].tabs, [{ title: 'A', url: 'https://a' }, { title: 'B', url: 'https://b' }]);
});

test('readIndex returns the parsed index.json shape', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex({ groups: [{ name: 'A', tabs: [] }], ungrouped: [{ title: 'U', url: 'https://u' }] }, { env, now: '2026-10-07T00:00:00.000Z' });
  const idx = readIndex({ env });
  assert.equal(idx.updated, '2026-10-07T00:00:00.000Z');
  assert.equal(idx.groups.length, 1);
  assert.equal(idx.groups[0].name, 'A');
  assert.deepEqual(idx.ungrouped, [{ title: 'U', url: 'https://u' }]);
});

test('readIndex returns the empty shape when the file is missing', () => {
  const dir = tempDir();
  const idx = readIndex({ env: { BROWSER_ORGANIZER_INDEX_DIR: dir } });
  assert.deepEqual(idx, { groups: [], ungrouped: [] });
});

test('readIndex returns the empty shape when the file is broken', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'index.json'), '{ not json');
  const idx = readIndex({ env: { BROWSER_ORGANIZER_INDEX_DIR: dir } });
  assert.deepEqual(idx, { groups: [], ungrouped: [] });
});

test('dispatch park type parks the group and returns ok', async () => {
  let seen = null;
  const r = await handle(
    { type: 'park', payload: { group: { name: 'Work', color: 'blue', tabs: [{ title: 'A', url: 'https://a' }] } } },
    { parkGroup: (g) => { seen = g; return 1; } },
  );
  assert.deepEqual(r, { ok: true });
  assert.equal(seen.name, 'Work');
  assert.deepEqual(seen.tabs, [{ title: 'A', url: 'https://a' }]);
});

test('dispatch index-read type returns the parsed index', async () => {
  const r = await handle(
    { type: 'index-read' },
    { readIndex: () => ({ updated: 'u', groups: [{ name: 'A' }], ungrouped: [] }) },
  );
  assert.deepEqual(r, { updated: 'u', groups: [{ name: 'A' }], ungrouped: [] });
});

test('health advertises the park and index-read message types', async () => {
  const getAdapter = () => ({ name: 'fake', async run() { return ''; }, async health() { return { version: 't' }; } });
  const r = await handle({ type: 'health' }, { getAdapter });
  assert.ok(r.capabilities.types.includes('park'));
  assert.ok(r.capabilities.types.includes('index-read'));
});
