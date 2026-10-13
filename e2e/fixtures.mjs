// Playwright test fixtures for the Browser Sanity extension.
//
// Provides an extension-loaded persistent Chrome-for-Testing context with the
// native-messaging host registered so the full pipe (panel -> service worker ->
// native host -> claude) is exercisable, plus a local HTTP server so tests can
// open realistic http(s) tabs with distinct titles/urls.

import { test as base, expect, chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, buildHostManifest, HOST_NAME } from '../native-host/installer.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extPath = path.join(repoRoot, 'extension');
// The extension id is stable — derived from the manifest's pinned key.
const EXT_ID = process.env.BORG_EXT_ID || 'kebmdofdghcjmknaecnojcglkibcacgn';

// Pages the local server serves, titled to give the model something to cluster.
const PAGES = {
  '/react/docs': 'React – Documentation',
  '/react/hooks': 'React Hooks – API Reference',
  '/react/router': 'React Router – Guide',
  '/news/politics': 'Daily Times – Politics',
  '/news/sports': 'Daily Times – Sports',
  '/news/tech': 'Daily Times – Technology',
};

export const test = base.extend({
  // A tiny local site so opened tabs are real http(s) tabs (the extension
  // ignores non-http tabs). Returns the base URL, e.g. http://127.0.0.1:PORT.
  server: async ({}, use) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/dead') { res.writeHead(404); res.end('not found'); return; } // for dead-link tests
      if (req.url.startsWith('/v1/')) { // stub OpenAI-compatible endpoint (/models + /chat/completions)
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [], choices: [{ message: { content: '{"groups":[],"close":[],"important":[]}' } }] }));
        return;
      }
      // req.url is reflected into the page, so escape it — the fixture is a
      // throwaway localhost server, but this keeps the response injection-free.
      const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const title = esc(PAGES[req.url] || `Page ${req.url}`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address();
    await use(`http://127.0.0.1:${port}`);
    // The browser holds keep-alive connections open; force them closed so
    // srv.close() doesn't hang the fixture teardown.
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  },

  // Extension-loaded persistent context with the native host reachable.
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'borg-e2e-'));
    const xdgConfigHome = path.join(userDataDir, 'xdgcfg');
    // Install copies the host into an isolated temp home (never the tester's real ~),
    // writing the launcher there; the manifest below points at that copied launcher.
    // `home` must also be sandboxed — install() independently writes a real manifest
    // under manifestDir(browser, platform, home), which defaults to the real os.homedir().
    const hostHomeDir = path.join(userDataDir, 'host-home');
    const isolatedHome = path.join(userDataDir, 'home');
    try { install({ extensionId: EXT_ID, browsers: ['chrome-for-testing'], copyTo: hostHomeDir, home: isolatedHome }); } catch { /* best effort */ }
    const launcher = path.join(hostHomeDir, process.platform === 'win32' ? 'run.bat' : 'run.sh');
    const manifestJson = JSON.stringify(buildHostManifest({ execPath: launcher, extensionId: EXT_ID }), null, 2);
    // Place the host manifest deterministically where Chrome for Testing looks.
    for (const d of [
      path.join(userDataDir, 'NativeMessagingHosts'),
      path.join(xdgConfigHome, 'google-chrome-for-testing', 'NativeMessagingHosts'),
      path.join(xdgConfigHome, 'chromium', 'NativeMessagingHosts'),
    ]) {
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, `${HOST_NAME}.json`), manifestJson);
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium', // bundled Chrome for Testing (branded Chrome blocks --load-extension)
      headless: false,     // run headed under xvfb — the reliable path for MV3 extensions
      env: { ...process.env, XDG_CONFIG_HOME: xdgConfigHome },
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        // Map a non-private hostname to the local server so dead-link checks
        // (which skip loopback/private hosts) can reach it.
        '--host-resolver-rules=MAP deadlink.test 127.0.0.1',
      ],
    });
    await use(context);
    await context.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  },

  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) { try { sw = await context.waitForEvent('serviceworker', { timeout: 10000 }); } catch { /* lazy */ } }
    await use(sw ? new URL(sw.url()).host : EXT_ID);
  },

  // A page pointed at the side-panel HTML (an extension page with full chrome.* access).
  panel: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`, { waitUntil: 'domcontentloaded' });
    await use(page);
  },
});

export { expect };

// Send a message to the service worker from the panel page (same API the UI uses).
export function send(panel, message) {
  return panel.evaluate(
    (msg) => new Promise((r) => { try { chrome.runtime.sendMessage(msg, r); } catch (e) { r({ error: String(e) }); } }),
    message,
  );
}

export function queryTabs(panel) {
  return panel.evaluate(() => new Promise((r) => chrome.tabs.query({}, r)));
}

export function queryGroups(panel) {
  return panel.evaluate(() => new Promise((r) => chrome.tabGroups.query({}, r)));
}

export async function countTabsWithUrl(panel, url) {
  const tabs = await queryTabs(panel);
  return tabs.filter((t) => t.url === url).length;
}

// Run one feature in isolation via the service worker's `run` command.
export function runFeature(panel, feature) {
  const features = { dupeTabs: false, groupTabs: false, staleTabs: false, importantBookmarks: false, cleanBookmarks: false, deadLinkScan: false };
  features[feature] = true;
  return send(panel, { cmd: 'run', features });
}

// chrome.* helpers usable from the panel (extension) page context.
export const createBookmark = (panel, node) =>
  panel.evaluate((n) => new Promise((r) => chrome.bookmarks.create(n, r)), node);
export const getBookmark = (panel, id) =>
  panel.evaluate((i) => new Promise((r) => { chrome.bookmarks.get(i, (res) => { void chrome.runtime.lastError; r((res && res[0]) || null); }); }), id);
export const searchBookmarks = (panel, url) =>
  panel.evaluate((u) => new Promise((r) => chrome.bookmarks.search({ url: u }, r)), url);
export const setStoredSettings = (panel, patch) =>
  panel.evaluate((p) => new Promise((r) => chrome.storage.sync.get('settings', ({ settings = {} }) => chrome.storage.sync.set({ settings: { ...settings, ...p } }, r))), patch);
export const getAlarms = (panel) =>
  panel.evaluate(() => new Promise((r) => chrome.alarms.getAll(r)));
