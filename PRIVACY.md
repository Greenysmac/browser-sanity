# Privacy Policy — Browser Sanity

_Last updated: 2026-07-14_

Browser Sanity runs a helper program on your own computer, which invokes your
locally-installed AI CLI (Claude Code, Antigravity, Kiro, Copilot, Codex, or local Ollama)
or an OpenAI-compatible API endpoint you configure. That backend transmits some of your data
to its AI provider under your own subscription/key — this is not a "stays fully local" tool
unless you choose a local backend (Ollama, or a local OpenAI-compatible server). The
extension operator receives none of this data and operates no server that stores it.

- **What we access:** open tab titles/URLs, bookmarks, browsing-history visit times for
  bookmarked URLs, and HTTP status of bookmarked URLs (for dead-link checks).
- **What is sent to the AI provider:** open tab titles and URLs are sent to your selected
  backend to compute groupings, stale-tab suggestions, and bookmark recommendations. Before
  sending, query strings and fragments are stripped, embedded credentials are removed, and
  private/loopback hosts are reduced to their origin. This happens under your own AI
  subscription/key and is subject to that provider's policy.
- **What stays local:** bookmarks, browsing history, and dead-link HTTP checks are
  processed entirely on your machine and are never sent anywhere.
- **What we store:** your settings, tab-activity timestamps, an undo log, and — if you use
  the OpenAI-compatible API backend — your API key **encrypted at rest** (AES-GCM). All of
  this lives in the browser's local storage on your device and is never synced off it.
- **What we never do:** sell data, run analytics, or transmit your data to the developer.

Contact: hello@lusk.dev

Policy URL: https://lusk.dev/browser-sanity/privacy
