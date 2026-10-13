import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ollamaAdapter, resolveCommand, resolveModel } from '../native-host/adapters/ollama.js';
import { makeFakeSpawn } from './helpers/fake-spawn.js';

test('run pipes the prompt on stdin to `run <model>` and returns trimmed text', async () => {
  let seen = null;
  const spawnFn = makeFakeSpawn((stdin, command, args) => { seen = { stdin, command, args }; return { stdout: ' {"close":[]} \n' }; });
  const out = await ollamaAdapter.run('PROMPT', { spawnFn });
  assert.equal(out, '{"close":[]}');
  assert.equal(seen.stdin, 'PROMPT');           // prompt sent via stdin, not arg
  assert.deepEqual(seen.args, ['run', 'llama3.2']);
});

test('resolveModel honors the model env override', () => {
  const prev = process.env.BROWSER_SANITY_OLLAMA_MODEL;
  delete process.env.BROWSER_SANITY_OLLAMA_MODEL;
  assert.equal(resolveModel(), 'llama3.2');
  process.env.BROWSER_SANITY_OLLAMA_MODEL = 'qwen2.5:14b';
  assert.equal(resolveModel(), 'qwen2.5:14b');
  if (prev === undefined) delete process.env.BROWSER_SANITY_OLLAMA_MODEL; else process.env.BROWSER_SANITY_OLLAMA_MODEL = prev;
});

test('health returns the CLI version', async () => {
  const spawnFn = makeFakeSpawn(() => ({ stdout: 'ollama version is 0.5.4\n' }));
  const r = await ollamaAdapter.health({ spawnFn });
  assert.match(r.version, /0\.5\.4/);
});

test('resolveCommand defaults to ollama and honors the env override', () => {
  const prev = process.env.BROWSER_SANITY_OLLAMA_CMD;
  delete process.env.BROWSER_SANITY_OLLAMA_CMD;
  assert.equal(resolveCommand(), 'ollama');
  process.env.BROWSER_SANITY_OLLAMA_CMD = '/usr/local/bin/ollama';
  assert.equal(resolveCommand(), '/usr/local/bin/ollama');
  if (prev === undefined) delete process.env.BROWSER_SANITY_OLLAMA_CMD; else process.env.BROWSER_SANITY_OLLAMA_CMD = prev;
});
