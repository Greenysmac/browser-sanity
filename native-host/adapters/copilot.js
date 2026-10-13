// GitHub Copilot CLI adapter (`copilot`).
//
// `copilot -s --no-ask-user -p "<prompt>"` runs non-interactively and prints
// plain text (`-s` quiets it, `--no-ask-user` prevents pauses), so we return raw
// stdout and let the dispatcher extract the JSON the prompt requested. Auth
// reuses your Copilot subscription via COPILOT_GITHUB_TOKEN / GH_TOKEN /
// GITHUB_TOKEN, or the OAuth token from an existing `gh` login — never inline.
//
// The prompt is the value of `-p`, so it is delivered via promptFlag (kept
// adjacent to the prompt) rather than as a trailing DEFAULT_ARGS entry — that
// way an Advanced extra flag can't be swallowed as -p's value.
//
// SECURITY: Copilot CLI is agentic. `--no-ask-user` prevents interactive pauses
// but the tool policy is the CLI's default — this adapter is LOWER-ASSURANCE than
// claude/ollama. Lock it down for your Copilot CLI version by overriding
// BROWSER_SANITY_COPILOT_ARGS with an explicit tool-deny/read-only flag list.

import { makeCliAdapter } from './cli-adapter.js';

export const copilotAdapter = makeCliAdapter({
  name: 'copilot',
  cmdEnv: 'BROWSER_SANITY_COPILOT_CMD',
  defaultCmd: 'copilot',
  argsEnv: 'BROWSER_SANITY_COPILOT_ARGS',
  defaultArgs: ['-s', '--no-ask-user'],
  promptFlag: '-p',
  authEnv: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
  allowedExtraFlags: { '--model': 'value' },
});

export const resolveCommand = copilotAdapter.resolveCommand;
