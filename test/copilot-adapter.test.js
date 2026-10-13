import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copilotAdapter, resolveCommand } from '../native-host/adapters/copilot.js';
import { makeFakeSpawn } from './helpers/fake-spawn.js';

test('run passes prompt last with -s/--no-ask-user/-p and returns trimmed text', async () => {
  let seen = null;
  const spawnFn = makeFakeSpawn((stdin, command, args) => { seen = { command, args }; return { stdout: '  {"groups":[]}\n' }; });
  const out = await copilotAdapter.run('PROMPT', { spawnFn });
  assert.equal(out, '{"groups":[]}');
  assert.deepEqual(seen.args, ['-s', '--no-ask-user', '-p', 'PROMPT']);
});

test('health returns the CLI version', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stdout: 'copilot 1.3.0\n' }));
  const r = await copilotAdapter.health({ spawnFn });
  assert.match(r.version, /1\.3\.0/);
});

test('run rejects on non-zero exit', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stderr: 'not authorized', code: 1 }));
  await assert.rejects(() => copilotAdapter.run('x', { spawnFn }), /not authorized/);
});

test('resolveCommand defaults to copilot and honors the env override', () => {
  const prev = process.env.BROWSER_SANITY_COPILOT_CMD;
  delete process.env.BROWSER_SANITY_COPILOT_CMD;
  assert.equal(resolveCommand(), 'copilot');
  process.env.BROWSER_SANITY_COPILOT_CMD = '/usr/local/bin/copilot';
  assert.equal(resolveCommand(), '/usr/local/bin/copilot');
  if (prev === undefined) delete process.env.BROWSER_SANITY_COPILOT_CMD; else process.env.BROWSER_SANITY_COPILOT_CMD = prev;
});

test('extra flags go before -p so the prompt stays the -p value (no splice)', async () => {
  let seen = null;
  const spawnFn = makeFakeSpawn((s, c, args) => { seen = args; return { stdout: '{}' }; });
  await copilotAdapter.run('PROMPT', { spawnFn, cli: { extraArgs: ['--model', 'gpt'] } });
  assert.deepEqual(seen, ['-s', '--no-ask-user', '--model', 'gpt', '-p', 'PROMPT']);
});
