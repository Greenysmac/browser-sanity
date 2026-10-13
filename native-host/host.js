#!/usr/bin/env node
import path from 'node:path';
import { createMessageReader, encodeMessage } from './messaging.js';
import { handle } from './dispatch.js';
import { chooseMode } from './entry.js';

function send(obj) { process.stdout.write(encodeMessage(obj)); }

// A reply's id echoes the request's id. Guard against non-object frames (a bare
// `null`/number/string is valid JSON) so reading `.id` can never throw — that
// would previously escape the handler and crash the whole host.
function msgId(msg) { return msg && typeof msg === 'object' && !Array.isArray(msg) ? msg.id : null; }

// Cap concurrent in-flight requests so a flood of messages can't spawn unbounded
// CLI processes (each can live up to the max timeout). Extra requests queue, but
// the queue itself is bounded (MAX_QUEUE) so a flood can't grow memory without
// limit — past the cap we reject with an error instead of buffering forever.
const MAX_INFLIGHT = 8;
const MAX_QUEUE = 256;

// The native-messaging loop the browser talks to: read length-prefixed frames
// from stdin, dispatch (bounded concurrency), write length-prefixed replies.
function runMessaging() {
  // Backstop: a stray async error must not tear down the connection and drop
  // every in-flight request. Log to stderr (never stdout — that's the wire) and
  // keep serving. The per-request path already has its own try/catch below.
  process.on('unhandledRejection', (err) => { try { process.stderr.write(`[host] unhandledRejection: ${(err && err.stack) || err}\n`); } catch {} });
  process.on('uncaughtException', (err) => { try { process.stderr.write(`[host] uncaughtException: ${(err && err.stack) || err}\n`); } catch {} });

  const reader = createMessageReader();
  const queue = [];
  let inflight = 0;
  let paused = false;
  const pump = () => {
    while (inflight < MAX_INFLIGHT && queue.length) {
      const msg = queue.shift();
      inflight += 1;
      Promise.resolve()
        .then(() => handle(msg))
        .then((result) => send({ id: msgId(msg), ok: true, result }))
        .catch((err) => send({ id: msgId(msg), ok: false, error: String((err && err.message) || err) }))
        .finally(() => { inflight -= 1; pump(); });
    }
    // Resume reading once total pending (queued + in-flight) drains below the cap.
    if (paused && queue.length + inflight < MAX_QUEUE) { paused = false; try { process.stdin.resume(); } catch {} }
  };

  process.stdin.on('data', (chunk) => {
    for (const msg of reader.push(chunk)) {
      if (msg && msg.frameError) { send({ id: null, ok: false, error: `Bad frame: ${msg.frameError}` }); continue; }
      if (queue.length + inflight >= MAX_QUEUE) { send({ id: msgId(msg), ok: false, error: 'Host busy: too many pending requests' }); continue; }
      queue.push(msg);
    }
    // Stop pulling more stdin while total pending is at the cap; pump() resumes us.
    if (!paused && queue.length + inflight >= MAX_QUEUE) { paused = true; try { process.stdin.pause(); } catch {} }
    pump();
  });

  process.stdin.on('end', () => process.exit(0));
}

// When the per-OS installer runs `browser-sanity-host --install`, register the
// host against this very executable. Detect SEA so the manifest points at the
// binary (process.execPath IS the binary) rather than at `node`.
async function runInstaller(mode, argv) {
  const { install, uninstall, runRegistryCommands } = await import('./installer.js');
  let isSea = false;
  try { const sea = await import('node:sea'); isSea = sea.isSea(); } catch { /* not a SEA build */ }
  const rest = argv.filter((a) => !a.startsWith('--'));
  const browsers = (rest[0] || 'chrome,edge').split(',').filter(Boolean);
  // As a SEA binary, target the dir the binary lives in so install() finds the
  // binary there and points the manifest straight at it. Otherwise let install()
  // fall back to its default stable home (the source-copy path).
  const copyTo = isSea ? path.dirname(process.execPath) : undefined;
  const opts = copyTo ? { browsers, copyTo } : { browsers };
  if (mode === 'uninstall') {
    const removed = uninstall(opts);
    // On Windows the browser finds native hosts via the registry, so the
    // manifest file alone is not enough — deregister the keys too. No-op off
    // win32. This is the SEA/.exe (Inno Setup) install path; cli.js does the
    // same for the npm/npx path.
    runRegistryCommands(removed._registryCommands);
    process.stdout.write((removed.length ? 'Removed:\n' + removed.map((f) => '  ' + f).join('\n') : 'Nothing to remove.') + '\n');
  } else {
    const written = install(opts);
    runRegistryCommands(written._registryCommands); // win32: register the host in the registry (no-op elsewhere)
    process.stdout.write('Installed Browser Sanity host:\n' + written.map((f) => '  ' + f).join('\n') + '\n');
  }
}

const { mode } = chooseMode(process.argv.slice(2));
if (mode === 'messaging') runMessaging();
else runInstaller(mode, process.argv.slice(2));
