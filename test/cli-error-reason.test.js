import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeAdapter } from '../native-host/adapters/claude.js';
import { runCli } from '../native-host/adapters/run-cli.js';
import { makeFakeSpawn } from './helpers/fake-spawn.js';

// Found 2026-10-19: the Claude CLI's login expired and the panel showed
// "Couldn't sort your tabs: CLI exited 1:" with nothing after it. Claude writes
// its error into the JSON envelope on stdout, not stderr, so the reason was lost.
const EXPIRED = JSON.stringify({
  type: 'result', is_error: true, terminal_reason: 'api_error',
  result: 'Failed to authenticate: OAuth session expired and could not be refreshed',
});

test('a failed CLI with empty stderr reports the reason from its JSON envelope', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stdout: EXPIRED, code: 1 }));
  await assert.rejects(() => runCli({ command: 'x', args: [], spawnFn }), /CLI exited 1: Failed to authenticate: OAuth session expired/);
});

test('a failed CLI with empty stderr and plain stdout reports the stdout text', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stdout: 'something broke\n', code: 2 }));
  await assert.rejects(() => runCli({ command: 'x', args: [], spawnFn }), /CLI exited 2: something broke$/);
});

test('stderr still wins when the CLI wrote one', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stdout: EXPIRED, stderr: 'boom', code: 1 }));
  await assert.rejects(() => runCli({ command: 'x', args: [], spawnFn }), /CLI exited 1: boom$/);
});

test('the reason taken from stdout is capped', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stdout: 'x'.repeat(10000), code: 1 }));
  await assert.rejects(() => runCli({ command: 'x', args: [], spawnFn }), (err) => err.message.length < 600);
});

test('an expired Claude login tells the user how to sign in again', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stdout: EXPIRED, code: 1 }));
  await assert.rejects(() => claudeAdapter.run('x', { spawnFn }), (err) => {
    assert.match(err.message, /isn't signed in/);
    assert.match(err.message, /run claude/);
    assert.match(err.message, /OAuth session expired/); // the CLI's own words stay visible
    return true;
  });
});

test('"Not logged in" from Claude gets the same sign-in hint', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stdout: JSON.stringify({ is_error: true, result: 'Not logged in · Please run /login' }), code: 1 }));
  await assert.rejects(() => claudeAdapter.run('x', { spawnFn }), /isn't signed in/);
});

test('other Claude failures are not dressed up as sign-in problems', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stderr: 'boom', code: 1 }));
  await assert.rejects(() => claudeAdapter.run('x', { spawnFn }), (err) => !/signed in/.test(err.message) && /boom/.test(err.message));
});
