// Shared side-panel primitives: element lookup, status line, and the message
// channel to the service worker. Every view module builds on these; keeping them
// here (instead of duplicated per view) is what lets the panel split into
// feature modules without a tangle of cross-imports.

export const $ = (id) => document.getElementById(id);

export const setStatus = (t) => {
  const textEl = $('statusText');
  if (textEl) textEl.textContent = t;
  else if ($('status')) $('status').textContent = t;
  const clock = $('statusClock');
  if (clock) clock.textContent = '';
};

export const setStatusWithClock = (text, elapsedText) => {
  const textEl = $('statusText');
  if (textEl) {
    if (textEl.textContent !== text) textEl.textContent = text;
  } else if ($('status')) {
    $('status').textContent = elapsedText ? `${text} · ${elapsedText}` : text;
  }
  const clock = $('statusClock');
  if (clock) clock.textContent = elapsedText ? ` · ${elapsedText}` : '';
};

// Like setStatus but re-triggers a brief highlight on every call, so a repeated
// confirmation (e.g. pressing Save twice) is still visibly acknowledged.
export function flashStatus(t) {
  setStatus(t);
  const el = $('status');
  if (el) {
    el.classList.remove('flash');
    void el.offsetWidth; // reflow so the CSS animation restarts even if text is unchanged
    el.classList.add('flash');
  }
}

// Confirms an action via the native <dialog id="confirmDialog"> modal.
// Resolves true to proceed, false to cancel (Cancel button, backdrop dismiss, or Esc).
export function confirmAction({ title = 'Apply changes?', message = 'Are you sure?', confirmLabel = 'Confirm', danger = false } = {}) {
  const dlg = $('confirmDialog');
  if (!dlg) return Promise.resolve(true);
  $('confirmTitle').textContent = title;
  $('confirmMsg').textContent = message;
  const okBtn = $('confirmOk');
  okBtn.textContent = confirmLabel;
  okBtn.classList.toggle('danger', danger);
  return new Promise((resolve) => {
    const onCancel = () => done(false);
    const done = (val) => {
      dlg.removeEventListener('cancel', onCancel);
      okBtn.onclick = null;
      $('confirmCancel').onclick = null;
      dlg.close();
      resolve(val);
    };
    okBtn.onclick = () => done(true);
    $('confirmCancel').onclick = () => done(false);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
  });
}

// One request/response round-trip to the service worker. Resolves with whatever
// the handler returned, or undefined if the worker never replied (asleep/crashed).
export function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

// All settings WRITES go through the service worker so they serialize under its
// single 'settings' lock; writing chrome.storage directly from this context would
// race SW-side writers (ignore/decisions) and clobber them. Reads stay local.
export async function setSettings(patch) {
  const r = await send({ cmd: 'setSettings', patch });
  // A dropped/failed write must not look like success (the SW may be asleep and
  // the callback fires with no response). Throw so callers can surface it.
  if (!r || !r.ok) throw new Error((r && r.error) || 'the background worker did not respond — settings were not saved');
  return r.settings;
}

// Fetch the stored plan with its origin (what made it, and when), tolerating a
// null response (SW asleep/no reply — the callback fires with undefined and
// chrome.runtime.lastError set). Returns { items, origin }.
export async function fetchPlan() {
  const r = await send({ cmd: 'getPlan' });
  return { items: (r && r.items) || [], origin: (r && r.origin) || null };
}

// Bring a tab to the foreground (used by click-to-focus on a suggestion).
export function focusTab(tabId) { if (tabId != null) send({ cmd: 'focusTab', tabId }); }

// The window the current run/list should be scoped to: the focused window when
// the scope selector is set to "this window", else null (all windows).
export async function currentScopeWindowId() {
  if ($('scope').value !== 'window') return null;
  const win = await chrome.windows.getCurrent();
  return win.id;
}
