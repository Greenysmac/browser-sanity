import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerSettings, providerFor, apiKeyForProvider, EDITABLE_BASE } from '../extension/lib/providers.js';

test('each provider maps to the right adapter and base URL', () => {
  assert.deepEqual(providerSettings('claude'), { adapter: 'claude', openaiBaseUrl: '' });
  assert.deepEqual(providerSettings('poe'), { adapter: 'openai', openaiBaseUrl: 'https://api.poe.com/v1' });
  assert.deepEqual(providerSettings('openrouter'), { adapter: 'openai', openaiBaseUrl: 'https://openrouter.ai/api/v1' });
  assert.deepEqual(providerSettings('openai'), { adapter: 'openai', openaiBaseUrl: 'https://api.openai.com/v1' });
  assert.deepEqual(providerSettings('local'), { adapter: 'openai', openaiBaseUrl: 'http://localhost:11434/v1' });
});

test("'other' touches nothing so the existing backend dropdown stays in control", () => {
  assert.deepEqual(providerSettings('other'), {});
  assert.deepEqual(providerSettings('nonsense'), {});
});

test('only the local provider has an editable base URL (hosted presets are fixed)', () => {
  assert.equal(EDITABLE_BASE.has('local'), true);
  for (const p of ['claude', 'poe', 'openrouter', 'openai']) assert.equal(EDITABLE_BASE.has(p), false);
});

test('providerFor infers the provider from a stored adapter + base pair', () => {
  assert.equal(providerFor('claude', ''), 'claude');
  assert.equal(providerFor('openai', 'https://api.poe.com/v1'), 'poe');
  assert.equal(providerFor('openai', 'https://openrouter.ai/api/v1/'), 'openrouter'); // trailing slash tolerated
  assert.equal(providerFor('openai', 'http://localhost:11434/v1'), 'local');
  assert.equal(providerFor('openai', 'https://api.openai.com/v1'), 'openai');
});

test("providerFor falls back to 'other' for a CLI backend or an unknown base", () => {
  assert.equal(providerFor('kiro', ''), 'other');
  assert.equal(providerFor('ollama', ''), 'other');
  assert.equal(providerFor('openai', 'https://some.custom.endpoint/v1'), 'other');
});

test('local provider falls back to the throwaway key when none is stored', () => {
  assert.equal(apiKeyForProvider('local', ''), 'local');       // no stored key → sentinel
  assert.equal(apiKeyForProvider('local', undefined), 'local');
  assert.equal(apiKeyForProvider('local', 'my-key'), 'my-key'); // a real stored key still wins
});

test('hosted providers get no key fallback — a missing key stays missing', () => {
  for (const p of ['openai', 'poe', 'openrouter', 'claude']) assert.equal(apiKeyForProvider(p, ''), '');
});
