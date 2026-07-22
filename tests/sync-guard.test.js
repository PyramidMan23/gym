// Codex P0-2: in-flight sync chains from profile A must never read/write profile B's config
// after setUser(). These tests plant a valid token via the test hook, stub fetch to a
// controllable promise, switch users mid-flight, then resolve — and assert NO write landed.
const test = require('node:test');
const assert = require('node:assert/strict');

// sync.js reads bare `localStorage`/`fetch` globals — provide fakes BEFORE require.
const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); }
};
const Sync = require('../sync.js');
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('downSync completing after setUser never writes the old plan into the new profile', async () => {
  store.clear();
  Sync.setUser('gym:user:p_aaa:sync');
  localStorage.setItem('gym:user:p_aaa:sync', JSON.stringify({ clientId: 'x', planFileId: 'f1' }));
  Sync._test.grantToken('tok-a', 3600000);
  let release;
  global.fetch = () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ planId: 'PLAN-A' }) }); });
  const inflight = Sync.downSync(true);
  await tick(); // the plan fetch is now pending under profile A's generation
  Sync.setUser('gym:user:p_bbb:sync'); // profile switch mid-flight
  localStorage.setItem('gym:user:p_bbb:sync', JSON.stringify({ clientId: 'y' }));
  release();
  await inflight;
  const b = JSON.parse(localStorage.getItem('gym:user:p_bbb:sync'));
  assert.equal(b.plan ?? null, null, "A's coach plan bled into B's config");
  assert.equal(b.lastPlanFetchAt ?? null, null, "A's fetch stamped B's lastPlanFetchAt");
  const a = JSON.parse(localStorage.getItem('gym:user:p_aaa:sync'));
  assert.equal(a.plan ?? null, null, 'stale chain must not write anywhere after the switch');
});

test('flush resuming after setUser never uploads or records into the new profile', async () => {
  store.clear();
  Sync.setUser('gym:user:p_aaa:sync');
  localStorage.setItem('gym:user:p_aaa:sync', JSON.stringify({
    clientId: 'x', folderId: 'fold-a', queue: [{ sessionId: 's1', name: 'W' }], uploadedFiles: {}
  }));
  Sync._test.grantToken('tok-a', 3600000);
  let release;
  global.fetch = () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ id: 'drive-file-1' }) }); });
  const inflight = Sync.flush();
  await tick(); // uploadSession's POST is now pending under A's generation
  Sync.setUser('gym:user:p_bbb:sync');
  localStorage.setItem('gym:user:p_bbb:sync', JSON.stringify({ clientId: 'y', queue: [] }));
  release();
  await inflight;
  const b = JSON.parse(localStorage.getItem('gym:user:p_bbb:sync'));
  assert.deepEqual(b.uploadedFiles ?? {}, {}, "A's upload was recorded into B's config");
  assert.equal(b.lastSyncAt ?? null, null, "A's flush stamped B's lastSyncAt");
  assert.equal(b.folderId ?? null, null, "A's folderId bled into B");
  // A's queue entry survives untouched (nothing was dequeued through the wrong key either).
  const a = JSON.parse(localStorage.getItem('gym:user:p_aaa:sync'));
  assert.equal(a.queue.length, 1, "the queued session vanished — a stale chain wrote after the switch");
});

test('delayed ensureFolder (via connect path) never writes a folderId into the new profile', async () => {
  store.clear();
  Sync.setUser('gym:user:p_aaa:sync');
  // enabled:true = a profile that has opted into cloud backup, which is what makes flush run at all
  // (sync is opt-in since 2026-07-22; a built-in client id alone must never trigger network work).
  localStorage.setItem('gym:user:p_aaa:sync', JSON.stringify({ clientId: 'x', enabled: true, queue: [{ sessionId: 's9' }] }));
  Sync._test.grantToken('tok-a', 3600000);
  let release;
  global.fetch = () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ id: 'folder-new' }) }); });
  const inflight = Sync.flush(); // no folderId yet → ensureFolder's POST goes pending
  await tick();
  Sync.setUser('gym:user:p_bbb:sync');
  localStorage.setItem('gym:user:p_bbb:sync', JSON.stringify({ clientId: 'y' }));
  release();
  await inflight;
  const b = JSON.parse(localStorage.getItem('gym:user:p_bbb:sync'));
  assert.equal(b.folderId ?? null, null, "A's new Drive folderId was written into B's config");
});
