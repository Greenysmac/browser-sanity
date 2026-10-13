import { test } from 'node:test';
import assert from 'node:assert/strict';
import { antigravityAdapter, resolveCommand } from '../native-host/adapters/antigravity.js';
import { makeFakeSpawn } from './helpers/fake-spawn.js';

test('run passes prompt last, sandboxed, without auto-approving tools', async () => {
  let seen = null;
  const spawnFn = makeFakeSpawn((stdin, command, args) => { seen = { command, args }; return { stdout: '  {"groups":[]}\n' }; });
  const out = await antigravityAdapter.run('PROMPT', { spawnFn });
  assert.equal(out, '{"groups":[]}'); // trimmed, returned raw (JSON extracted downstream)
  assert.equal(seen.args[seen.args.length - 1], 'PROMPT');
  assert.ok(seen.args.includes('--sandbox'));
  assert.ok(seen.args.includes('-p'));
  assert.ok(!seen.args.includes('--dangerously-skip-permissions')); // tools not auto-approved
});

test('BROWSER_SANITY_ANTIGRAVITY_ARGS overrides the flags (prompt still last)', async () => {
  const prev = process.env.BROWSER_SANITY_ANTIGRAVITY_ARGS;
  process.env.BROWSER_SANITY_ANTIGRAVITY_ARGS = '--print --sandbox';
  let seen = null;
  const spawnFn = makeFakeSpawn((stdin, command, args) => { seen = args; return { stdout: '{}' }; });
  await antigravityAdapter.run('PROMPT', { spawnFn });
  // The prompt flag (-p) is appended adjacent to the prompt, after the overridden
  // flags, so an extra flag can never be swallowed as -p's value.
  assert.deepEqual(seen, ['--print', '--sandbox', '-p', 'PROMPT']);
  if (prev === undefined) delete process.env.BROWSER_SANITY_ANTIGRAVITY_ARGS; else process.env.BROWSER_SANITY_ANTIGRAVITY_ARGS = prev;
});

test('health returns the CLI version', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stdout: 'agy 0.4.2\n' }));
  const r = await antigravityAdapter.health({ spawnFn });
  assert.match(r.version, /0\.4\.2/);
});

test('run rejects on non-zero exit with stderr', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stderr: 'boom', code: 1 }));
  await assert.rejects(() => antigravityAdapter.run('x', { spawnFn }), /boom/);
});

test('resolveCommand defaults to agy and honors the env override', () => {
  const prev = process.env.BROWSER_SANITY_ANTIGRAVITY_CMD;
  delete process.env.BROWSER_SANITY_ANTIGRAVITY_CMD;
  assert.equal(resolveCommand(), 'agy');
  process.env.BROWSER_SANITY_ANTIGRAVITY_CMD = '/opt/agy/bin/agy';
  assert.equal(resolveCommand(), '/opt/agy/bin/agy');
  if (prev === undefined) delete process.env.BROWSER_SANITY_ANTIGRAVITY_CMD; else process.env.BROWSER_SANITY_ANTIGRAVITY_CMD = prev;
});

test('extra flags go before -p so the prompt stays the -p value (no splice)', async () => {
  let seen = null;
  const spawnFn = makeFakeSpawn((s, c, args) => { seen = args; return { stdout: '{}' }; });
  await antigravityAdapter.run('PROMPT', { spawnFn, cli: { extraArgs: ['--model', 'gemini-x'] } });
  assert.deepEqual(seen, ['--sandbox', '--model', 'gemini-x', '-p', 'PROMPT']);
});
