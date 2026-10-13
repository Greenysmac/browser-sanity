// Kiro CLI adapter — AWS Kiro's terminal agent.
//
// `kiro-cli chat --no-interactive "<prompt>"` runs headlessly and prints plain
// text, so we return raw stdout and let the dispatcher's JSON parser extract the
// JSON the prompt requested. The prompt is a trailing positional arg (Kiro reads
// its instruction from argv; stdin is treated as extra context). SECURITY: we pass
// `--trust-tools=` (empty) to explicitly trust NO tools, so a prompt-injected
// tab title cannot get Kiro to run commands or touch the filesystem. Headless
// auth uses KIRO_API_KEY (a subscription-scoped key for Kiro Pro+).

import { makeCliAdapter } from './cli-adapter.js';

export const kiroAdapter = makeCliAdapter({
  name: 'kiro',
  cmdEnv: 'BROWSER_SANITY_KIRO_CMD',
  defaultCmd: 'kiro-cli',
  argsEnv: 'BROWSER_SANITY_KIRO_ARGS',
  defaultArgs: ['chat', '--no-interactive', '--trust-tools='],
  authEnv: ['KIRO_API_KEY'],
  allowedExtraFlags: { '--model': 'value' },
});

export const resolveCommand = kiroAdapter.resolveCommand;
