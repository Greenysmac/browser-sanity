// An old service worker still running after an update answers new commands with
// 'unknown command'; the pages swap that for a reload instruction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainStaleWorker, STALE_WORKER_ERROR } from '../extension/lib/stale-worker.js';

test("'unknown command' becomes the reload instruction", () => {
  assert.deepEqual(explainStaleWorker({ ok: false, error: 'unknown command' }), { ok: false, error: STALE_WORKER_ERROR });
  assert.match(STALE_WORKER_ERROR, /chrome:\/\/extensions/);
});

test('other responses pass through untouched', () => {
  const ok = { ok: true, collections: [] };
  assert.equal(explainStaleWorker(ok), ok);
  const other = { ok: false, error: 'CLI exited 1' };
  assert.equal(explainStaleWorker(other), other);
  assert.equal(explainStaleWorker(undefined), undefined);
});
