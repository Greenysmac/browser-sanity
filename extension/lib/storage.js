export const DEFAULTS = {
  automationMode: 'review',            // 'review' | 'auto'
  enabledFeatures: {
    staleTabs: false, groupTabs: true, importantBookmarks: false, cleanBookmarks: false, deadLinkScan: false, dupeTabs: true, organizeBookmarks: false,
  },
  organizeMode: 'additive',            // 'match' | 'additive' | 'full' (how aggressively to reorganize)
  regroupExisting: true,               // re-sort tabs already in groups (send grouped tabs to the grouping phase too)
  protectBookmarkBar: true,            // never move/remove anything in the Bookmarks Bar
  protectedFolders: [],                // folder paths/names the organizer never touches (with their contents)
  removeEmptyFolders: false,           // propose removing folders left empty after organizing
  staleTabDays: 14,                    // tabs idle longer are close candidates
  staleBookmarkDays: 180,             // bookmarks unvisited longer are cleanup candidates
  undoRetentionDays: 7,
  deadLinkBatchSize: 200,
  ignore: [],                          // never-suggest-again keys (see ignoreKey in orchestrator.js)
  whitelist: [],                       // protected domains — never close/discard/delete their tabs/bookmarks
  decisions: {},                       // per-target approve/reject counters (see recordDecision in orchestrator.js)
  adapter: 'claude',                   // native host adapter name
  provider: 'claude',                  // "where it runs" preset → sets adapter + openaiBaseUrl (see lib/providers.js); 'other' = pick a backend directly
  scanIntervalMinutes: 720,           // auto-run cadence (12h)
  openaiBaseUrl: '',                   // OpenAI-compatible endpoint (blank = host default). Key is in secret-store, not here.
  openaiModel: '',                     // OpenAI-compatible model (blank = host default)
  bigModel: 'claude-sonnet-5-5',       // model slot for big jobs: full Analyze runs and typed commands
  quickModel: 'claude-haiku-4-5',      // model slot for quick jobs: sortSelected, sortGroup, describe
  debugLogging: false,                 // verbose [organizer] logs in the service-worker console
  advancedCli: {                       // Advanced settings — power-user CLI control (see native-host/config.sanitizeCli)
    loadMcpServers: false,             // Claude: false → --strict-mcp-config (no MCP servers)
    loadPluginsSettings: false,        // Claude: false → --setting-sources '' (no on-disk settings/plugins/hooks)
    extraArgs: {},                     // { <adapter>: "extra flags" } — host validates against a denylist
    checkHostUpdates: false,           // opt-in: query npm for a newer host bridge (a network call)
  },
};

// `ignore` and `decisions` grow unbounded with use, so they live in storage.local
// (≈5 MB) — NOT in the single storage.sync `settings` item (8 KB/item quota),
// where growth would eventually make every settings write throw and lock the user
// out of changing any setting. They are also capped as defense in depth.
const MAX_IGNORE = 500;
const MAX_DECISIONS = 500;

function capDecisions(decisions) {
  const keys = Object.keys(decisions || {});
  if (keys.length <= MAX_DECISIONS) return decisions || {};
  const kept = keys.sort((a, b) => ((decisions[b].reject || 0) - (decisions[a].reject || 0))).slice(0, MAX_DECISIONS);
  const out = {};
  for (const k of kept) out[k] = decisions[k];
  return out;
}

export async function getSettings() {
  const { settings = {} } = await chrome.storage.sync.get('settings');
  const { ignore: localIgnore } = await chrome.storage.local.get('ignore');
  const { decisions: localDecisions } = await chrome.storage.local.get('decisions');
  // Prefer storage.local; fall back to any legacy value still in the sync blob.
  const ignore = localIgnore ?? settings.ignore ?? [];
  const decisions = localDecisions ?? settings.decisions ?? {};
  return {
    ...DEFAULTS,
    ...settings,
    ignore,
    decisions,
    enabledFeatures: { ...DEFAULTS.enabledFeatures, ...(settings.enabledFeatures || {}) },
    advancedCli: { ...DEFAULTS.advancedCli, ...(settings.advancedCli || {}), extraArgs: { ...(settings.advancedCli && settings.advancedCli.extraArgs) } },
  };
}

export async function setSettings(patch) {
  const current = await getSettings();
  if (patch.ignore !== undefined) await chrome.storage.local.set({ ignore: patch.ignore.slice(-MAX_IGNORE) });
  if (patch.decisions !== undefined) await chrome.storage.local.set({ decisions: capDecisions(patch.decisions) });
  const next = { ...current, ...patch };
  if (patch.enabledFeatures) next.enabledFeatures = { ...current.enabledFeatures, ...patch.enabledFeatures };
  if (patch.advancedCli) {
    next.advancedCli = {
      ...current.advancedCli,
      ...patch.advancedCli,
      extraArgs: {
        ...(current.advancedCli && current.advancedCli.extraArgs),
        ...(patch.advancedCli && patch.advancedCli.extraArgs),
      },
    };
  }
  // Keep the two unbounded fields out of the synced item.
  const { ignore, decisions, ...syncable } = next;
  await chrome.storage.sync.set({ settings: syncable });
  return next;
}
