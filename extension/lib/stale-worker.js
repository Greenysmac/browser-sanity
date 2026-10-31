// After an update, Chrome can keep running the old service worker while the
// panel and new-tab page load the new files. The old worker then answers a new
// command with 'unknown command', which tells the user nothing. Swap that for
// what to do about it. Any other response passes through untouched.
export const STALE_WORKER_ERROR = 'Browser Sanity was updated but Chrome is still running the old version. Reload it on chrome://extensions, then try again.';

export function explainStaleWorker(res) {
  if (res && res.ok === false && res.error === 'unknown command') return { ...res, error: STALE_WORKER_ERROR };
  return res;
}
