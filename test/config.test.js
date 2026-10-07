import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommand, resolveArgs, sanitizeOptions, sanitizeConfig, sanitizeCli, extraArgs } from '../native-host/config.js';

test('sanitizeCli allows only allowlisted flags, and reads toggles', () => {
  const allow = { '--model': 'value', '--verbose': 'bool' };
  assert.deepEqual(sanitizeCli({ extraArgs: '--model x --verbose' }, allow).extraArgs, ['--model', 'x', '--verbose']);
  assert.deepEqual(sanitizeCli({ extraArgs: '--model=x' }, allow).extraArgs, ['--model=x']); // inline =value form
  // Not on the allowlist → whole set dropped.
  assert.equal(sanitizeCli({ extraArgs: '--dangerously-skip-permissions' }, allow).rejected, true);
  assert.deepEqual(sanitizeCli({ extraArgs: '--sandbox danger' }, allow).extraArgs, []);
  assert.deepEqual(sanitizeCli({ extraArgs: ['--mcp-config', 'x.json'] }, allow).extraArgs, []);
  // No allowlist (default {}) rejects everything with args.
  assert.equal(sanitizeCli({ extraArgs: '--model x' }).rejected, true);
  const t = sanitizeCli({ loadMcpServers: true, loadPluginsSettings: false });
  assert.equal(t.loadMcpServers, true);
  assert.equal(t.loadPluginsSettings, false);
  assert.deepEqual(t.extraArgs, []);
});

test('sanitizeCli blocks the argv-injection bypasses (allowlist, no flag smuggling)', () => {
  // codex's own sandbox/config overrides that defeated the old denylist:
  const codexAllow = { '--model': 'value' };
  for (const evil of [
    ['-s', 'danger-full-access'],                    // codex short --sandbox
    ['-c', 'sandbox_mode="danger-full-access"'],     // codex config override
    ['--config', 'approval_policy="never"'],
    ['--append-system-prompt', 'pwn'],
    ['--sandbox', 'x'],
    ['-C', '/etc'],
  ]) {
    const r = sanitizeCli({ extraArgs: evil }, codexAllow);
    assert.equal(r.rejected, true, `should reject ${JSON.stringify(evil)}`);
    assert.deepEqual(r.extraArgs, []);
  }
  // A value flag whose "value" is actually a smuggled flag is rejected (no
  // "--model --sandbox danger" turning --sandbox into a real flag).
  assert.equal(sanitizeCli({ extraArgs: ['--model', '--sandbox'] }, codexAllow).rejected, true);
  // A bare positional (stray value with no flag) is rejected.
  assert.equal(sanitizeCli({ extraArgs: ['danger-full-access'] }, codexAllow).rejected, true);
  // Over-long token and control chars are rejected.
  assert.equal(sanitizeCli({ extraArgs: ['--model', 'x'.repeat(500)] }, codexAllow).rejected, true);
  assert.equal(sanitizeCli({ extraArgs: ['--model', 'a\tb'] }, codexAllow).rejected, true); // control char (tab)
});

test('resolveArgs toggles MCP/settings flags; extraArgs reads opts.cli', () => {
  assert.ok(resolveArgs().includes('--strict-mcp-config'));               // default: MCP off
  assert.ok(resolveArgs().includes('--setting-sources'));                 // default: settings off
  const on = resolveArgs({ loadMcpServers: true, loadPluginsSettings: true });
  assert.ok(!on.includes('--strict-mcp-config') && !on.includes('--setting-sources'));
  assert.deepEqual(extraArgs({ cli: { extraArgs: ['--x'] } }), ['--x']);
  assert.deepEqual(extraArgs({}), []);
});

test('resolveCommand defaults to claude and honors env override', () => {
  const prev = process.env.BROWSER_ORGANIZER_CLI;
  delete process.env.BROWSER_ORGANIZER_CLI;
  assert.equal(resolveCommand(), 'claude');
  process.env.BROWSER_ORGANIZER_CLI = '/opt/claude/bin/claude';
  assert.equal(resolveCommand(), '/opt/claude/bin/claude');
  if (prev === undefined) delete process.env.BROWSER_ORGANIZER_CLI; else process.env.BROWSER_ORGANIZER_CLI = prev;
});

test('resolveArgs returns headless json args and disables tools', () => {
  const args = resolveArgs();
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('--output-format') && args.includes('json'));
});

test('sanitizeOptions keeps only a bounded timeoutMs and drops everything else', () => {
  const s = sanitizeOptions({ timeoutMs: 5000, command: '/bin/sh', args: ['-c', 'rm -rf /'], env: { LD_PRELOAD: 'x' }, cwd: '/tmp' });
  assert.deepEqual(Object.keys(s).sort(), ['timeoutMs']);
  assert.equal(s.timeoutMs, 5000);
});

test('sanitizeOptions clamps out-of-range or bad timeout to default', () => {
  assert.equal(sanitizeOptions({ timeoutMs: -1 }).timeoutMs, 300000);
  assert.equal(sanitizeOptions({ timeoutMs: 9_999_999 }).timeoutMs, 300000);
  assert.equal(sanitizeOptions({}).timeoutMs, 300000);
  assert.equal(sanitizeOptions(null).timeoutMs, 300000);
});

test('sanitizeConfig keeps only apiKey/baseUrl/model strings, drops anything executable', () => {
  assert.deepEqual(
    sanitizeConfig({ apiKey: 'sk-1', baseUrl: 'https://x/v1', model: 'gpt', command: 'rm -rf /', env: { X: 1 } }),
    { apiKey: 'sk-1', baseUrl: 'https://x/v1', model: 'gpt' },
  );
  assert.deepEqual(sanitizeConfig({ apiKey: 'k', model: 123, baseUrl: '' }), { apiKey: 'k' });
  assert.equal(sanitizeConfig({}), undefined);
  assert.equal(sanitizeConfig(null), undefined);
  assert.equal(sanitizeConfig('nope'), undefined);
  assert.equal(sanitizeConfig({ command: 'x', args: ['y'] }), undefined);
});

test('sanitizeConfig rejects over-long fields', () => {
  const ok = sanitizeConfig({ apiKey: 'k'.repeat(4096), model: 'm' });
  assert.equal(ok.apiKey.length, 4096);
  const capped = sanitizeConfig({ apiKey: 'k'.repeat(4097), model: 'm' });
  assert.equal(capped.apiKey, undefined); // dropped
  assert.equal(capped.model, 'm');
});
