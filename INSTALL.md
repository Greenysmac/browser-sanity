# Installing Browser Sanity

Browser Sanity has two parts:

1. **The extension**, which loads into Chrome or Edge.
2. **A local helper** (a "native host"): a small Node program on your computer that runs your AI backend. The extension talks to it. Nothing goes to any server Browser Sanity runs; there isn't one.

You install both once, from the project folder.

## Step 1: get the code

```
git clone https://github.com/Greenysmac/browser-sanity.git
cd browser-sanity
```

You need [Node.js 20+](https://nodejs.org) for the helper.

## Step 2: load the extension

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension/` folder.

The extension's ID is fixed by the key in its manifest, so it's the same in Chrome and Edge and across reloads.

## Step 3: register the helper

From the project folder:

```
npm run install-host
```

This copies the helper to `~/.browser-sanity` (macOS and Linux) or `%LOCALAPPDATA%\BrowserSanity` (Windows) and registers it for Chrome and Edge. Other forms:

```
node native-host/cli.js install chrome           # one browser
node native-host/cli.js repair                   # re-register a broken install
node native-host/cli.js uninstall                # remove it
```

After updating the code (`git pull`), run `npm run install-host` again and reload the extension.

## Step 4: choose your AI

Click the toolbar icon to open the side panel, then the gear for **Settings**.

- **A Claude subscription:** install [Claude Code](https://claude.com/claude-code) and sign in (`claude` in a terminal). This is the default backend.
- **Another command-line AI:** Antigravity (`agy`), Kiro (`kiro-cli`), GitHub Copilot (`copilot`), OpenAI Codex (`codex`), or Ollama (fully local). Install it, sign in, and pick it in Settings.
- **An OpenAI-style service:** pick it in Settings and enter your API key, plus a base URL and model if it isn't OpenAI (OpenRouter, Poe, Groq, a local LM Studio server and so on). The key is stored encrypted in this browser and never synced. For headless setups you can set `BROWSER_SANITY_OPENAI_API_KEY`, `BROWSER_SANITY_OPENAI_BASE_URL` and `BROWSER_SANITY_OPENAI_MODEL` where the browser starts instead.

Settings has two model slots: one for big sorts (Analyze) and one for quick jobs (sorting one group, descriptions).

## Step 5: use it

- **Open tabs:** click **Analyze**, then **Put into my groups** or **Suggest new groups**. Read the result, click **Apply** (or **Review** to pick), and use **Undo** if you change your mind.
- **Parked groups:** park a group from its ⋯ menu to save and close it; **Open** brings it back. **Re-analyze parked groups** suggests merges and splits; check the ones you want and click **Apply checked**.
- Optional: write your own groups in `~/.browser-sanity/groups.md` (see the README).

## Troubleshooting

- **The panel says it can't reach the helper:** run `npm run install-host` again from the project folder, then click the reload icon on the extension and reopen the panel.
- **The panel says the AI didn't start:** for a command-line AI, check that `<command> --version` works in a terminal and that you're signed in. For an API service, check the key and base URL in Settings.
- **Errors on the extensions page that mention an older version:** Chrome keeps errors until you click **Clear all**.
