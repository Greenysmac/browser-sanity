// OpenAI-compatible Chat Completions adapter (`openai`).
//
// Unlike the CLI adapters this one talks HTTP from the native host — but it keeps
// the exact same security invariant: the API key, base URL, and model are all
// resolved HOST-SIDE from environment variables (set by the operator/installer),
// never from an extension message. A single base_url makes this work against
// OpenAI, OpenRouter, Groq, Together, LM Studio, vLLM, and any other endpoint
// that speaks the /chat/completions shape.
//
//   BROWSER_SANITY_OPENAI_API_KEY   required — bearer token (host env only)
//   BROWSER_SANITY_OPENAI_BASE_URL  default https://api.openai.com/v1
//   BROWSER_SANITY_OPENAI_MODEL     default gpt-4o-mini
//
// Returns the assistant message text raw; the dispatcher extracts the JSON the
// prompt asked for (same lenient path as the CLI adapters).

const KEY_VAR = 'BROWSER_SANITY_OPENAI_API_KEY';
const BASE_VAR = 'BROWSER_SANITY_OPENAI_BASE_URL';
const MODEL_VAR = 'BROWSER_SANITY_OPENAI_MODEL';
const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT = 120000;
const HEALTH_TIMEOUT = 10000;

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // mirror the CLI adapters' output cap

// Config precedence: the UI-entered value (passed in the message, host-sanitized)
// wins, then the host env var, then the built-in default. cfg is opts.config.
//
// SECURITY: the base URL can come from the (untrusted) message. NEVER pair a
// message-supplied base URL with the host's own env key — that would let a
// compromised extension exfiltrate the operator's key by pointing the request at
// its own server. If the message chose the endpoint, it must also supply the key.
export function resolveKey(cfg) {
  if (cfg && cfg.baseUrl && !cfg.apiKey && process.env[KEY_VAR]) {
    throw new Error('Refusing to send the host API key to a client-supplied base URL. Enter your API key in the extension, or set the endpoint host-side via BROWSER_SANITY_OPENAI_BASE_URL.');
  }
  return (cfg && cfg.apiKey) || process.env[KEY_VAR] || '';
}
export function resolveBase(cfg) { return ((cfg && cfg.baseUrl) || process.env[BASE_VAR] || DEFAULT_BASE).replace(/\/+$/, ''); }
export function resolveModel(cfg) { return (cfg && cfg.model) || process.env[MODEL_VAR] || DEFAULT_MODEL; }

// Link-local / cloud-metadata endpoints (169.254.0.0/16, incl. AWS/GCP/Azure
// 169.254.169.254 and its IPv4-mapped IPv6 form). Loopback and LAN stay allowed
// so a user can point at LM Studio / vLLM, but a metadata address is never a
// legitimate model endpoint — refuse it even when the base came from a message.
function isMetadataHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^169\.254\./.test(h)) return true;
  if (h.includes(':')) {
    const m = h.match(/(?::ffff:|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (m && /^169\.254\./.test(m[1])) return true;
    const hex = h.match(/:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex && /^::ffff:/.test(h) && (parseInt(hex[1], 16) >> 8) === 169 && (parseInt(hex[1], 16) & 0xff) === 254) return true;
  }
  return false;
}

// Refuse to send the bearer key over cleartext http, except to loopback (local
// servers like LM Studio / vLLM). Returns the validated base URL.
function checkedBase(cfg) {
  const base = resolveBase(cfg);
  let u;
  try { u = new URL(base); } catch { throw new Error(`Invalid ${BASE_VAR}: ${base}`); }
  if (isMetadataHost(u.hostname)) throw new Error(`${BASE_VAR} must not point at a link-local/metadata address (${u.hostname})`);
  const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1';
  if (u.protocol === 'http:' && !loopback) {
    throw new Error(`${BASE_VAR} must be https:// (refusing to send the API key over cleartext http to ${u.hostname})`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${BASE_VAR} must be http(s): ${base}`);
  return base;
}

// Read a response body with a hard size cap so a hostile/broken upstream can't
// exhaust host memory. Streams when possible; falls back to text() otherwise.
async function readCappedJson(res) {
  const declared = Number(res.headers && res.headers.get && res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('OpenAI API response exceeded size limit');
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_RESPONSE_BYTES) { try { await reader.cancel(); } catch {} throw new Error('OpenAI API response exceeded size limit'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error('OpenAI API response exceeded size limit');
  return JSON.parse(text);
}

function authHeaders(key) {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// fetch with an AbortController timeout. fetchFn is injectable for tests.
async function fetchWithTimeout(fetchFn, url, options, timeoutMs) {
  if (typeof fetchFn !== 'function') throw new Error('global fetch unavailable — the native host needs Node 18+');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`OpenAI API timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const openaiAdapter = {
  name: 'openai',
  async run(prompt, opts = {}) {
    const cfg = opts.config;
    const key = resolveKey(cfg);
    if (!key) throw new Error('OpenAI API key not set — add it in Settings (or set BROWSER_SANITY_OPENAI_API_KEY).');
    const fetchFn = opts.fetchFn || globalThis.fetch;
    const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;
    const body = JSON.stringify({
      model: resolveModel(cfg),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0, // deterministic-ish: we want strict JSON, not creativity
    });
    const res = await fetchWithTimeout(fetchFn, `${checkedBase(cfg)}/chat/completions`, { method: 'POST', headers: authHeaders(key), body }, timeoutMs);
    // Don't relay the upstream response body into the error: with a client-chosen
    // baseUrl that would turn a bad status into an SSRF read-back primitive.
    if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
    const data = await readCappedJson(res);
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string') throw new Error('OpenAI API returned no message content');
    return content.trim();
  },
  async health(opts = {}) {
    const cfg = opts.config;
    const key = resolveKey(cfg);
    if (!key) throw new Error('OpenAI API key not set — add it in Settings (or set BROWSER_SANITY_OPENAI_API_KEY).');
    const fetchFn = opts.fetchFn || globalThis.fetch;
    const res = await fetchWithTimeout(fetchFn, `${checkedBase(cfg)}/models`, { method: 'GET', headers: authHeaders(key) }, HEALTH_TIMEOUT);
    if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
    return { version: `openai-compatible (${resolveModel(cfg)})` };
  },
};

// List the model ids the configured endpoint offers (GET <base>/models). Reuses
// the same host-side resolution and SSRF/cleartext guards as run()/health() via
// checkedBase + resolveKey, so a client-chosen base can't exfiltrate the host
// key or hit a metadata address. Returns the ids sorted; a response without a
// data array yields []. Shape mirrors the OpenAI { data: [{ id }, …] } body.
export async function listModels(opts = {}) {
  const cfg = opts.config;
  const key = resolveKey(cfg);
  if (!key) throw new Error('OpenAI API key not set — add it in Settings (or set BROWSER_SANITY_OPENAI_API_KEY).');
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const timeoutMs = opts.timeoutMs || HEALTH_TIMEOUT;
  const res = await fetchWithTimeout(fetchFn, `${checkedBase(cfg)}/models`, { method: 'GET', headers: authHeaders(key) }, timeoutMs);
  if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
  const data = await readCappedJson(res);
  const list = (data && Array.isArray(data.data)) ? data.data : [];
  const ids = list.map((m) => m && m.id).filter((id) => typeof id === 'string');
  return ids.sort();
}
