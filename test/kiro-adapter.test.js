import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kiroAdapter, resolveCommand } from '../native-host/adapters/kiro.js';
import { makeFakeSpawn } from './helpers/fake-spawn.js';

test('run invokes `chat --no-interactive --trust-tools= -- <prompt>` (trust no tools)', async () => {
  let seen = null;
  const spawnFn = makeFakeSpawn((stdin, command, args) => { seen = { command, args }; return { stdout: ' {"close":[]} \n' }; });
  const out = await kiroAdapter.run('PROMPT', { spawnFn });
  assert.equal(out, '{"close":[]}');
  assert.deepEqual(seen.args.slice(0, 2), ['chat', '--no-interactive']);
  assert.ok(seen.args.includes('--trust-tools='));       // explicitly trust no tools
  assert.ok(!seen.args.includes('--trust-all-tools'));
  assert.equal(seen.args[seen.args.length - 2], '--');   // end-of-options marker precedes the prompt
  assert.equal(seen.args[seen.args.length - 1], 'PROMPT');
});

test('run inserts `--` before the prompt so a flag-shaped prompt (injection) can never be parsed as a flag', async () => {
  let seen = null;
  const spawnFn = makeFakeSpawn((stdin, command, args) => { seen = { command, args }; return { stdout: 'ok' }; });
  await kiroAdapter.run('--trust-all-tools', { spawnFn });
  const idx = seen.args.indexOf('--');
  assert.ok(idx >= 0, '`--` end-of-options marker must be present');
  assert.equal(seen.args[idx + 1], '--trust-all-tools');
  assert.equal(idx, seen.args.length - 2); // `--` immediately precedes the prompt
});

test('health returns the CLI version', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stdout: 'kiro-cli 2.0.1\n' }));
  const r = await kiroAdapter.health({ spawnFn });
  assert.match(r.version, /2\.0\.1/);
});

test('run rejects on non-zero exit', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stderr: 'auth error', code: 1 }));
  await assert.rejects(() => kiroAdapter.run('x', { spawnFn }), /auth error/);
});

test('resolveCommand defaults to kiro-cli and honors the env override', () => {
  const prev = process.env.BROWSER_SANITY_KIRO_CMD;
  delete process.env.BROWSER_SANITY_KIRO_CMD;
  assert.equal(resolveCommand(), 'kiro-cli');
  process.env.BROWSER_SANITY_KIRO_CMD = '/usr/local/bin/kiro-cli';
  assert.equal(resolveCommand(), '/usr/local/bin/kiro-cli');
  if (prev === undefined) delete process.env.BROWSER_SANITY_KIRO_CMD; else process.env.BROWSER_SANITY_KIRO_CMD = prev;
});
