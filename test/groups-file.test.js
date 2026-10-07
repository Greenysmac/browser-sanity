import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadGroupsFile } from '../native-host/groups-file.js';
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

