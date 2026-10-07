// "Where it runs" — a friendlier front for the raw adapter/base settings. A
// provider is a named preset: picking one sets settings.adapter (which host
// adapter speaks the protocol) and settings.openaiBaseUrl (the endpoint the
// openai adapter calls). 'claude' is the Claude Code subscription (its own
// adapter, no base URL); the rest ride the openai adapter against a fixed base.
// 'other' is the escape hatch — it leaves adapter/base alone so the full
// backend dropdown (kiro, codex, copilot, antigravity, ollama CLI, …) stays
// reachable exactly as before.
export const PROVIDERS = {
  claude: { adapter: 'claude', baseUrl: '' },
  poe: { adapter: 'openai', baseUrl: 'https://api.poe.com/v1' },
  openrouter: { adapter: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  openai: { adapter: 'openai', baseUrl: 'https://api.openai.com/v1' },
  // Defaults to Ollama's OpenAI-compatible port; editable for LM Studio (1234)
  // or any other local server, so the base URL stays user-editable for 'local'.
  local: { adapter: 'openai', baseUrl: 'http://localhost:11434/v1' },
};

// Providers whose base URL the user may edit in the UI. For the hosted presets
// the base is fixed (changing it would just be 'other'); 'local' is editable so
// LM Studio / a different port works, and 'other' edits adapter/base directly.
export const EDITABLE_BASE = new Set(['local']);

// The settings patch a provider choice implies. 'other' touches nothing so the
// current adapter/base (and the full backend dropdown) are preserved.
export function providerSettings(provider) {
  const p = PROVIDERS[provider];
  if (!p) return {};
  return { adapter: p.adapter, openaiBaseUrl: p.baseUrl };
}

// Local servers (Ollama, LM Studio, vLLM) ignore the bearer token but the
// openai adapter still refuses to run without one. So for the 'local' provider,
// when the user hasn't stored a key, fall back to the throwaway 'local' — it
// satisfies the adapter and the local server discards it. Hosted providers get
// no such fallback: a missing key there is a real "key not set" error.
export function apiKeyForProvider(provider, storedKey) {
  const key = String(storedKey || '');
  if (key) return key;
  return provider === 'local' ? 'local' : '';
}

// Reverse map: infer which provider a stored { adapter, openaiBaseUrl } pair
// represents, so the form can re-open on the right choice. Falls back to
// 'other' for any backend that isn't one of the presets.
export function providerFor(adapter, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (p.adapter !== adapter) continue;
    if (p.adapter === 'claude') return name; // claude has no base to match
    if (p.baseUrl.replace(/\/+$/, '') === base) return name;
  }
  return 'other';
}
