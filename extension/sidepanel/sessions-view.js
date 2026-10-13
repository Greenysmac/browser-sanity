// Saved window sessions: list with restore/rename/delete, JSON export, and the
// save form. renderSessions() is exported so the bootstrap can paint it on load.
import { $, send, setStatus, confirmAction } from './dom.js';

export async function renderSessions() {
  const sessRes = await send({ cmd: 'listSessions' });
  // Don't wipe the shown list on a dropped/failed reply (SW asleep) — surface it.
  if (!sessRes || !sessRes.ok) { setStatus('Could not load sessions.'); return; }
  const sessions = sessRes.sessions || [];
  const list = $('sessionList');
  list.textContent = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${s.name} (${s.tabs.length} tabs)`;
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.textContent = 'Restore';
    restoreBtn.addEventListener('click', async () => {
      await send({ cmd: 'restoreSession', id: s.sessionId });
      setStatus(`Restored "${s.name}".`);
    });
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => {
      if (!li.contains(label)) return; // already editing this row — ignore a repeat click
      const input = document.createElement('input');
      input.type = 'text';
      input.value = s.name;
      let committed = false; // Enter fires commit, then blur fires again — run once
      const commit = async () => {
        if (committed) return;
        committed = true;
        const name = input.value.trim();
        if (name && name !== s.name) await send({ cmd: 'renameSession', id: s.sessionId, name });
        renderSessions();
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          committed = true;
          renderSessions();
        }
      });
      input.addEventListener('blur', commit);
      li.replaceChild(input, label);
      input.focus();
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'sessionDeleteBtn';
    deleteBtn.addEventListener('click', async () => {
      const ok = await confirmAction({
        title: 'Delete session?',
        message: `Permanently delete "${s.name}" (${s.tabs.length} tabs)? This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      await send({ cmd: 'deleteSession', id: s.sessionId });
      renderSessions();
      setStatus(`Deleted session "${s.name}".`);
    });
    li.append(label, restoreBtn, renameBtn, deleteBtn);
    list.appendChild(li);
  }
}

export function initSessionsView() {
  $('exportSessions').addEventListener('click', async () => {
    const sessRes = await send({ cmd: 'listSessions' });
    if (!sessRes || !sessRes.ok) { setStatus('Could not load sessions.'); return; }
    const sessions = sessRes.sessions || [];
    const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'browser-sanity-sessions.json'; a.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${sessions.length} session${sessions.length === 1 ? '' : 's'}.`);
  });

  $('saveSessionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = $('sessionName');
    const keepOpen = $('keepTabsOpen').checked;
    const win = await chrome.windows.getCurrent().catch(() => null);
    await send({ cmd: 'saveSession', name: nameInput.value.trim(), close: !keepOpen, windowId: win?.id });
    nameInput.value = '';
    setStatus(keepOpen ? 'Session saved (tabs kept open).' : 'Session saved and tabs closed.');
    await renderSessions();
  });
}
