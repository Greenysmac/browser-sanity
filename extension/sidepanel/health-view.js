// Backend health + first-run onboarding. checkHealth() drives the banner, gates
// every backend-dependent control, and shows the connect card until the CLI is
// reachable. It's exported because settings-view re-checks after switching the
// adapter. The opt-in npm "newer helper" check lives here too.
import { $, send, setStatus } from './dom.js';
import { getSettings } from '../lib/storage.js';
import { healthMessage, installCommand, semverLt } from './viewmodel.js';

let lastHostVersion = null; // installed bridge version from the last health poll (for the opt-in npm check)

export async function checkHealth() {
  const res = await send({ cmd: 'health' });
  const { ok, text, update } = healthMessage(res && res.health, chrome.runtime.id);
  const el = $('health');
  el.style.whiteSpace = 'pre-line'; // render the multi-line guidance
  el.textContent = text;
  el.classList.toggle('healthOk', ok);
  el.classList.toggle('healthBad', !ok);
  // Show the connection status line only when something is wrong; a healthy
  // backend needs no banner, so hide it when connected.
  el.hidden = ok;
  $('run').disabled = !ok;
  // Gate every backend-dependent control on health, not just Analyze, so the CLI
  // being down surfaces the onboarding guidance instead of a raw error.
  for (const btn of $('runOne').querySelectorAll('button[data-feature]')) btn.disabled = !ok;
  $('commandInput').disabled = !ok;
  $('commandForm').querySelector('button[type="submit"]').disabled = !ok;
  // First-run onboarding: show the connect card until the CLI is reachable.
  $('onboarding').hidden = ok;
  const emptyEl = $('planEmptyState');
  if (emptyEl && !ok) emptyEl.hidden = true;
  if (!ok) $('installCmd').textContent = installCommand(chrome.runtime.id);
  lastHostVersion = (res && res.health && res.health.hostVersion) || null;
  // Update nudge: the baked-in MIN_HOST_VERSION check (offline) always wins; if
  // it's quiet, the opt-in npm check may still surface a newer published build.
  const upd = $('hostUpdate');
  if (update) { upd.textContent = update; upd.hidden = false; }
  else { upd.hidden = true; upd.textContent = ''; if (ok) maybeCheckLatestHost(); }
  return ok;
}

// Opt-in, off by default: ask npm whether a newer host bridge exists than the
// one installed. A network request, so it only runs when the user enabled the
// toggle AND granted the registry.npmjs.org permission. Failures are silent.
async function maybeCheckLatestHost() {
  try {
    if (!lastHostVersion || lastHostVersion === 'unknown') return;
    const s = await getSettings();
    if (!s.advancedCli || !s.advancedCli.checkHostUpdates) return;
    const granted = await chrome.permissions.contains({ origins: ['https://registry.npmjs.org/*'] });
    if (!granted) return;
    const r = await fetch('https://registry.npmjs.org/@lusktech/browser-organizer-host/latest', { cache: 'no-store' });
    if (!r.ok) return;
    const latest = (await r.json()).version;
    if (latest && semverLt(lastHostVersion, latest)) {
      const upd = $('hostUpdate');
      upd.textContent = `Helper update available: v${latest} (you have v${lastHostVersion}). Update it: run  npx @lusktech/browser-organizer-host@latest  then reload the extension.`;
      upd.hidden = false;
    }
  } catch { /* offline or registry unreachable — no nudge */ }
}

export function initHealthView() {
  $('copyCmd').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(installCommand(chrome.runtime.id)); setStatus('Command copied.'); }
    catch { setStatus('Copy failed — select and copy manually.'); }
  });
  $('recheck').addEventListener('click', () => checkHealth());
}
