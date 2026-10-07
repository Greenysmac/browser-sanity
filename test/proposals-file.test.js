import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProposals } from '../native-host/proposals-file.js';
import { handle } from '../native-host/dispatch.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'borg-proposals-'));
}

function write(dir, content) {
  fs.writeFileSync(path.join(dir, 'proposals.json'), content);
}

test('loadProposals reads a present proposals.json, keeping groups/close and the note', () => {
  const dir = tempDir();
  write(dir, JSON.stringify({
    from: 'Mycroft',
    note: 'tidy up',
    groups: [{ name: 'Private AI', color: 'purple', urls: ['https://a'] }],
    close: [{ url: 'https://b', reason: 'duplicate' }],
  }));
  const r = loadProposals({ env: { BROWSER_ORGANIZER_INDEX_DIR: dir } });
  assert.equal(r.from, 'Mycroft');
  assert.equal(r.note, 'tidy up');
  assert.deepEqual(r.groups, [{ name: 'Private AI', color: 'purple', urls: ['https://a'] }]);
  assert.deepEqual(r.close, [{ url: 'https://b', reason: 'duplicate' }]);
});

test('loadProposals returns the empty shape when the file is missing', () => {
  const dir = tempDir(); // no file written
  const r = loadProposals({ env: { BROWSER_ORGANIZER_INDEX_DIR: dir } });
  assert.deepEqual(r, { groups: [], close: [] });
});

test('loadProposals returns the empty shape on invalid JSON', () => {
  const dir = tempDir();
  write(dir, '{ not valid json');
  const r = loadProposals({ env: { BROWSER_ORGANIZER_INDEX_DIR: dir } });
  assert.deepEqual(r, { groups: [], close: [] });
});

test('loadProposals returns the empty shape when the parsed value is not an object', () => {
  const dir = tempDir();
  write(dir, '[1,2,3]');
  const r = loadProposals({ env: { BROWSER_ORGANIZER_INDEX_DIR: dir } });
  assert.deepEqual(r, { groups: [], close: [] });
});

test('loadProposals tolerates missing/wrong-typed groups and close arrays', () => {
  const dir = tempDir();
  write(dir, JSON.stringify({ note: 'x', groups: 'nope' })); // groups not an array, no close
  const r = loadProposals({ env: { BROWSER_ORGANIZER_INDEX_DIR: dir } });
  assert.deepEqual(r.groups, []);
  assert.deepEqual(r.close, []);
  assert.equal(r.note, 'x');
});

test('dispatch proposals type returns the loaded proposals', async () => {
  const canned = { from: 'Mycroft', note: 'hi', groups: [{ name: 'G', urls: ['https://a'] }], close: [] };
  const r = await handle({ type: 'proposals' }, { loadProposals: () => canned });
  assert.deepEqual(r, canned);
});

test('dispatch proposals falls back to the empty shape via the real loader when none configured', async () => {
  const dir = tempDir(); // no file → empty shape
  const prev = process.env.BROWSER_ORGANIZER_INDEX_DIR;
  process.env.BROWSER_ORGANIZER_INDEX_DIR = dir;
  try {
    const r = await handle({ type: 'proposals' });
    assert.deepEqual(r, { groups: [], close: [] });
  } finally {
    if (prev === undefined) delete process.env.BROWSER_ORGANIZER_INDEX_DIR;
    else process.env.BROWSER_ORGANIZER_INDEX_DIR = prev;
  }
});

test('health advertises the proposals message type', async () => {
  const getAdapter = () => ({ name: 'fake', async run() { return ''; }, async health() { return { version: 't' }; } });
  const r = await handle({ type: 'health' }, { getAdapter });
  assert.ok(r.capabilities.types.includes('proposals'));
});
