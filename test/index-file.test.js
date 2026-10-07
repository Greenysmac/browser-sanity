import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeIndex } from '../native-host/index-file.js';
import { handle } from '../native-host/dispatch.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'borg-index-'));
}

function readJson(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
}

function readMd(dir) {
  return fs.readFileSync(path.join(dir, 'index.md'), 'utf8');
}

test('writeIndex writes index.json and index.md on a first write', () => {
  const dir = tempDir();
  const payload = {
    groups: [{ name: 'Work', color: 'blue', windowId: 1, tabs: [{ title: 'Docs', url: 'https://docs' }] }],
    ungrouped: [{ title: 'Random', url: 'https://random' }],
  };
  const count = writeIndex(payload, { env: { BROWSER_ORGANIZER_INDEX_DIR: dir }, now: '2026-10-07T00:00:00.000Z' });
  assert.equal(count, 1);
  const json = readJson(dir);
  assert.equal(json.groups.length, 1);
  assert.equal(json.groups[0].name, 'Work');
  assert.equal(json.groups[0].status, 'open');
  assert.equal(json.groups[0].lastSeen, '2026-10-07T00:00:00.000Z');
  assert.deepEqual(json.groups[0].tabs, [{ title: 'Docs', url: 'https://docs' }]);
  assert.deepEqual(json.ungrouped, [{ title: 'Random', url: 'https://random' }]);
  assert.ok(fs.existsSync(path.join(dir, 'index.md')));
});

test('writeIndex merges, keeping a now-missing group as parked with its old tabs and lastSeen', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex(
    { groups: [{ name: 'Work', color: 'blue', windowId: 1, tabs: [{ title: 'A', url: 'https://a' }] }], ungrouped: [] },
    { env, now: '2026-10-01T00:00:00.000Z' },
  );
  // Second write no longer includes Work.
  const count = writeIndex(
    { groups: [{ name: 'Play', color: 'red', windowId: 2, tabs: [{ title: 'B', url: 'https://b' }] }], ungrouped: [] },
    { env, now: '2026-10-07T00:00:00.000Z' },
  );
  assert.equal(count, 2);
  const json = readJson(dir);
  const work = json.groups.find((g) => g.name === 'Work');
  const play = json.groups.find((g) => g.name === 'Play');
  assert.equal(work.status, 'parked');
  assert.equal(work.lastSeen, '2026-10-01T00:00:00.000Z'); // old timestamp preserved
  assert.deepEqual(work.tabs, [{ title: 'A', url: 'https://a' }]); // last-known tabs kept
  assert.equal(play.status, 'open');
  assert.equal(play.lastSeen, '2026-10-07T00:00:00.000Z');
});

test('writeIndex reopens a parked group when it appears again (match by trimmed, case-insensitive name)', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex({ groups: [{ name: 'Work', tabs: [{ title: 'A', url: 'https://a' }] }], ungrouped: [] }, { env, now: '2026-10-01T00:00:00.000Z' });
  writeIndex({ groups: [], ungrouped: [] }, { env, now: '2026-10-02T00:00:00.000Z' }); // Work goes parked
  const beforeReopen = readJson(dir).groups.find((g) => g.name === 'Work');
  assert.equal(beforeReopen.status, 'parked');
  // Reappears with different case/whitespace — still matches.
  const count = writeIndex({ groups: [{ name: '  work  ', tabs: [{ title: 'C', url: 'https://c' }] }], ungrouped: [] }, { env, now: '2026-10-07T00:00:00.000Z' });
  assert.equal(count, 1); // not duplicated
  const json = readJson(dir);
  const work = json.groups.find((g) => groupName(g) === 'work');
  assert.equal(work.status, 'open');
  assert.equal(work.lastSeen, '2026-10-07T00:00:00.000Z');
  assert.deepEqual(work.tabs, [{ title: 'C', url: 'https://c' }]);
});

function groupName(g) {
  return String(g.name).trim().toLowerCase();
}

test('writeIndex treats a broken previous index.json as empty, never erroring', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  fs.writeFileSync(path.join(dir, 'index.json'), '{ not valid json');
  const count = writeIndex({ groups: [{ name: 'Fresh', tabs: [] }], ungrouped: [] }, { env, now: '2026-10-07T00:00:00.000Z' });
  assert.equal(count, 1);
  const json = readJson(dir);
  assert.equal(json.groups.length, 1);
  assert.equal(json.groups[0].name, 'Fresh');
  assert.equal(json.groups[0].status, 'open');
});

test('index.md uses the documented markdown format', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex({ groups: [{ name: 'Work', tabs: [{ title: 'A', url: 'https://a' }] }], ungrouped: [] }, { env, now: '2026-10-01T00:00:00.000Z' });
  writeIndex(
    {
      groups: [{ name: 'Play', tabs: [{ title: 'B', url: 'https://b' }, { title: 'C', url: 'https://c' }] }],
      ungrouped: [{ title: 'Loose', url: 'https://loose' }],
    },
    { env, now: '2026-10-07T12:00:00.000Z' },
  );
  const md = readMd(dir);
  assert.match(md, /^# Tab Sanity index\n/);
  assert.match(md, /Updated: 2026-10-07T12:00:00\.000Z\. Open groups come first; parked groups keep the tabs they had when last seen\./);
  assert.match(md, /## Play \(open, 2 tabs\)/);
  assert.match(md, /- \[B\]\(https:\/\/b\)/);
  assert.match(md, /- \[C\]\(https:\/\/c\)/);
  assert.match(md, /## Work \(parked, last seen 2026-10-01, 1 tabs\)/);
  assert.match(md, /- \[A\]\(https:\/\/a\)/);
  assert.match(md, /## Ungrouped \(1 tabs\)/);
  assert.match(md, /- \[Loose\]\(https:\/\/loose\)/);
  // Open group appears before the parked one.
  assert.ok(md.indexOf('## Play') < md.indexOf('## Work'));
});

test('writeIndex reads an old index.json that says "closed" as parked', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  // Seed a legacy index.json where a now-missing group still uses the old
  // 'closed' status.
  fs.writeFileSync(
    path.join(dir, 'index.json'),
    JSON.stringify({
      updated: '2026-10-01T00:00:00.000Z',
      groups: [{ name: 'Work', tabs: [{ title: 'A', url: 'https://a' }], status: 'closed', lastSeen: '2026-10-01T00:00:00.000Z' }],
      ungrouped: [],
    }),
  );
  writeIndex({ groups: [], ungrouped: [] }, { env, now: '2026-10-07T00:00:00.000Z' });
  const json = readJson(dir);
  const work = json.groups.find((g) => g.name === 'Work');
  assert.equal(work.status, 'parked');
  const md = readMd(dir);
  assert.match(md, /## Work \(parked, last seen 2026-10-01, 1 tabs\)/);
});

test('writeIndex drops a dissolved group instead of parking it', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex(
    { groups: [{ name: 'Work', tabs: [{ title: 'A', url: 'https://a' }] }, { name: 'Play', tabs: [{ title: 'B', url: 'https://b' }] }], ungrouped: [] },
    { env, now: '2026-10-01T00:00:00.000Z' },
  );
  // Second write omits both. Work is dissolved (dropped); Play simply disappears
  // and so becomes parked.
  const count = writeIndex(
    { groups: [], ungrouped: [], dissolved: ['Work'] },
    { env, now: '2026-10-07T00:00:00.000Z' },
  );
  assert.equal(count, 1);
  const json = readJson(dir);
  assert.equal(json.groups.find((g) => g.name === 'Work'), undefined);
  const play = json.groups.find((g) => g.name === 'Play');
  assert.equal(play.status, 'parked');
});

test('writeIndex matches dissolved names by trimmed, case-insensitive name', () => {
  const dir = tempDir();
  const env = { BROWSER_ORGANIZER_INDEX_DIR: dir };
  writeIndex({ groups: [{ name: 'Work', tabs: [] }], ungrouped: [] }, { env, now: '2026-10-01T00:00:00.000Z' });
  writeIndex({ groups: [], ungrouped: [], dissolved: ['  work  '] }, { env, now: '2026-10-07T00:00:00.000Z' });
  const json = readJson(dir);
  assert.equal(json.groups.length, 0);
});

test('dispatch index type writes the index and returns the group count', async () => {
  const dir = tempDir();
  writeIndex({ groups: [], ungrouped: [] }, { env: { BROWSER_ORGANIZER_INDEX_DIR: dir }, now: '2026-10-01T00:00:00.000Z' });
  let seenPayload = null;
  const r = await handle(
    { type: 'index', payload: { groups: [{ name: 'A', tabs: [] }, { name: 'B', tabs: [] }], ungrouped: [] } },
    { writeIndex: (payload) => { seenPayload = payload; return 2; } },
  );
  assert.deepEqual(r, { ok: true, groups: 2 });
  assert.equal(seenPayload.groups.length, 2);
});

test('health advertises the index message type', async () => {
  const getAdapter = () => ({ name: 'fake', async run() { return ''; }, async health() { return { version: 't' }; } });
  const r = await handle({ type: 'health' }, { getAdapter });
  assert.ok(r.capabilities.types.includes('index'));
});
