# Installing Browser Sanity

Browser Sanity has two parts:
1. **The extension** — loads into Chrome or Edge.
2. **A local helper** ("native host") — a small program on your computer that runs your AI
   backend. The extension talks to it; **nothing is sent to any server we run.**

You install both once. Pick the backend that suits you — the easiest is an **OpenAI-compatible
API key** (no CLI to install); power users can point it at a local AI CLI instead.

---

## Step 1 — Install the extension

**Chrome / Edge (unpacked, from this repo or the self-host bundle):**
1. Download and unzip the self-host bundle (or clone this repo).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the `extension/` folder.
5. The extension **ID** is fixed by the manifest's pinned key (same in Chrome and Edge, and
   across reloads), so Step 2 already knows it — you don't need to copy it down.

_(When published, this step becomes a one-click install from the Web Store / Edge Add-ons.)_

## Step 2 — Install the local helper

Pick whichever fits you:

**A. One command (needs [Node.js 20+](https://nodejs.org)) — works from any directory:**

```
npx browser-sanity-host
```

That copies the helper into a stable per-user location and registers it for Chrome and Edge
using the published extension ID — no need to be inside any project folder. Target specific
browsers with `npx browser-sanity-host install chrome`, repair a broken install
with `… repair`, and remove it with `… uninstall`.

> **`npm install -g` is not enough on its own.** A global (or local) `npm install` only puts
> the `browser-sanity-host` command on your PATH — it does **not** register the helper
> (there's no postinstall step). If you install that way, you must then run the command once to
> register it:
> ```sh
> npm install -g browser-sanity-host
> browser-sanity-host
> ```
> `npx` is simpler because it fetches **and runs** the installer in one step. Either way, the
> register step copies the current version into the stable location the browser launches, so
> after installing a new version you must re-run it to update the registered helper — and use
> `@latest` (or a pinned version) so `npx` doesn't reuse a cached older one:
> ```sh
> npx browser-sanity-host@latest
> ```

**B. No Node / prefer a double-click:** download the installer for your OS from the
[releases page](https://github.com/Greenysmac/browser-sanity/releases) and run it. It ships
a self-contained helper (no Node required) and registers it for Chrome and Edge. On Windows
this is `BrowserSanitySetup.exe` — a **per-user** install (no admin rights).

**B2. Windows administrators (per-machine MSI):** for fleet deployment, use
`BrowserSanity.msi` instead of the EXE. It installs the helper under `Program Files` and
registers the native-messaging host in **HKLM** so every user on the machine can reach it
(requires elevation). It supports silent install and standard `msiexec` deployment flags
(each line below is a complete, copy-pasteable command):

```
msiexec /i BrowserSanity.msi /qn /norestart
msiexec /i BrowserSanity.msi /qn /l*v install.log
msiexec /i BrowserSanity.msi INSTALLFOLDER="C:\Apps\BrowserSanity" /qn
msiexec /i BrowserSanity.msi EDGE=0 /qn
msiexec /i BrowserSanity.msi CHROME=0 /qn
msiexec /i BrowserSanity.msi CHROMIUM=1 /qn
msiexec /x BrowserSanity.msi /qn
```

In order: silent install; silent install with a verbose log; install to a custom folder;
register Chrome only (`EDGE=0`); register Edge only (`CHROME=0`); also register Chromium
(`CHROMIUM=1`); uninstall. Public properties: `INSTALLFOLDER`, `CHROME` (default 1), `EDGE`
(default 1), `CHROMIUM` (default 0). The host is registered in both the 64-bit and 32-bit
registry hives, so 32- and 64-bit browsers both find it. Deploy via GPO, Intune, or SCCM; a
newer MSI upgrades an older install in place. (The MSI is per-machine; the EXE/npx paths are
per-user — don't mix them.)

**C. From a cloned repo / self-host bundle (developers):**

```
node native-host/installer.js                                  # install (pinned ID + chrome,edge)
node native-host/installer.js <EXTENSION_ID> chrome,edge       # or: explicit ID, then browsers
node native-host/installer.js uninstall                        # remove
```

The helper is copied to `~/.browser-sanity` (macOS/Linux) or
`%LOCALAPPDATA%\BrowserSanity` (Windows), so the repo or bundle can be deleted afterward.

## Step 3 — Choose and configure a backend

Open the extension's side panel (click the toolbar icon) → **Settings → AI backend**.

**Easiest — OpenAI-compatible API (no CLI):**
Pick **OpenAI-compatible API** in Settings and enter your **API key** there (plus an
optional base URL and model). The key is stored **encrypted** in this browser only
(never synced). Point the base URL at OpenAI, OpenRouter, Groq, or a local
LM Studio/vLLM server. _(Advanced/headless: you can instead set
`BROWSER_SANITY_OPENAI_API_KEY` / `_BASE_URL` / `_MODEL` in the host environment.)_

**Power users — a local AI CLI:**
Install and sign into one of: Claude Code (`claude`), Antigravity (`agy`), Kiro (`kiro-cli`),
GitHub Copilot (`copilot`), OpenAI Codex (`codex`), or Ollama (fully local). Select it in
Settings. See `README.md` → **AI backends** for the exact command/auth per CLI.

## Step 4 — Use it

Click **Analyze my tabs & bookmarks**, review the suggestions, and apply the ones you want
(everything is undoable). Or type a request like `org close everything about travel` in the
address bar, or enable scheduled auto-mode in Settings.

---

## Privacy & safety
- Tab titles and URLs (query strings/fragments stripped, private hosts coarsened, embedded
  credentials removed) are sent **only** to the AI provider you configured, under your own
  subscription/key. Bookmarks and history never leave your machine.
- The helper only ever runs the fixed backend you selected; the command, arguments, and
  credentials are resolved on your machine and can't be supplied by a web page or the
  extension. See [`docs/security-model.md`](docs/security-model.md).

## Troubleshooting
- **Panel says it can't reach the helper** — re-run Step 2 (e.g.
  `npx browser-sanity-host repair`), then click the reload icon on the extension
  and reopen the panel.
- **Panel says the backend didn't start** — for a CLI, confirm `"<cli> --version"` works in a
  terminal; for the API backend, confirm the env vars above are set where the browser launches.
