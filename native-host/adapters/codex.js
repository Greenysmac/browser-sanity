// OpenAI Codex CLI adapter (`codex`).
//
// `codex exec "<prompt>"` runs the agent headlessly and prints its final message
// as plain text (no interactive TUI). `--skip-git-repo-check` avoids the git-repo
// requirement since we run in a private temp dir. We return raw stdout and let
// the dispatcher extract the JSON the prompt requested. Auth uses your persisted
// ChatGPT login (Plus/Pro/Business) or OPENAI_API_KEY / CODEX_API_KEY — never inline.
//
// SECURITY: codex exec is agentic. We pin `--sandbox read-only` so a prompt-
// injected tab title cannot make it write files or run networked commands.
// (read-only still permits local reads — tighten via BROWSER_SANITY_CODEX_ARGS
// against your codex version if needed.) The prompt is a trailing positional arg.

import { makeCliAdapter } from './cli-adapter.js';

export const codexAdapter = makeCliAdapter({
  name: 'codex',
  cmdEnv: 'BROWSER_SANITY_CODEX_CMD',
  defaultCmd: 'codex',
  argsEnv: 'BROWSER_SANITY_CODEX_ARGS',
  defaultArgs: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check'],
  authEnv: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  // Advanced-settings flags the extension may add (config.sanitizeCli). Only model
  // selection — nothing that can override this adapter's sandbox/safety flags.
  allowedExtraFlags: { '--model': 'value' },
});

export const resolveCommand = codexAdapter.resolveCommand;
