import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openaiAdapter, resolveBase, resolveModel, resolveKey, listModels } from '../native-host/adapters/openai.js';
import { getAdapter } from '../native-host/adapters/registry.js';

test('the registry resolves the openai adapter by name', () => {
  assert.equal(getAdapter('openai').name, 'openai');
});

const KEY = 'BROWSER_ORGANIZER_OPENAI_API_KEY';
const BASE = 'BROWSER_ORGANIZER_OPENAI_BASE_URL';
const MODEL = 'BROWSER_ORGANIZER_OPENAI_MODEL';

// Snapshot + restore the three env vars around each test so they don't leak.
function withEnv(vars, fn) {
  const prev = {};
  for (const k of [KEY, BASE, MODEL]) { prev[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, vars);
  return (async () => { try { return await fn(); } finally {
    for (const k of [KEY, BASE, MODEL]) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  } })();
}

function okJson(body) {
  return { ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); } };
}
function errRes(status, text) {
  return { ok: false, status, async json() { return {}; }, async text() { return text; } };
}

test('run/resolvers: UI-entered opts.config wins over env, falls back to env when absent', async () => {
  await withEnv({ [KEY]: 'env-key', [BASE]: 'https://env.example/v1', [MODEL]: 'env-model' }, async () => {
    // resolvers prefer config
    assert.equal(resolveKey({ apiKey: 'ui-key' }), 'ui-key');
    assert.equal(resolveBase({ baseUrl: 'https://ui.example/v1/' }), 'https://ui.example/v1');
    assert.equal(resolveModel({ model: 'ui-model' }), 'ui-model');
    // ...and fall back to env when config is undefined
    assert.equal(resolveKey(), 'env-key');
    assert.equal(resolveModel(), 'env-model');

    let seen = null;
    const fetchFn = (url, opts) => { seen = { url, opts }; return Promise.resolve(okJson({ choices: [{ message: { content: '{}' } }] })); };
    await openaiAdapter.run('p', { fetchFn, config: { apiKey: 'ui-key', baseUrl: 'https://ui.example/v1/', model: 'ui-model' } });
    assert.equal(seen.url, 'https://ui.example/v1/chat/completions');
    assert.equal(seen.opts.headers.Authorization, 'Bearer ui-key');
    assert.equal(JSON.parse(seen.opts.body).model, 'ui-model');
  });
});

test('run posts to chat/completions with bearer auth and returns trimmed content', async () => {
  await withEnv({ [KEY]: 'sk-test' }, async () => {
    let seen = null;
    const fetchFn = (url, opts) => { seen = { url, opts }; return Promise.resolve(okJson({ choices: [{ message: { content: '  {"groups":[]}\n' } }] })); };
    const out = await openaiAdapter.run('PROMPT', { fetchFn });
    assert.equal(out, '{"groups":[]}');
    assert.equal(seen.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(seen.opts.method, 'POST');
    assert.equal(seen.opts.headers.Authorization, 'Bearer sk-test');
    const body = JSON.parse(seen.opts.body);
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.messages[0].content, 'PROMPT');
  });
});

test('run honors base_url (trailing slash stripped) and model overrides', async () => {
  await withEnv({ [KEY]: 'k', [BASE]: 'http://localhost:1234/v1/', [MODEL]: 'llama-3.1-8b' }, async () => {
    let seen = null;
    const fetchFn = (url, opts) => { seen = { url, opts }; return Promise.resolve(okJson({ choices: [{ message: { content: '{}' } }] })); };
    await openaiAdapter.run('p', { fetchFn });
    assert.equal(seen.url, 'http://localhost:1234/v1/chat/completions');
    assert.equal(JSON.parse(seen.opts.body).model, 'llama-3.1-8b');
  });
});

test('run throws when no API key is set', async () => {
  await withEnv({}, async () => {
    await assert.rejects(() => openaiAdapter.run('p', { fetchFn: () => { throw new Error('should not be called'); } }), /API key not set/);
  });
});

test('run throws with status only (never the upstream body) on a non-2xx response', async () => {
  await withEnv({ [KEY]: 'k' }, async () => {
    const fetchFn = () => Promise.resolve(errRes(401, 'Incorrect API key provided'));
    // The upstream body must NOT leak into the error: with a client-chosen baseUrl
    // that would be an SSRF read-back primitive.
    await assert.rejects(() => openaiAdapter.run('p', { fetchFn }), (e) => /OpenAI API 401/.test(e.message) && !/Incorrect API key/.test(e.message));
  });
});

test('run refuses a client baseUrl pointing at a link-local/metadata address', async () => {
  await withEnv({}, async () => {
    const fetchFn = () => { throw new Error('should not be called'); };
    for (const baseUrl of ['http://169.254.169.254/latest', 'http://[::ffff:169.254.169.254]/v1']) {
      await assert.rejects(() => openaiAdapter.run('p', { fetchFn, config: { apiKey: 'k', baseUrl } }), /link-local\/metadata/);
    }
  });
});

test('run throws when the response has no message content', async () => {
  await withEnv({ [KEY]: 'k' }, async () => {
    const fetchFn = () => Promise.resolve(okJson({ choices: [] }));
    await assert.rejects(() => openaiAdapter.run('p', { fetchFn }), /no message content/);
  });
});

test('run maps an aborted request to a timeout error', async () => {
  await withEnv({ [KEY]: 'k' }, async () => {
    const hanging = (url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    });
    await assert.rejects(() => openaiAdapter.run('p', { fetchFn: hanging, timeoutMs: 20 }), /timed out after 20ms/);
  });
});

test('health GETs /models and returns a version; throws on non-2xx / missing key', async () => {
  await withEnv({ [KEY]: 'k', [MODEL]: 'gpt-4o' }, async () => {
    let seen = null;
    const fetchFn = (url, opts) => { seen = { url, method: opts.method }; return Promise.resolve(okJson({ data: [] })); };
    const r = await openaiAdapter.health({ fetchFn });
    assert.equal(seen.url, 'https://api.openai.com/v1/models');
    assert.equal(seen.method, 'GET');
    assert.match(r.version, /openai-compatible \(gpt-4o\)/);
    await assert.rejects(() => openaiAdapter.health({ fetchFn: () => Promise.resolve(errRes(403, 'no')) }), /OpenAI API 403/);
  });
  await withEnv({}, async () => {
    await assert.rejects(() => openaiAdapter.health({ fetchFn: () => {} }), /API key not set/);
  });
});

test('run refuses cleartext http to a non-loopback base, allows loopback http', async () => {
  await withEnv({ [KEY]: 'k', [BASE]: 'http://api.example.com/v1' }, async () => {
    await assert.rejects(() => openaiAdapter.run('p', { fetchFn: () => { throw new Error('should not fetch'); } }), /must be https/);
  });
  await withEnv({ [KEY]: 'k', [BASE]: 'http://127.0.0.1:1234/v1' }, async () => {
    const fetchFn = () => Promise.resolve(okJson({ choices: [{ message: { content: '{}' } }] }));
    assert.equal(await openaiAdapter.run('p', { fetchFn }), '{}'); // loopback http is allowed
  });
});

test('run rejects an over-cap response body (content-length)', async () => {
  await withEnv({ [KEY]: 'k' }, async () => {
    const huge = { ok: true, status: 200, headers: { get: (h) => (h === 'content-length' ? String(50 * 1024 * 1024) : null) }, async json() { return {}; }, async text() { return ''; } };
    await assert.rejects(() => openaiAdapter.run('p', { fetchFn: () => Promise.resolve(huge) }), /exceeded size limit/);
  });
});

test('resolvers apply defaults and env overrides', async () => {
  await withEnv({}, async () => {
    assert.equal(resolveKey(), '');
    assert.equal(resolveBase(), 'https://api.openai.com/v1');
    assert.equal(resolveModel(), 'gpt-4o-mini');
  });
  await withEnv({ [KEY]: 'k', [BASE]: 'https://x.ai/v1//', [MODEL]: 'grok' }, async () => {
    assert.equal(resolveKey(), 'k');
    assert.equal(resolveBase(), 'https://x.ai/v1'); // trailing slashes stripped
    assert.equal(resolveModel(), 'grok');
  });
});

test('resolveKey refuses to pair the host env key with a message-supplied base URL (no exfil)', async () => {
  await withEnv({ [KEY]: 'env-secret-key' }, async () => {
    // Message chose the endpoint but supplied no key → must NOT send the env key there.
    assert.throws(() => resolveKey({ baseUrl: 'https://attacker.example/v1' }), /Refusing to send the host API key/);
    // The adapter run path enforces it too, so no fetch is ever made.
    let called = false;
    const fetchFn = () => { called = true; return Promise.resolve(okJson({ choices: [{ message: { content: '{}' } }] })); };
    await assert.rejects(() => openaiAdapter.run('p', { fetchFn, config: { baseUrl: 'https://attacker.example/v1' } }), /Refusing to send the host API key/);
    assert.equal(called, false, 'no request should be made');
  });
});

test('resolveKey allows a message base URL when the message also supplies its own key', async () => {
  await withEnv({ [KEY]: 'env-secret-key' }, async () => {
    // User points at their own endpoint with their own key — that is fine.
    assert.equal(resolveKey({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'user-own-key' }), 'user-own-key');
  });
  // With no env key set, a message base URL alone just yields no key (normal "key not set" path).
  await withEnv({}, async () => {
    assert.equal(resolveKey({ baseUrl: 'https://x/v1' }), '');
  });
});

test('listModels GETs /models and returns the ids sorted', async () => {
  await withEnv({ [KEY]: 'k' }, async () => {
    let seen = null;
    const fetchFn = (url, opts) => { seen = { url, method: opts.method, headers: opts.headers }; return Promise.resolve(okJson({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }, { id: 'o1' }] })); };
    const ids = await listModels({ fetchFn });
    assert.equal(seen.url, 'https://api.openai.com/v1/models');
    assert.equal(seen.method, 'GET');
    assert.equal(seen.headers.Authorization, 'Bearer k');
    assert.deepEqual(ids, ['gpt-4o', 'gpt-4o-mini', 'o1']); // sorted
  });
});

test('listModels tolerates a response with no data array (returns [])', async () => {
  await withEnv({ [KEY]: 'k' }, async () => {
    const fetchFn = () => Promise.resolve(okJson({}));
    assert.deepEqual(await listModels({ fetchFn }), []);
  });
});

test('listModels throws without a key and reuses the metadata/base guards', async () => {
  await withEnv({}, async () => {
    await assert.rejects(() => listModels({ fetchFn: () => { throw new Error('nope'); } }), /API key not set/);
    // A message-supplied metadata base is refused the same as run()/health().
    await assert.rejects(
      () => listModels({ fetchFn: () => { throw new Error('nope'); }, config: { apiKey: 'k', baseUrl: 'http://169.254.169.254/latest' } }),
      /link-local\/metadata/,
    );
  });
});
