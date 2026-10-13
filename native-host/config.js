import os from 'node:os';

const DEFAULT_TIMEOUT = 300000; // 5 min: a full re-sort of 500+ tabs can take over 2 (2026-10-07)
const MAX_TIMEOUT = 300000;
const MIN_TIMEOUT = 1000;

// The CLI binary is resolved from a host-controlled env var (set by the
// installer) or defaults to the PATH lookup 'claude'. NEVER from a message.
export function resolveCommand() {
  return process.env.BROWSER_SANITY_CLI || 'claude';
}

// `cli` is the sanitized Advanced-settings object (see sanitizeCli). Default
// (both toggles off) skips loading MCP servers and on-disk settings/plugins — a
// pure, fast text transform. Turning a toggle on restores that loading.
export function resolveArgs(cli = {}) {
  const args = ['-p', '--output-format', 'json', '--allowedTools', ''];
  if (!cli.loadMcpServers) args.push('--strict-mcp-config'); // no MCP servers
  if (!cli.loadPluginsSettings) args.push('--setting-sources', ''); // no on-disk settings/plugins/hooks
  return args;
}

// Advanced-settings CLI controls supplied by the extension UI. The host is the
// trust boundary and the extension is UNTRUSTED, so extraArgs is validated
// against a per-adapter ALLOWLIST (not a denylist): only the exact flags an
// adapter opts into are accepted, and a value flag's value may not itself start
// with '-' (no flag smuggling). Anything else drops the whole set. This closes
// the argv-injection class where a short/config flag (e.g. codex `-s`/`-c`)
// could override an adapter's single safety flag. Flags are always passed as
// argv (never a shell). loadMcpServers/loadPluginsSettings only gate our flags.
//
// `allowed` maps flag name -> 'value' (consumes the next token) | 'bool'.
// Extensibility comes from the `prompt` passthrough task, not from letting the
// extension pass arbitrary CLI flags, so these allowlists stay deliberately small.
const MAX_EXTRA_ARGS = 24;
const MAX_ARG_LEN = 200;
// Reject C0 control characters (\x00-\x1f) in any token.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f]/;

function tokenizeExtraArgs(src) {
  // Slice BEFORE map/filter so a huge caller-supplied array can't force O(n)
  // work before it's bounded down to MAX_EXTRA_ARGS.
  const list = (Array.isArray(src) ? src : (typeof src === 'string' ? src.split(/\s+/) : [])).slice(0, MAX_EXTRA_ARGS);
  return list.map((s) => String(s == null ? '' : s)).filter(Boolean);
}

export function sanitizeCli(raw, allowed = {}) {
  const out = {
    loadMcpServers: raw && raw.loadMcpServers === true,
    loadPluginsSettings: raw && raw.loadPluginsSettings === true,
    extraArgs: [],
  };
  const tokens = tokenizeExtraArgs(raw && raw.extraArgs);
  const accepted = [];
  let i = 0;
  let bad = false;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.length > MAX_ARG_LEN || CONTROL_CHARS.test(t) || !t.startsWith('-')) { bad = true; break; }
    const eq = t.indexOf('=');
    const name = eq >= 0 ? t.slice(0, eq) : t;
    const spec = allowed[name];
    if (spec === undefined) { bad = true; break; } // not on this adapter's allowlist
    if (eq >= 0) {
      if (spec !== 'value') { bad = true; break; } // inline =value only for value flags
      accepted.push(t);
      i += 1;
    } else if (spec === 'value') {
      const val = tokens[i + 1];
      // A value that starts with '-' is a missing value or a smuggled flag.
      if (val === undefined || val.startsWith('-') || val.length > MAX_ARG_LEN || CONTROL_CHARS.test(val)) { bad = true; break; }
      accepted.push(t, val);
      i += 2;
    } else { // 'bool'
      accepted.push(t);
      i += 1;
    }
  }
  if (bad) { out.rejected = true; return out; } // drop the whole set
  out.extraArgs = accepted;
  return out;
}

// The user's (already-sanitized) extra CLI flags for the current adapter, appended
// to its base args. Empty unless Advanced settings provided some.
export function extraArgs(opts) {
  return opts && opts.cli && Array.isArray(opts.cli.extraArgs) ? opts.cli.extraArgs : [];
}

// A private, per-run working directory (mode 0700) — created by the adapter.
export function tmpBase() {
  return os.tmpdir();
}

// Host-controlled args override: an operator can tune/lock down an adapter's
// flags (e.g. a version whose sandbox flag differs) by setting an env var. The
// override is a space-separated flag list; the prompt is always appended last by
// the adapter. Env is host-side only — never taken from an extension message.
export function overrideArgs(envVar, defaults) {
  const v = process.env[envVar];
  return v ? v.split(/\s+/).filter(Boolean) : defaults;
}

// A minimal, host-controlled environment for spawned CLIs: always PATH and HOME
// (needed for PATH resolution and persisted login credentials), plus any named
// auth vars the adapter declares (e.g. GEMINI_API_KEY, KIRO_API_KEY). Env is
// never taken from an extension message.
export function hostEnv(extraNames = []) {
  const env = {};
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  if (process.env.HOME !== undefined) env.HOME = process.env.HOME;
  for (const name of extraNames) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

// Only a bounded timeout may come from the message; everything else is discarded.
// Out-of-range/invalid values fall back to the default; values above the max
// are clamped down to the max (deviation from the plan's draft implementation,
// which clamped low values up to MIN_TIMEOUT instead of falling back to the
// default — that contradicted the plan's own test expectations).
export function sanitizeOptions(raw) {
  const t = Number(raw && raw.timeoutMs);
  if (!Number.isFinite(t) || t < MIN_TIMEOUT) return { timeoutMs: DEFAULT_TIMEOUT };
  return { timeoutMs: Math.min(MAX_TIMEOUT, t) };
}

// The ONLY per-request config a message may carry, and only for the HTTP `openai`
// adapter: the user's own API key / base URL / model entered in the extension UI.
// Everything else (command, args, cwd, env for CLI adapters) stays host-resolved
// and can never come from a message. Each field is validated to a non-empty string;
// unknown fields are dropped.
const MAX_CONFIG_LEN = 4096; // generous for a key/URL/model; bounds retained memory per request
export function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  for (const k of ['apiKey', 'baseUrl', 'model']) {
    if (typeof raw[k] === 'string' && raw[k] && raw[k].length <= MAX_CONFIG_LEN) out[k] = raw[k];
  }
  return Object.keys(out).length ? out : undefined;
}
