// Backend health + first-run onboarding. checkHealth() drives the banner, gates
// every backend-dependent control, and shows the connect card until the CLI is
// reachable. It's exported because settings-view re-checks after switching the
// adapter.
import { $, send, setStatus } from './dom.js';
import { healthMessage, installCommand } from './viewmodel.js';

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
  // The two always-visible grouping choices replace the old Analyze click, so
  // gate them on health the same way #run is (a down CLI shows the onboarding
  // guidance instead of a raw error).
  $('putMine').disabled = !ok;
  $('suggestGroups').disabled = !ok;
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
  // Update nudge: the baked-in MIN_HOST_VERSION check (offline) always wins; if
  // it is quiet, nothing else runs (the npm check is off; see below).
  const upd = $('hostUpdate');
  if (update) { upd.textContent = update; upd.hidden = false; }
  else { upd.hidden = true; upd.textContent = ''; if (ok) maybeCheckLatestHost(); }
  return ok;
}

// The original extension asked npm for a newer helper. Browser Sanity's helper
// isn't published to npm (it installs from the project folder), and a package
// of the same name there wouldn't be ours, so the check is off for good and its
// setting is hidden.
function maybeCheckLatestHost() {}

export function initHealthView() {
  $('copyCmd').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(installCommand(chrome.runtime.id)); setStatus('Command copied.'); }
    catch { setStatus('Copy failed — select and copy manually.'); }
  });
  $('recheck').addEventListener('click', () => checkHealth());
}
