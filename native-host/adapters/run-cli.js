// Shared spawn helper for CLI adapters (antigravity, kiro, and any future
// adapters). Mirrors the isolation guarantees of the Claude adapter: a private
// per-run working directory, a stdout size cap, a timeout with settle-before-kill,
// and a host-controlled environment. The command and args are always resolved by
// the adapter (host-side) — never from an extension message.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_MAX_STDOUT = 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_STDERR = 1 * 1024 * 1024; // 1 MB — diagnostic only; truncate, don't kill

// SIGKILL the child AND its descendants. Agentic CLIs fork helpers; on a timeout
// a plain child.kill leaves those grandchildren orphaned. On POSIX we spawn the
// child detached (its own process group) and signal the whole group via -pid;
// Windows has no cheap group kill here, so fall back to killing the child.
function killTree(child) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch { try { child.kill('SIGKILL'); } catch {} }
}

// Some CLIs (Claude with --output-format json) report a failure in their normal
// output, not on stderr. Without this the user saw "CLI exited 1:" and nothing
// else when the Claude login expired (found 2026-10-19). Takes the JSON
// envelope's `result` when there is one, else the raw text, capped.
const MAX_REASON = 400;
function failureFromStdout(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return '';
  try {
    const env = JSON.parse(text);
    if (env && typeof env.result === 'string' && env.result.trim()) return env.result.trim().slice(0, MAX_REASON);
  } catch {
    // not JSON; use the text
  }
  return text.slice(0, MAX_REASON);
}

// Runs a CLI once and resolves with its raw stdout (string). If `usesStdin` is
// true the prompt is piped to stdin; otherwise stdin is closed empty (the prompt
// is expected to already be in `args`).
export async function runCli({ command, args, prompt = '', usesStdin = false, env, timeoutMs = 120000, spawnFn = spawn, maxStdout = DEFAULT_MAX_STDOUT, maxStderr = DEFAULT_MAX_STDERR }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-'));
  try {
    return await new Promise((resolve, reject) => {
      let child;
      // detached on POSIX makes the child a group leader so killTree can reap the
      // whole tree; harmless where spawnFn is a test mock (no real pid/group).
      try { child = spawnFn(command, args, { cwd, env, detached: process.platform !== 'win32' }); }
      catch (err) { reject(err); return; }

      // Collect stdout as raw Buffer chunks and decode ONCE at the end. Decoding
      // each chunk independently (stdout += buf) turns a multibyte UTF-8 char
      // split across a chunk boundary into U+FFFD replacement characters.
      const outChunks = [];
      let outLen = 0;
      let stderr = '';
      let done = false;
      const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(timer); fn(arg); } };
      const timer = setTimeout(() => {
        finish(reject, new Error(`CLI timed out after ${timeoutMs}ms`));
        killTree(child);
      }, timeoutMs);

      child.stdout.on('data', (d) => {
        const buf = Buffer.isBuffer(d) ? d : Buffer.from(d);
        outChunks.push(buf);
        outLen += buf.length;
        if (outLen > maxStdout) {
          finish(reject, new Error('CLI output exceeded size limit'));
          killTree(child);
        }
      });
      // Cap stderr so a CLI spewing to stderr can't exhaust host memory. Unlike
      // stdout this is only diagnostic, so truncate (precisely, even for one big
      // chunk) and keep running rather than kill.
      child.stderr.on('data', (d) => { if (stderr.length < maxStderr) stderr += String(d).slice(0, maxStderr - stderr.length); });
      child.on('error', (err) => finish(reject, err));
      // A CLI that dies before reading stdin makes the write below emit EPIPE on
      // the stdin stream; without this listener Node throws it uncaught and the
      // whole native host process crashes, killing every in-flight request.
      if (child.stdin && typeof child.stdin.on === 'function') child.stdin.on('error', (err) => finish(reject, err));
      child.on('close', (code) => {
        const stdout = Buffer.concat(outChunks).toString('utf8');
        if (code === 0) finish(resolve, stdout);
        else finish(reject, new Error(`CLI exited ${code}: ${stderr.trim() || failureFromStdout(stdout)}`));
      });

      if (usesStdin) { child.stdin.write(prompt); child.stdin.end(); }
      else if (child.stdin) { child.stdin.end(); }
    });
  } finally {
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
  }
}

// Runs `<command> <versionArgs>` and resolves { version }.
export async function cliVersion({ command, versionArgs = ['--version'], env, spawnFn = spawn, timeoutMs = 10000, maxStdout = 64 * 1024 }) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    let child;
    try { child = spawnFn(command, versionArgs, { env, detached: process.platform !== 'win32' }); }
    catch (err) { reject(err); return; }
    let done = false;
    const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(timer); fn(arg); } };
    const timer = setTimeout(() => { finish(reject, new Error('version check timed out')); killTree(child); }, timeoutMs);
    // Cap stdout so a chatty/hostile version command can't grow host memory.
    child.stdout.on('data', (d) => {
      const buf = Buffer.isBuffer(d) ? d : Buffer.from(d);
      if (len < maxStdout) { chunks.push(buf.subarray(0, maxStdout - len)); len += buf.length; }
    });
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => code === 0 ? finish(resolve, { version: Buffer.concat(chunks).toString('utf8').trim() }) : finish(reject, new Error(`version check exited ${code}`)));
    if (child.stdin) child.stdin.end();
  });
}
