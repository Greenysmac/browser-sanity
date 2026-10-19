import { resolveCommand, resolveArgs, hostEnv, extraArgs } from '../config.js';
import { runCli, cliVersion } from './run-cli.js';

// Claude Code headless: pipe the prompt on stdin, read a JSON envelope on stdout.
// Runs in a private temp cwd with tools disabled (see resolveArgs) so it's a pure
// text transform that never touches the user's files. Command/args/env are
// resolved host-side only (../config.js); `opts` may only carry a bounded
// timeoutMs (and spawnFn for tests) — never an executable path, argv, or env.
// Shares runCli/cliVersion with every other CLI adapter so the process-safety
// logic (timeout, SIGKILL settle race, stdout cap, stdin-error handling) lives
// in exactly one place.
// USER lets the claude CLI find its saved login in the macOS keychain; with only
// PATH and HOME it reports "Not logged in" (found 2026-10-07).
const AUTH_ENV = ['USER', 'LOGNAME'];

export const claudeAdapter = {
  name: 'claude',
  // Flags the extension's Advanced settings may add (see config.sanitizeCli).
  // Deliberately narrow: model selection + verbosity, nothing that grants tools,
  // file access, or changes permissions/sandbox.
  allowedExtraFlags: { '--model': 'value', '--fallback-model': 'value', '--verbose': 'bool' },
  async run(prompt, opts = {}) {
    let out;
    try {
      out = await runCli({
        command: resolveCommand(),
        args: [...resolveArgs(opts.cli), ...extraArgs(opts)],
        prompt,
        usesStdin: true,
        env: hostEnv(AUTH_ENV),
        timeoutMs: opts.timeoutMs,
        spawnFn: opts.spawnFn,
      });
    } catch (err) {
      throw signInHint(err);
    }
    return extractResultText(out);
  },
  async health(opts = {}) {
    return cliVersion({ command: resolveCommand(), env: hostEnv(AUTH_ENV), spawnFn: opts.spawnFn });
  },
};

// The Claude CLI's saved login can expire ("OAuth session expired and could not
// be refreshed", 2026-10-19) or be missing ("Not logged in"). The fix is the
// user's: sign in again in a terminal. Say so, and keep the CLI's own words.
const SIGNED_OUT = /failed to authenticate|not logged in|oauth session expired|please run \/login|invalid api key/i;
function signInHint(err) {
  const msg = (err && err.message) || String(err);
  if (!SIGNED_OUT.test(msg)) return err;
  return new Error(`Claude isn't signed in on this computer. Open Terminal, run claude, and sign in, then try again. (${msg})`);
}

export function extractResultText(stdout) {
  const trimmed = String(stdout).trim();
  try {
    const env = JSON.parse(trimmed);
    if (env && typeof env.result === 'string') return env.result;
  } catch {
    // not an envelope — fall through
  }
  return trimmed;
}
