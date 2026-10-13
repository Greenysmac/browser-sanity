// Antigravity CLI adapter (`agy`) — Google's successor to gemini-cli.
//
// `agy --sandbox -p "<prompt>"` runs non-interactively and prints PLAIN TEXT
// (there is no command-line JSON output mode yet), so we return the raw stdout and
// let the dispatcher's JSON parser extract the JSON the prompt asked for. The
// prompt is the value of `-p`, delivered via promptFlag so an Advanced extra flag
// can't be swallowed as -p's value.
//
// SECURITY: agy is an agentic CLI. We run it with `--sandbox` (terminal
// restrictions) and deliberately do NOT pass `--dangerously-skip-permissions`,
// so a prompt-injected tab title cannot get tools auto-approved. Auth uses the
// user's persisted `agy` login (subscription) or, if set, GEMINI_API_KEY /
// ANTIGRAVITY_API_KEY — never an inline key.

import { makeCliAdapter } from './cli-adapter.js';

export const antigravityAdapter = makeCliAdapter({
  name: 'antigravity',
  cmdEnv: 'BROWSER_SANITY_ANTIGRAVITY_CMD',
  defaultCmd: 'agy',
  argsEnv: 'BROWSER_SANITY_ANTIGRAVITY_ARGS',
  defaultArgs: ['--sandbox'],
  promptFlag: '-p',
  authEnv: ['GEMINI_API_KEY', 'ANTIGRAVITY_API_KEY'],
  allowedExtraFlags: { '--model': 'value' },
});

export const resolveCommand = antigravityAdapter.resolveCommand;
