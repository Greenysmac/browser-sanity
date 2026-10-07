import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGroupsFile, parseGroups, setGroupDescription } from '../native-host/groups-file.js';
import { hostHome } from '../native-host/paths.js';
import { handle } from '../native-host/dispatch.js';

test('loadGroupsFile reads the env-configured path', () => {
  let seen = null;
  const text = loadGroupsFile({
    env: { BROWSER_ORGANIZER_GROUPS_FILE: '/custom/groups.md' },
    readFile: (file) => { seen = file; return '  Work\nPersonal  '; },
  });
  assert.equal(seen, '/custom/groups.md');
  assert.equal(text, 'Work\nPersonal'); // trimmed
});

test('loadGroupsFile defaults to groups.md under the host home', () => {
  let seen = null;
  loadGroupsFile({ env: {}, readFile: (file) => { seen = file; return 'x'; } });
  assert.equal(seen, path.join(hostHome(), 'groups.md'));
});

test('loadGroupsFile returns "" when the file is missing or unreadable', () => {
  const text = loadGroupsFile({ env: {}, readFile: () => { throw new Error('ENOENT'); } });
  assert.equal(text, '');
});

test('loadGroupsFile returns "" for an empty file', () => {
  const text = loadGroupsFile({ env: {}, readFile: () => '   \n  ' });
  assert.equal(text, '');
});

test('loadGroupsFile caps the text at 16000 characters', () => {
  const text = loadGroupsFile({ env: {}, readFile: () => 'a'.repeat(20000) });
  assert.equal(text.length, 16000);
});

function capturingAdapter(cannedOutput) {
  const captured = { prompt: null };
  const getAdapter = () => ({
    name: 'fake',
    async run(prompt) { captured.prompt = prompt; return cannedOutput; },
    async health() { return { version: 'test' }; },
  });
  return { getAdapter, captured };
}

test('dispatch folds the groups file into the group prompt', async () => {
  const { getAdapter, captured } = capturingAdapter('{"groups":[]}');
  await handle(
    { type: 'organize', task: 'group', payload: { tabs: [{ tabId: 1, title: 't', url: 'https://a' }] } },
    { getAdapter, loadGroups: () => 'Work\nPlay' });
  assert.match(captured.prompt, /MY GROUPS \(when a tab fits one of these, use that exact group name\): Work\nPlay/);
});

test('dispatch folds the groups file into the command prompt', async () => {
  const { getAdapter, captured } = capturingAdapter('{"close":[],"groups":[],"important":[]}');
  await handle(
    { type: 'command', payload: { instruction: 'tidy up', tabs: [{ tabId: 1 }] } },
    { getAdapter, loadGroups: () => 'Work\nPlay' });
  assert.match(captured.prompt, /MY GROUPS \(when a tab fits one of these, use that exact group name\): Work\nPlay/);
});

test('dispatch leaves the group prompt unchanged when there is no groups file', async () => {
  const a = capturingAdapter('{"groups":[]}');
  await handle(
    { type: 'organize', task: 'group', payload: { tabs: [{ tabId: 1, title: 't', url: 'https://a' }] } },
    { getAdapter: a.getAdapter, loadGroups: () => '' });
  assert.doesNotMatch(a.captured.prompt, /MY GROUPS/);
});

test('parseGroups returns the name/description of each group line, ignoring free text', () => {
  const text = 'Some intro text.\n- Work: job and projects\n- Play: games & hobbies\nA trailing note.';
  assert.deepEqual(parseGroups(text), [
    { name: 'Work', description: 'job and projects' },
    { name: 'Play', description: 'games & hobbies' },
  ]);
});

test('parseGroups trims the name and description', () => {
  assert.deepEqual(parseGroups('-  Work :  job stuff  '), [{ name: 'Work', description: 'job stuff' }]);
});

test('setGroupDescription replaces an existing group line (name matched trimmed, ignoring case)', () => {
  const text = 'Intro.\n- Work: old\n- Play: games';
  assert.equal(
    setGroupDescription(text, '  work  ', 'new'),
    'Intro.\n- Work: new\n- Play: games');
});

test('setGroupDescription appends a new group line after the last group, before trailing free text', () => {
  const text = 'Intro.\n- Work: job\n- Play: games\nTrailing note.';
  assert.equal(
    setGroupDescription(text, 'Finance', 'bills and budgets'),
    'Intro.\n- Work: job\n- Play: games\n- Finance: bills and budgets\nTrailing note.');
});

test('setGroupDescription keeps free text lines exactly', () => {
  const text = '# My groups\n\nFree text here.\n- Work: job\n\nFooter line.';
  const out = setGroupDescription(text, 'Work', 'updated');
  assert.equal(out, '# My groups\n\nFree text here.\n- Work: updated\n\nFooter line.');
});

test('setGroupDescription collapses newlines in the description to spaces', () => {
  const out = setGroupDescription('- Work: old', 'Work', 'line one\nline two\n\nline three');
  assert.equal(out, '- Work: line one line two line three');
});

test('setGroupDescription caps the description at 500 characters', () => {
  const out = setGroupDescription('', 'Work', 'a'.repeat(600));
  assert.equal(out, `- Work: ${'a'.repeat(500)}`);
});

test('setGroupDescription appends when there are no group lines yet', () => {
  assert.equal(setGroupDescription('Just a note.', 'Work', 'job'), 'Just a note.\n- Work: job');
});

function groupsTempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-groups-'));
  return path.join(dir, 'groups.md');
}

test('dispatch groups-read returns the injected reader output', async () => {
  const groups = [{ name: 'Work', description: 'job' }, { name: 'Play', description: 'games' }];
  const r = await handle({ type: 'groups-read' }, { readGroups: () => groups });
  assert.deepEqual(r, { groups });
});

test('dispatch groups-read reads the env-configured file via the real reader', async () => {
  const file = groupsTempFile();
  fs.writeFileSync(file, 'Intro.\n- Work: job\n- Play: games');
  const prev = process.env.BROWSER_ORGANIZER_GROUPS_FILE;
  process.env.BROWSER_ORGANIZER_GROUPS_FILE = file;
  try {
    const res = await handle({ type: 'groups-read' });
    assert.deepEqual(res, { groups: [{ name: 'Work', description: 'job' }, { name: 'Play', description: 'games' }] });
  } finally {
    if (prev === undefined) delete process.env.BROWSER_ORGANIZER_GROUPS_FILE;
    else process.env.BROWSER_ORGANIZER_GROUPS_FILE = prev;
  }
});

test('dispatch groups-write writes the description back through the file path (a symlink)', async () => {
  const file = groupsTempFile();
  fs.writeFileSync(file, 'Intro.\n- Work: old');
  // Point a symlink at the real file; writing through it must update the target.
  const link = `${file}.link`;
  fs.symlinkSync(file, link);
  const prev = process.env.BROWSER_ORGANIZER_GROUPS_FILE;
  process.env.BROWSER_ORGANIZER_GROUPS_FILE = link;
  try {
    const res = await handle({ type: 'groups-write', payload: { name: 'Work', description: 'new\ndesc' } });
    assert.deepEqual(res, { ok: true });
    assert.equal(fs.readFileSync(file, 'utf8'), 'Intro.\n- Work: new desc');
    assert.ok(fs.lstatSync(link).isSymbolicLink()); // the symlink itself is preserved
  } finally {
    if (prev === undefined) delete process.env.BROWSER_ORGANIZER_GROUPS_FILE;
    else process.env.BROWSER_ORGANIZER_GROUPS_FILE = prev;
  }
});

test('health advertises the groups-read and groups-write message types', async () => {
  const getAdapter = () => ({ name: 'fake', async run() { return ''; }, async health() { return { version: 't' }; } });
  const r = await handle({ type: 'health' }, { getAdapter });
  assert.ok(r.capabilities.types.includes('groups-read'));
  assert.ok(r.capabilities.types.includes('groups-write'));
});

