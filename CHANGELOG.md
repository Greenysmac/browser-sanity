# Changelog

Browser Sanity is a fork of [Browser Organizer](https://github.com/LUSKTECH/browser-organizer) 0.1.8 by Lusk Technologies. Versions 0.2.0 and later are Browser Sanity; the entries from 0.1.8 down are the original project's, kept as they were.

## 0.8.1 — 2026-10-15
- The version shows as "Version 0.8.1" at the right of the side panel's Open tabs heading, and under the board on the new-tab page.

## 0.8.0 — 2026-10-15
- Sorting puts tabs where your groups are: tabs for an open group join it and stay open; tabs for a parked group are put away in it (saved and closed), so parked groups stay out of sight. One box on the result card keeps them open instead, for that sort.
- A live group and a parked group with the same name are one group. The index keeps the parked tabs alongside the live ones, "Add back N parked tabs" brings them in, and parking or closing the group puts them all back together. Before this, a new live group replaced the parked record of the same name and its saved tabs were dropped.
- The result line says how many tabs go to open groups and how many to parked ones.

## 0.7.1 — 2026-10-13
- Put into my groups works when the window already has an open group. It crashed while matching the AI's answer to your tabs, and the panel showed nothing instead of an error.
- If sorting fails, the panel now says why ("Couldn't sort your tabs: …") instead of "Nothing to do".

## 0.7.0 — 2026-10-12
- Browser Sanity has its own identity, so it can sit beside Browser Organizer: its own extension ID, helper name (`com.browser_sanity.host`), helper folder (`~/.browser-sanity`) and `BROWSER_SANITY_` settings. Moving from an earlier Browser Sanity means loading the extension again and running `npm run install-host`.
- The helper installs from the project folder (`npm run install-host`); it isn't published to npm, and the panel's help and update messages say so instead of pointing at the original's package.
- New README, install guide and privacy page; the original project's store listing, release process and hosted privacy page are gone. Lusk Technologies is credited in every license and package file.

## 0.6.1 — 2026-10-11
- A failed suggestion says what and why ("Applied 12. 1 failed: Group "Someday" (1 tab): No tab with id: 13.").
- The Undo after Apply stays under the result until you use it or run Analyze again. "Restore before sort" in the header also undoes the latest Apply.

## 0.6.0 — 2026-10-11
- Tabs go into live groups by default. A tab that matches a parked group joins an open group with that name; an unchecked box offers to file it into the parked group instead (which saves and closes it).
- Re-analyze parked groups is safer: nothing is checked until you check it, no merge that ends up over 30 tabs, merges update the groups file, splitting the catch-all group keeps it, and the cards have Dismiss.
- The side panel has two parts, Open tabs (Analyze) and Parked groups (Re-analyze), each with one line saying what it touches. The bookmark tools, Run one and Sessions are hidden.
- Every suggestion card says what made it and when ("From Analyze: Put into my groups, 9:40 AM").
- Re-analyze splits are checkboxes showing the proposed sub-group names; one "Apply checked" does merges, then splits.
- Real-browser fixes: the From line, hidden elements that still showed, an applied split that could come back, the parked checkbox counting groups instead of tabs.

## 0.5.3 — 2026-10-11
- No leftovers: reloading or updating the extension, or restarting the browser, clears stored suggestions; a stored split proposal shows only within two minutes of being made.
- The restart cleanup now runs (it used import(), which Chrome refuses in a service worker).

## 0.5.2 — 2026-10-10
- Split works in real Chrome (the split card crashed before showing), and its review lists every sub-group.
- "Tidy parked groups…" is now "Re-analyze parked groups…", and the new-tab page's link opens the side panel to run it.

## 0.5.1 — 2026-10-08
- A new Analyze clears the old suggestions; a plan older than 6 hours, or pointing at closed tabs, drops on its own.
- A calmer header, and a new icon: a level with the bubble centered.

## 0.5.0 — 2026-10-08
- Cards show the tab count at the top right with a 30+ badge; clicking a card shows its description and its top five tabs with the site in bold; several cards can be open.
- "Restore before sort" undoes the latest sort.
- Analyze counts loose tabs and duplicates first, then you choose Put into my groups or Suggest new groups. Re-sort all groups and Close duplicates are occasional actions.
- Re-analyze parked groups suggests merges and splits.

## 0.4.0 — 2026-10-07
- Split any group into need-based sub-groups, open or parked, from its ⋯ menu.
- A 30-tab soft cap: groups over 30 are flagged.

## 0.3.x — 2026-10-07
- Dark mode throughout, from theme tokens.
- Click a group row for its description and tabs.
- One line per group with a ⋯ menu; the side panel shows only what you need, with everything else in a More view.
- Park merges into a saved group instead of replacing it, never shrinks a record, and closes the whole group. The helper keeps the newest 50 dated copies of the index and can restore one.
- Two model slots: big sorts and quick jobs. Runs on a Claude subscription (through Claude Code), Poe, OpenRouter, OpenAI, a local model, or any OpenAI-style service.
- Suggested group descriptions are saved only when you click Save.

## 0.2.x — 2026-10-07
- Security: model-written descriptions are suggestions only and never written to the groups file on their own (tab titles are untrusted page text and the groups file feeds later prompts).
- A groups file (`groups.md` in the helper's folder) describes your own need-based groups and goes with every request.
- Grouping reuses existing group names and adds to an existing group instead of making a duplicate; tabs already in the right group stay put.
- The index: `index.md` and `index.json` list every group and its tabs, open or parked, for you or any AI agent to read.
- Suggestions from an AI agent through `proposals.json`, shown in the normal list for approval.
- Park a group (save and close it) and open it again; sort one group or just the selected tabs.
- The board: Open now and Parked sections, in the side panel and as the new-tab page.

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
