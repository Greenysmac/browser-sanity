// Single source of truth for the CLI-backed adapters whose binary path the
// installer bakes into the launcher. Add a new CLI adapter here (and register its
// module in registry.js) and both the launcher path-baking and the install docs
// pick it up — no scattered edits across install.js.
//
// The HTTP `openai` adapter is intentionally absent: it needs no binary path
// (its endpoint/key are separate env vars resolved at request time).
export const CLI_ADAPTERS = [
  { name: 'claude', bin: 'claude', cmdEnv: 'BROWSER_SANITY_CLI' },
  { name: 'antigravity', bin: 'agy', cmdEnv: 'BROWSER_SANITY_ANTIGRAVITY_CMD' },
  { name: 'kiro', bin: 'kiro-cli', cmdEnv: 'BROWSER_SANITY_KIRO_CMD' },
  { name: 'copilot', bin: 'copilot', cmdEnv: 'BROWSER_SANITY_COPILOT_CMD' },
  { name: 'codex', bin: 'codex', cmdEnv: 'BROWSER_SANITY_CODEX_CMD' },
  { name: 'ollama', bin: 'ollama', cmdEnv: 'BROWSER_SANITY_OLLAMA_CMD' },
];
