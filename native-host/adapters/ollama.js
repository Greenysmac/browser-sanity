// Ollama adapter — fully local models, nothing leaves the machine.
//
// `ollama run <model>` reads the prompt on stdin and prints the response as plain
// text; we return it raw and let the dispatcher extract the JSON the prompt
// requested. No subscription/auth (local); OLLAMA_HOST is passed through for
// users pointing at a remote Ollama server. The model is configurable via
// BROWSER_SANITY_OLLAMA_MODEL (default: llama3.2).
//
// Note: smaller local models follow the strict-JSON instruction less reliably
// than frontier CLIs; the lenient JSON extraction downstream helps, but pick a
// capable instruct model for best results.

import { runCli, cliVersion } from './run-cli.js';
import { hostEnv } from '../config.js';

const ENV_VAR = 'BROWSER_SANITY_OLLAMA_CMD';
const MODEL_VAR = 'BROWSER_SANITY_OLLAMA_MODEL';
const DEFAULT_MODEL = 'llama3.2';
const PASS_ENV = ['OLLAMA_HOST'];

export function resolveCommand() {
  return process.env[ENV_VAR] || 'ollama';
}

export function resolveModel() {
  return process.env[MODEL_VAR] || DEFAULT_MODEL;
}

export const ollamaAdapter = {
  name: 'ollama',
  // The model is chosen host-side (resolveModel); no extra flags are accepted.
  allowedExtraFlags: {},
  async run(prompt, opts = {}) {
    const out = await runCli({
      command: resolveCommand(),
      args: ['run', resolveModel()],
      prompt,
      usesStdin: true,
      env: hostEnv(PASS_ENV),
      timeoutMs: opts.timeoutMs,
      spawnFn: opts.spawnFn,
    });
    return String(out).trim();
  },
  async health(opts = {}) {
    return cliVersion({ command: resolveCommand(), env: hostEnv(PASS_ENV), spawnFn: opts.spawnFn });
  },
};
