import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeIndex, splitParkedGroup, readIndex } from '../native-host/index-file.js';
import { splitGroupLines, writeGroupSplit, mergeGroupLines, writeGroupMerge } from '../native-host/groups-file.js';
import { handle } from '../native-host/dispatch.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'borg-split-'));
}

function readJson(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
}

// Seed a parked parent between two other groups so position can be checked.
function seedParked(dir) {
  const env = { BROWSER_SANITY_INDEX_DIR: dir };
  // writeIndex marks every incoming group 'open'; parking Work makes it 'parked'
  // but a split works on any entry, so just write it directly as the shape used.
  writeIndex(
    {
      groups: [
        { name: 'Before', color: 'blue', tabs: [{ title: 'B', url: 'https://before' }] },
        {
          name: 'Work',
          color: 'red',
          tabs: [
            { title: 'A', url: 'https://a' },
            { title: 'B', url: 'https://b' },
            { title: 'C', url: 'https://c' },
          ],
        },
        { name: 'After', color: 'green', tabs: [{ title: 'Z', url: 'https://after' }] },
      ],
      ungrouped: [{ title: 'U', url: 'https://u' }],
    },
    { env, now: '2026-10-01T00:00:00.000Z' },
  );
  return env;
}

test('splitParkedGroup keeps every tab exactly once, ignores foreign urls, keeps position', () => {
  const dir = tempDir();
  const env = seedParked(dir);
  const res = splitParkedGroup(
    {
      name: '  work  ', // trimmed, case-insensitive match
      groups: [
        // https://a goes here; https://zzz is foreign and ignored (not injected).
        { name: 'Alpha', color: 'cyan', urls: ['https://a', 'https://zzz'] },
        // https://b goes here; https://c is left unclaimed → falls into first sub-group.
        { name: 'Beta', urls: ['https://b'] },
      ],
    },
    { env, now: '2026-10-07T00:00:00.000Z' },
  );
  assert.deepEqual(res, { ok: true, groups: [{ name: 'Alpha', tabs: 2 }, { name: 'Beta', tabs: 1 }] });

  const json = readJson(dir);
  const names = json.groups.map((g) => g.name);
  // Parent replaced in place: Before, [Alpha, Beta], After.
  assert.deepEqual(names, ['Before', 'Alpha', 'Beta', 'After']);

  const alpha = json.groups.find((g) => g.name === 'Alpha');
  const beta = json.groups.find((g) => g.name === 'Beta');
  // Foreign url never injected; unclaimed https://c falls into the first sub-group.
  assert.deepEqual(alpha.tabs, [{ title: 'A', url: 'https://a' }, { title: 'C', url: 'https://c' }]);
  assert.deepEqual(beta.tabs, [{ title: 'B', url: 'https://b' }]);
  // Sub-groups are parked, lastSeen now, color as given or inherited from parent.
  assert.equal(alpha.status, 'parked');
  assert.equal(beta.status, 'parked');
  assert.equal(alpha.lastSeen, '2026-10-07T00:00:00.000Z');
  assert.equal(alpha.color, 'cyan'); // given
  assert.equal(beta.color, 'red'); // inherited from the parent

  // Every parent tab appears exactly once across the sub-groups.
  const allUrls = [...alpha.tabs, ...beta.tabs].map((t) => t.url).sort();
  assert.deepEqual(allUrls, ['https://a', 'https://b', 'https://c']);

  // Other groups and the ungrouped list are untouched.
  assert.deepEqual(json.ungrouped, [{ title: 'U', url: 'https://u' }]);
});

test('splitParkedGroup makes a history copy before writing', () => {
  const dir = tempDir();
  const env = seedParked(dir);
  const hdir = path.join(dir, 'index-history');
  assert.ok(!fs.existsSync(hdir)); // no history yet (seed was the first write)
  splitParkedGroup(
    { name: 'Work', groups: [{ name: 'Alpha', urls: ['https://a', 'https://b', 'https://c'] }] },
    { env, now: '2026-10-07T00:00:00.000Z' },
  );
  const copies = fs.readdirSync(hdir).filter((f) => /^index-.*\.json$/.test(f));
  assert.equal(copies.length, 1);
  // The copy is the pre-split index (parent still present as a single Work group).
  const copied = JSON.parse(fs.readFileSync(path.join(hdir, copies[0]), 'utf8'));
  assert.ok(copied.groups.find((g) => g.name === 'Work'));
});

test('splitParkedGroup returns ok false when the parent is not found', () => {
  const dir = tempDir();
  const env = seedParked(dir);
  const res = splitParkedGroup(
    { name: 'Nope', groups: [{ name: 'Alpha', urls: ['https://a'] }] },
    { env, now: '2026-10-07T00:00:00.000Z' },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /Nope/);
  // The index is left exactly as seeded (Work still a single group).
  const idx = readIndex({ env });
  assert.ok(idx.groups.find((g) => g.name === 'Work'));
  assert.equal(idx.groups.length, 3);
});

test('dispatch split-parked type delegates and returns the result', async () => {
  let seen = null;
  const r = await handle(
    { type: 'split-parked', payload: { name: 'Work', groups: [{ name: 'Alpha', urls: ['https://a'] }] } },
    { splitParkedGroup: (p) => { seen = p; return { ok: true, groups: [{ name: 'Alpha', tabs: 1 }] }; } },
  );
  assert.deepEqual(r, { ok: true, groups: [{ name: 'Alpha', tabs: 1 }] });
  assert.equal(seen.name, 'Work');
  assert.deepEqual(seen.groups, [{ name: 'Alpha', urls: ['https://a'] }]);
});

test('splitGroupLines replaces the parent line and keeps all other lines exactly', () => {
  const text = 'Intro.\n- Before: b\n- Work: old\n- After: a\nTrailing note.';
  const out = splitGroupLines(text, '  work  ', [
    { name: 'Alpha', description: 'alpha stuff' },
    { name: 'Beta', description: 'beta  stuff\nmore' }, // cleaned to one line
  ]);
  assert.equal(
    out,
    'Intro.\n- Before: b\n- Alpha: alpha stuff\n- Beta: beta stuff more\n- After: a\nTrailing note.',
  );
});

test('splitGroupLines cleans a colon out of a sub-group name', () => {
  const out = splitGroupLines('- Work: old', 'Work', [{ name: 'A: B', description: 'd' }]);
  assert.equal(out, '- A B: d');
});

test('splitGroupLines appends after the last group line when the parent has no line', () => {
  const text = 'Intro.\n- Play: games\nTrailing note.';
  const out = splitGroupLines(text, 'Work', [{ name: 'Alpha', description: 'a' }, { name: 'Beta', description: 'b' }]);
  assert.equal(out, 'Intro.\n- Play: games\n- Alpha: a\n- Beta: b\nTrailing note.');
});

test('splitGroupLines appends at the end when there are no group lines yet', () => {
  const out = splitGroupLines('Just a note.', 'Work', [{ name: 'Alpha', description: 'a' }]);
  assert.equal(out, 'Just a note.\n- Alpha: a');
});

function groupsTempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-groups-split-'));
  return path.join(dir, 'groups.md');
}

test('writeGroupSplit writes the split back through the file path', () => {
  const file = groupsTempFile();
  fs.writeFileSync(file, 'Intro.\n- Work: old');
  const res = writeGroupSplit('Work', [{ name: 'Alpha', description: 'a' }, { name: 'Beta', description: 'b' }], {
    env: { BROWSER_SANITY_GROUPS_FILE: file },
  });
  assert.deepEqual(res, { ok: true });
  assert.equal(fs.readFileSync(file, 'utf8'), 'Intro.\n- Alpha: a\n- Beta: b');
});

test('dispatch groups-split writes the split through the real file', async () => {
  const file = groupsTempFile();
  fs.writeFileSync(file, 'Intro.\n- Work: old\n- Play: games');
  const prev = process.env.BROWSER_SANITY_GROUPS_FILE;
  process.env.BROWSER_SANITY_GROUPS_FILE = file;
  try {
    const res = await handle({
      type: 'groups-split',
      payload: { name: 'Work', groups: [{ name: 'Alpha', description: 'a' }, { name: 'Beta', description: 'b' }] },
    });
    assert.deepEqual(res, { ok: true });
    assert.equal(fs.readFileSync(file, 'utf8'), 'Intro.\n- Alpha: a\n- Beta: b\n- Play: games');
  } finally {
    if (prev === undefined) delete process.env.BROWSER_SANITY_GROUPS_FILE;
    else process.env.BROWSER_SANITY_GROUPS_FILE = prev;
  }
});

test('health advertises the split-parked and groups-split message types', async () => {
  const getAdapter = () => ({ name: 'fake', async run() { return ''; }, async health() { return { version: 't' }; } });
  const r = await handle({ type: 'health' }, { getAdapter });
  assert.ok(r.capabilities.types.includes('split-parked'));
  assert.ok(r.capabilities.types.includes('groups-split'));
});

// ---- Someday is the catch-all: splitting it keeps its line ------------------

test('splitGroupLines keeps the Someday line and inserts new lines after it', () => {
  const text = 'Intro.\n- Someday: catch-all\n- Play: games';
  const out = splitGroupLines(text, 'someday', [{ name: 'Alpha', description: 'a' }, { name: 'Beta', description: 'b' }]);
  assert.equal(out, 'Intro.\n- Someday: catch-all\n- Alpha: a\n- Beta: b\n- Play: games');
});

test('splitGroupLines still replaces a non-Someday group', () => {
  const out = splitGroupLines('- Work: old\n- Someday: catch-all', 'Work', [{ name: 'Alpha', description: 'a' }]);
  assert.equal(out, '- Alpha: a\n- Someday: catch-all');
});

// ---- mergeGroupLines --------------------------------------------------------

test('mergeGroupLines drops each from line and keeps the existing into line', () => {
  const text = 'Intro.\n- Homelab: my servers\n- Squad Watch: s\n- hardware: h\n- Play: games';
  const out = mergeGroupLines(text, 'Homelab', ['Squad Watch', 'hardware']);
  assert.equal(out, 'Intro.\n- Homelab: my servers\n- Play: games');
});

test('mergeGroupLines matches names trimmed and case-insensitively', () => {
  const out = mergeGroupLines('- Travel: t\n- Trips: p', '  travel  ', ['TRIPS']);
  assert.equal(out, '- Travel: t');
});

test('mergeGroupLines promotes the first from line to into when into has no line', () => {
  // No "Combined" line exists; the first dropped source (A) is renamed to
  // Combined, keeping A's description and its position.
  const out = mergeGroupLines('- A: alpha\n- B: beta\n- Keep: k', 'Combined', ['A', 'B']);
  assert.equal(out, '- Combined: alpha\n- Keep: k');
});

test('mergeGroupLines ignores a from equal to into and leaves unknown names alone', () => {
  const out = mergeGroupLines('- A: a\n- B: b', 'A', ['A', 'Ghost']);
  assert.equal(out, '- A: a\n- B: b');
});

test('mergeGroupLines on empty text yields empty text', () => {
  assert.equal(mergeGroupLines('', 'A', ['B']), '');
});

// ---- writeGroupMerge --------------------------------------------------------

test('writeGroupMerge writes the merge back through the file path', () => {
  const file = groupsTempFile();
  fs.writeFileSync(file, '- Homelab: servers\n- Squad Watch: s\n- hardware: h');
  const res = writeGroupMerge('Homelab', ['Squad Watch', 'hardware'], {
    env: { BROWSER_SANITY_GROUPS_FILE: file },
  });
  assert.deepEqual(res, { ok: true });
  assert.equal(fs.readFileSync(file, 'utf8'), '- Homelab: servers');
});

test('dispatch merge-parked updates the groups file after a successful merge', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'groups.md');
  fs.writeFileSync(file, '- Homelab: servers\n- Squad Watch: s\n- hardware: h');
  // Seed and park three groups so the real mergeParkedGroups has something to do.
  writeIndex({
    groups: [
      { name: 'Homelab', color: 'green', tabs: [{ title: 'H', url: 'https://h' }] },
      { name: 'Squad Watch', color: 'blue', tabs: [{ title: 'S', url: 'https://s' }] },
      { name: 'hardware', color: 'red', tabs: [{ title: 'HW', url: 'https://hw' }] },
    ],
    ungrouped: [],
  }, { env: { BROWSER_SANITY_INDEX_DIR: dir }, now: '2026-10-01T00:00:00.000Z' });
  writeIndex({ groups: [], ungrouped: [] }, { env: { BROWSER_SANITY_INDEX_DIR: dir }, now: '2026-10-02T00:00:00.000Z' });

  const prevIdx = process.env.BROWSER_SANITY_INDEX_DIR;
  const prevGrp = process.env.BROWSER_SANITY_GROUPS_FILE;
  process.env.BROWSER_SANITY_INDEX_DIR = dir;
  process.env.BROWSER_SANITY_GROUPS_FILE = file;
  try {
    const res = await handle({ type: 'merge-parked', payload: { into: 'Homelab', from: ['Squad Watch', 'hardware'] } });
    assert.equal(res.ok, true);
    assert.equal(fs.readFileSync(file, 'utf8'), '- Homelab: servers', 'the merged-away source lines are gone');
  } finally {
    if (prevIdx === undefined) delete process.env.BROWSER_SANITY_INDEX_DIR;
    else process.env.BROWSER_SANITY_INDEX_DIR = prevIdx;
    if (prevGrp === undefined) delete process.env.BROWSER_SANITY_GROUPS_FILE;
    else process.env.BROWSER_SANITY_GROUPS_FILE = prevGrp;
  }
});
