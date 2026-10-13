# Privacy: Browser Sanity

_Last updated: 2026-10-12_

Browser Sanity runs a helper program on your own computer. The helper runs the AI backend you chose: an AI command-line tool you've installed and signed into (Claude Code, Antigravity, Kiro, Copilot, Codex, or Ollama), or an OpenAI-style API you configured. That backend sends some of your data to its AI provider, under your own account or key. Choose a local backend (Ollama, or a local OpenAI-style server) and nothing leaves your machine. Browser Sanity has no server and receives none of your data.

- **What it reads:** your open tabs' titles and URLs, and your tab groups.
- **What goes to the AI provider:** tab titles and URLs, and your groups file if you wrote one. Before sending, query strings and fragments are stripped, embedded credentials are removed, and private or loopback hosts are reduced to their origin. Your provider's own policy applies.
- **What stays on your machine:** the index of your groups (`index.json`, `index.md`), its history copies, your groups file, and agent suggestions (`proposals.json`), all in `~/.browser-sanity`; and, in the browser's local storage, your settings, tab activity times, an undo log, and an API key if you entered one, encrypted at rest (AES-GCM). None of it is synced off your device.
- **Bookmarks:** the extension still has the bookmarks permission it inherited from Browser Organizer. Its bookmark tools are hidden and switched off in Browser Sanity. Bookmarks never leave your machine.
- **What it never does:** sell data, run analytics, or send your data to the developer.

Questions: open an issue at https://github.com/Greenysmac/browser-sanity/issues.
