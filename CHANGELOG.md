# Changelog

## 0.3.2 — 2026-10-07
**Run 7 (Kiro, three tasks, all first try; reviewed by Mycroft)**: the declutter.
- One line per group (color, name, count, a dot when a description suggestion waits) with a ⋯ menu: Sort this group, Park or Close group, Add back parked tabs, Description…; parked rows: Open, Description…. Section headers show counts.
- The side panel shows only the header, the Sort card, the result card and your groups; Update index, Agent suggestions, the extra tools, sessions and muted items live in a More view (⋯ in the header). The connection line shows only when something's wrong.
- The new-tab page uses the same rows in columns, with just the title, the filter and Open side panel on top.

## 0.3.1 — 2026-10-07
**Run 6 (Kiro, four tasks, all first try; reviewed by Mycroft)** after Park lost two groups' records on Jeff's machine (recovered by Mycroft).
- Park merges into a saved group instead of replacing it; an empty Park never shrinks a record; Park closes the whole group, new-tab pages included. Mycroft tested on a copy of the real index: 139 stays 139 after an empty Park, 140 after a Park with one new tab.
- The helper keeps dated copies of the index (newest 50) and can restore one; bad names refused.
- Live boards: redraw as tabs and groups change; counts are web tabs; groups with no web pages offer Close group; a parked twin of an open group offers Add them back.
- Panel cleanup: Sort tabs label, readable model names, one model select with Other, Run one inside More tools, Settings as its own view, the suggestions count inside the result card.

## 0.3.0 — 2026-10-07
**Run 5 (Kiro, six tasks, all first try; reviewed by Mycroft)**
- A reopened group shows as open, never as parked (index reads Chrome's pending address; the board hides a parked card when that group is open).
- Two model slots: big sorts (default Claude Sonnet 5.5) and quick jobs (default Claude Haiku 4.5); per-request model for Claude, per-slot model for OpenAI-style services. Fresh installs suggest only grouping, re-sorting and duplicates.
- Runs on: Claude subscription, Poe, OpenRouter, OpenAI, a local model, or Other; Load models lists what the service offers.
- Settings redesign: AI first, What to suggest, More (folded), Advanced.
- Main panel redesign: header with version, one Sort tabs button with This window / All windows / Selected tabs, a one-line result with Apply and Review, the board, More tools folded.
- Suggested descriptions on the board, saved only on Save.
- Known gap: the browser end-to-end tests (e2e/) were written for the old layout and haven't been run against this one.

## 0.2.2 — 2026-10-07
**Security fix by Mycroft (from a background security review of run 4)**
- Model-written group descriptions are suggestions only. The helper's 'describe' no longer writes the groups file: tab titles are untrusted page text, and the groups file goes back into every later prompt as rules, so a crafted page title could otherwise plant lasting instructions. Only an explicit Save ('groups-write') stores a description.
- Suggestions are kept only for groups that were asked about (no new group names from model output), flattened to one line, stripped of control characters, capped at 200 characters. Tests cover an injection-style title.
- index.md now says its tab titles are untrusted page text, for any agent that reads it.

## 0.2.1 — 2026-10-07
**Run 4 (Kiro, reviewed by Mycroft)**
- "Open side panel" button on the new-tab board; "Sort this group" there opens the panel so the suggestions show. (Task 1 failed once, was reverted and logged, and passed on try 2.)
- Missing group descriptions are written by the model, one sentence each, at most once a day per group; existing descriptions are never overwritten. Held back: the helper with this feature isn't installed yet, because it would also describe the old ATO groups and add them to the groups file; 0.3.0 changes it to show a suggested description that Jeff saves.

## 0.2.0 Browser Sanity — 2026-10-07
Jeff's fork of Browser Organizer 0.1.8, renamed Browser Sanity. Built by Kiro in three unattended runs (Mycroft's runner: revert on a failed try, three tries then stop), each reviewed by Mycroft.

**Run 1 (2026-10-06)**
- The helper reads a groups file (`groups.md` in the helper's folder) and sends it with every request, so tabs land in Jeff's need-based groups.
- Tab data carries each tab's current group; grouping reuses existing group names; up to 15 groups when a groups file is loaded.
- Applying a group adds tabs to an existing group of the same name instead of making a duplicate.
- Setting: Re-sort tabs already in groups.

**Fixes by Mycroft (2026-10-07)**
- Claude backend: pass USER so the CLI finds its saved login (it said "Not logged in" from Chrome).
- Helper time limit 5 minutes (big re-sorts ran past 2).

**Run 2 (2026-10-07)**
- Groups apply before duplicate tabs close; tabs that are gone are skipped.
- Tabs already in the right group stay where they are, so Jeff's order inside a group survives.
- The index: `index.md` and `index.json` in the helper's folder list every group and its tabs; Update index button; index written after every apply.
- Suggestions from Mycroft or any agent through `proposals.json`, shown in the normal list for approval.
- Tools and a Settings button at the top of the panel.

**Run 3 (2026-10-07)**
- Undo returns moved tabs to the group they came from.
- Parked: the index keeps groups Jeff puts away; groups a re-sort emptied are dropped.
- Park and Open from the index.
- Group descriptions, read and written in the groups file the model reads.
- Sort one group, or just the selected tabs.
- The board: Open now and Parked sections, cards with Sort, Park, Open and a description, in the side panel and as the new-tab page.

**Rename (2026-10-07):** Browser Organizer is now Browser Sanity (name, panel, new-tab page, index title).

## 0.1.8 — 2026-09-22
UX/UI refresh, accessibility enhancements (WCAG 2.1 AA), and native host packaging for npm.

**User Experience & Layout**
- **Slim sticky app header**: Compact 44px sticky top bar preserving brand identity, undo shortcut, and animated progress bar while freeing vertical viewing space for suggestions.
- **Plan controls & export**: Reorganized `#planTools` into a responsive 2-row layout with segmented button controls and moved "Export as Markdown" into the contextual action bar.
- **Categorized settings**: Structured 15+ flat settings into carded `<fieldset>` groups with clean section legends.
- **Open tabs bulk management**: Added "Select all" and "None" bulk controls above the open tabs list.
- **Empty state guidance**: Added friendly suggestion placeholder when no items are queued.

**Accessibility & Safety**
- **Touch device discoverability**: Made `.itemIgnore` ("Never suggest this") discoverable with a visible baseline (0.85 opacity, 32px touch target) on touchscreens.
- **Screen reader protection**: Separated live status announcer from 1-second interval elapsed timer to prevent speech flooding (WCAG 4.1.3).
- **Destructive action confirmations**: Added modal confirmations to session deletion and "Reset learning" wipes, plus Escape key support in inline session renaming.
- **Non-color state encoding**: Added icon prefixes (`✓` and `⚠`) to backend health banners (WCAG 1.4.1).
- **Toast timing**: Added pause-on-hover and pause-on-focus to the undo toast auto-dismiss timer (WCAG 2.2.1).

## 0.1.7 — 2026-09-20
Comprehensive reliability and bug-fix release addressing 11 findings from a systematic codebase audit across the extension and native host.

**Fixes & Reliability**
- **Session saving window context (FIND-01)**: `saveCurrentWindowSession` now accepts explicit `windowId`, forwards the originating sidepanel window, handles missing window states gracefully, and falls back to `windows.getLastFocused` instead of throwing an unhandled `TypeError`.
- **Windows CLI argument length guard (FIND-02)**: Added Win32 character length limit (28,000 chars) in `cli-adapter.js` to catch oversized prompts before `child_process.spawn` fails with `EINVAL` due to the OS 32 KB command-line limit.
- **Native host installer arguments & repair (FIND-03 & FIND-07)**: `install()` and `repair()` in `installer.js` now default `browsers` safely so direct calls without parameters don't crash with `TypeError`. Normalized CLI entry argument parsing to flexibly accept both `[extensionId] [browsers]` and `[browsers] [extensionId]`.
- **Undo history UX (FIND-04)**: Separated Close and Undo actions in the undo dialog; the Close button now safely dismisses the dialog without executing pending reversals, and a dedicated "Undo selected" button applies the checked reversals.
- **OpenAI API key management (FIND-05)**: Added a "Clear key" button to the settings panel under the OpenAI configuration, allowing users to remove their stored encrypted API key.
- **Bookmark Bar protection on creation (FIND-06)**: `createBookmark` and safety bookmarks created before closing tabs now honor `protectBookmarkBar` and route new folders to `otherId` ("Other Bookmarks") by default rather than polluting the Bookmarks Bar.
- **Tab activity leak prevention (FIND-08)**: Added a `chrome.tabs.onRemoved` listener in `activity-tracker.js` to clean closed tab IDs from `storage.local.tabActivity` under mutex serialization.
- **Advanced CLI settings merge (FIND-09)**: `setSettings` now deep-merges `advancedCli.extraArgs` so updating settings for one AI adapter preserves custom flags configured for other adapters.

**Internal & Maintenance**
- **Cleaned orphan exports and magic strings (FIND-10)**: Imported and used `OTHER_ID` constant in `plan.js` and `executor.js`, removed redundant re-exports in `orchestrator.js`, and cleaned unused `extraArgs` handling in `ollama.js`.
- **Installer version synchronization (FIND-11)**: Synchronized Inno Setup fallback `AppVersion` to `0.1.7`.

## 0.1.6-beta — 2026-08-27
A systematic security/code audit across the extension and native host, plus a UX pass on the
side panel. Pre-release.

**Security**
- Bookmark-folder/whitelist protections (`protectBookmarkBar`, `protectedFolders`, whitelist)
  are now re-validated against *live* settings at apply time, not just when a plan is built — a
  plan sitting unreviewed could previously execute a `moveBookmark`/`removeFolder` against a
  protection the user added after the plan was generated.
- The `codex`/`kiro` CLI adapters now insert a `--` end-of-options marker before a bare
  positional prompt, so a flag-shaped prompt (via the `prompt` passthrough task) can no longer
  be parsed as a real CLI flag and defeat their sandbox args.
- `runtime.onMessage`/`onConnect` now reject anything not from the extension's own `sender.id`
  (defense-in-depth ahead of any future content-script/`externally_connectable` surface).
- An optional host permission (`<all_urls>`, npm registry) is now revoked once the feature that
  needed it is turned off, instead of held indefinitely.
- Generated native-host launcher scripts (`run.sh`/`run.bat`) reject resolved CLI paths
  containing shell/batch metacharacters instead of interpolating them unescaped.
- Bumped `js-yaml` and `brace-expansion` to close two high-severity DoS advisories in the dev
  toolchain (eslint's config-resolution chain — not shipped in the packaged extension or host).

**Fixes**
- Fixed a sandbox-escape bug where a win32-simulated install/e2e test run could silently write
  outside its isolated temp directory on non-Windows machines.
- The settings panel's CSS grid had no explicit column sizing, so several fields (Extra CLI
  flags, Never-touch folders, Protected domains) were silently clipped at real side-panel
  widths. Fixed the underlying grid sizing, not just the symptom.
- Numeric settings fields (stale-tab/bookmark days, undo retention) now clamp to a safe minimum
  instead of silently saving `0` when the field is cleared.
- Apply buttons now show a busy state during the apply call instead of remaining clickable with
  no feedback.
- The side panel's first-paint sequence is now fault-isolated per step, so one step failing
  (e.g. a storage/crypto error) can't silently leave the rest of the panel uninitialized.

**Internal**
- `sidepanel.js` split into focused per-feature view modules (was a single 906-line file).
- Extracted shared folder/whitelist protection logic into `extension/lib/protections.js` so
  plan-build time and apply time enforce identical rules from one implementation.

## 0.1.5 — 2026-07-19
Security hardening of the native host + an extension-only extensibility path.

**Security**
- **`extraArgs` is now a per-adapter allowlist, not a denylist.** A compromised extension
  could previously slip short/config flags past the denylist (e.g. codex `-s danger-full-access`
  or `-c sandbox_mode=…`) and override an agentic CLI's single safety flag. Only each adapter's
  explicitly-allowed flags are accepted now, and a value flag's value may not itself start with
  `-` (no flag smuggling).
- **OpenAI adapter no longer sends the host's env API key to a message-supplied base URL.** That
  combination could exfiltrate an operator-configured key; the endpoint and key must now come
  from the same source.
- A malformed message (`null` / non-object frame) is rejected cleanly instead of crashing the
  host, and top-level `unhandledRejection`/`uncaughtException` guards keep the connection alive.

**Robustness**
- `stderr` is size-capped (was unbounded); on timeout the whole process tree is killed on POSIX
  (not just the direct child); concurrent in-flight requests are capped.

**Extensibility**
- New `prompt` passthrough task: the extension can run a client-supplied prompt and get the raw
  (optionally JSON-parsed) model output back, so new AI features ship without a host edit.
- The health response now advertises `capabilities` (types, tasks, passthrough, adapters) so the
  extension can feature-detect instead of probing for "Unknown task" errors.

## 0.1.4 — 2026-07-19
Organize fixes for Edge + Advanced settings.

**Fixes**
- **Organize now works on Edge (and any Chromium with non-Chrome root ids).** Root folder
  ids are read from the live tree instead of assuming Chrome's `1/2/3` — Edge's "Other
  favourites" is `203` (plus a `722` "Workspaces" root), so its loose bookmarks were being
  skipped. New folders now land under the real "Other bookmarks" root.
- Move suggestions show their **destination folder as a chip** (leaf name, full path on hover)
  instead of a redundant sentence.
- Organize no longer reports a misleading "looks tidy" when it actually produced nothing —
  it says why (no candidates / model returned nothing / moves matched no bookmark / all moves
  skipped by a protection / the helper is out of date).

**Features**
- **Advanced settings** (warning-gated): debug logging; Claude "Load MCP servers" / "Load
  plugins & settings" toggles (default off = faster, side-effect-free, OAuth login intact);
  and a per-backend **extra CLI flags** field for CLI flag changes or obscure CLIs. Flags are
  validated host-side against a denylist (tool/file/permission grants, sandbox, mcp-config,
  plugins/settings, `--bare`, etc. are rejected).

## 0.1.3 — 2026-07-16
- **Show the host bridge version in the panel.** The connection banner now reads
  e.g. "Claude CLI connected (2.1.209) · bridge v0.1.3", so you can confirm which
  native-host version the extension is actually talking to (the CLI version and
  the bridge version were previously indistinguishable). The host reports its own
  version in the `health` response.

## 0.1.2 — 2026-07-16
Organize bookmarks into folders (AI), plus bookmark-cleanup status grouping.

**Features**
- **Organize/categorize bookmarks into folders** with your chosen method: *match* (sort into
  existing folders only, no new folders), *additive* (keep existing folders, add category
  folders, sort loose bookmarks), or *full* (reorganize everything, including already-filed
  bookmarks). New folders are created under "Other Bookmarks".
- Protections, enforced in code (not left to the model): the **Bookmarks Bar is never touched**
  by default, whitelisted folders and their contents are never touched, and empty folders can
  optionally be removed after sorting. Every move/removal is a reviewable, undoable suggestion.
- Bookmark cleanup can now be **grouped by status** (Not found 404 / Gone 410 / Unreachable /
  Duplicate / Not visited) via a panel toggle; the dead-link check records the real HTTP status.

**Host**
- New native-host task `organize-bookmarks` (prompt + parser). Additive: existing tasks are
  unchanged. An older host paired with the new extension simply skips the organize scan.
- New reversible actions `moveBookmark` and `removeFolder` (empty-guarded).

## 0.1.1 — 2026-07-15
Host package fixes.
- **Windows: `npx` install now registers the native host.** The `bin` (`cli.js`) skipped the
  `reg add` step, so on Windows the manifest was written but never registered — the browser
  (which finds native hosts via the registry there) couldn't reach it. `install`/`repair`/
  `uninstall` now run the registry commands via a shared `runRegistryCommands` helper.
- Corrected the npm package `homepage` (lusk.dev) and `repository` URL
  (`LUSKTECH/browser-organizer`) — the 0.1.0 metadata pointed at the old domain/repo name.
- Fixed CI: `esbuild`/`postject` are fetched on demand via `npx` in `build:sea`, so they were
  removed from `devDependencies` (they had desynced `package-lock.json` and broken `npm ci`);
  their versions are now pinned in `scripts/build-sea.mjs`.

## 0.1.0 — 2026-07-14
First release.

**Features**
- Group open tabs by topic; detect forgotten/stale tabs (close or suspend, saving important
  ones first); auto-bookmark useful pages into tidy folders; clean duplicate/stale/dead
  bookmarks.
- Duplicate open-tab detection (local, no AI). Per-window or all-windows scope.
- Natural-language commands (side panel + `org` omnibox keyword). Save/restore named sessions.
- Scheduled auto-mode with one-click undo and an undo-history dialog. Whitelist + "never
  suggest this" learning.
- Six local AI CLI backends (Claude Code, Antigravity, Kiro, Copilot, Codex, Ollama) plus a
  host-side OpenAI-compatible API backend (OpenAI/OpenRouter/Groq/LM Studio/vLLM).

**Distribution**
- The helper installs into a stable per-user home (`~/.browser-organizer`,
  `%LOCALAPPDATA%\BrowserOrganizer`) with the browser manifest pointing there — the
  repo/bundle/npx cache can be deleted after install. `install`/`repair`/`uninstall`.
- Directory-independent install for technical users: `npx @lusktech/browser-organizer-host`
  (dependency-free npm package). The extension ID is baked in, so no arguments are needed.
- Standalone path for non-technical users: a Node SEA binary (`npm run build:sea`) that
  self-registers via `--install`/`--uninstall`, per-OS installer sources under `installer/`
  (Inno Setup / `.pkg` / `.deb`/`.rpm` / portable `install.sh`), and a signed/notarized
  release CI matrix (`.github/workflows/release-host.yml`).

**Quality / security**
- Full security + concurrency audit remediation: serialized storage read-modify-write,
  single-flight scans, incremental undo persistence, native-host stdin-crash guard, URL
  credential/redaction hardening, SSRF guard for dead-link checks, no-shell installer.
- 256 unit tests + 21 Playwright E2E; ESLint (security-first `no-unsanitized`) gate; CI.

**Packaging**
- Store zip (`npm run package`) and self-host bundle (`npm run package:selfhost`).
- Generated 16/48/128 icons; native-host `install`/`repair`/`uninstall` support.
