// Google Drive up/down sync (drive.file scope ONLY) + a durable local session queue.
// UMD like core.js: browser global (DuckGymSync) and a require()-able node module.
// Design invariants (council 2026-07-18):
//  - Never block or corrupt the workout flow: every network/auth failure silently re-queues.
//  - Never popup mid-workout: an interactive token is only requested from a Settings tap.
//  - drive.file can only read files the APP created → always read coach-plan.json by its stored
//    fileId; never search-and-recreate (recreating breaks the PC-side down-sync loop).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DuckGymSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SYNC_KEY = 'gymSyncV1';
  // Per-profile isolation (Track B): the active config key is swapped on profile switch via setUser().
  // Defaults to the legacy key so node tests and a pre-profiles boot keep working unchanged.
  let activeSyncKey = SYNC_KEY;
  const FOLDER_NAME = 'Gym-Sync';
  const PLAN_NAME = 'coach-plan.json';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const GSI_SRC = 'https://accounts.google.com/gsi/client';

  // ---------- pure queue + payload (unit-tested, no browser) ----------
  // Full session snapshot: exercises, sets, loads, L/R side tags, the three-touch safety answers,
  // timestamps and a stable sessionId. One file per session on Drive.
  function sessionToPayload(session) {
    const s = session || {};
    return {
      sessionId: s.id || null,
      name: s.name || '',
      started: s.started || null,
      finished: s.finished || null,
      checkin: s.checkin || null, // three-touch safety answers (pre 0-10, post, next-session flare)
      prs: Array.isArray(s.prs) ? s.prs : [],
      exercises: (s.exercises || []).map(ex => ({
        exerciseId: ex.exerciseId,
        exerciseName: (typeof DUCK_EXERCISES !== 'undefined' && (DUCK_EXERCISES.find(d => d.id === ex.exerciseId) || {}).name) || '',
        notes: ex.notes || '',
        sets: (ex.sets || []).map(set => ({
          weight: set.weight, reps: set.reps, done: !!set.done, side: set.side || null
        }))
      }))
    };
  }
  // Dedupe by sessionId → durable + idempotent: re-enqueuing the same session replaces, never grows.
  function enqueue(queue, payload) {
    const list = Array.isArray(queue) ? queue.slice() : [];
    const id = payload && payload.sessionId;
    const at = list.findIndex(item => item && item.sessionId === id);
    if (at >= 0) list[at] = payload; else list.push(payload);
    return list;
  }
  function removeFromQueue(queue, sessionId) {
    return (Array.isArray(queue) ? queue : []).filter(item => !(item && item.sessionId === sessionId));
  }

  // ---------- config store (browser-only, defensive) ----------
  const hasLS = () => typeof localStorage !== 'undefined';
  function defaults() {
    return { clientId: '', folderId: null, planFileId: null, queue: [], uploadedFiles: {}, beightonUnlocked: false, lastSyncAt: null, plan: null };
  }
  // Stale-snapshot rule: a config object held across an await may be outdated (a workout can
  // finish and enqueue meanwhile). After every await: re-loadConfig(), mutate ONLY the fields
  // you own, save. Never persist a queue captured before an await.
  function updateConfig(mutate) { const fresh = loadConfig(); mutate(fresh); return saveConfig(fresh); }
  function loadConfig() {
    if (!hasLS()) return defaults();
    try { const c = JSON.parse(localStorage.getItem(activeSyncKey)); return { ...defaults(), ...(c || {}) }; }
    catch { return defaults(); }
  }
  function saveConfig(config) {
    if (hasLS()) { try { localStorage.setItem(activeSyncKey, JSON.stringify(config)); } catch { } }
    return config;
  }

  // ---------- token (in-memory only; SPAs get no refresh token, ~1h expiry) ----------
  let tokenClient = null;
  let tokenClientId = null;   // the clientId the current tokenClient was built for
  let accessToken = null;
  let tokenExpiry = 0;
  let pending = null;         // { resolve, reject } bridging the GIS callbacks to requestToken()
  const tokenValid = () => !!accessToken && Date.now() < tokenExpiry - 60000;

  function loadGsi() {
    return new Promise((resolve, reject) => {
      if (typeof document === 'undefined') return reject(new Error('no-dom'));
      if (root.google && root.google.accounts && root.google.accounts.oauth2) return resolve();
      const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
      if (existing) { existing.addEventListener('load', () => resolve()); existing.addEventListener('error', reject); return; }
      const script = document.createElement('script');
      script.src = GSI_SRC; script.async = true; script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('gsi-load-failed'));
      document.head.appendChild(script);
    });
  }

  // Build (or reuse) the token client for the configured clientId. Returns null if GIS isn't
  // loaded yet or no clientId. The GIS callbacks resolve/reject whatever token request is pending.
  function buildTokenClient() {
    const clientId = loadConfig().clientId;
    if (!clientId) return null;
    if (!(root.google && root.google.accounts && root.google.accounts.oauth2)) return null;
    if (tokenClient && tokenClientId === clientId) return tokenClient;
    tokenClient = root.google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: response => {
        const p = pending; pending = null;
        if (response && response.access_token) {
          accessToken = response.access_token;
          tokenExpiry = Date.now() + (Number(response.expires_in) || 3600) * 1000;
          p && p.resolve(accessToken);
        } else if (p) p.reject(new Error('no-token'));
      },
      error_callback: err => { const p = pending; pending = null; if (p) p.reject(err || new Error('token-error')); }
    });
    tokenClientId = clientId;
    return tokenClient;
  }

  // Preload the GIS library and pre-build the client so a later Connect tap can open the popup
  // SYNCHRONOUSLY. Loading the library inside the click handler (the old bug) drops the browser's
  // transient user activation, so the popup is blocked ('popup_failed_to_open') on every device.
  function preload() {
    if (typeof document === 'undefined' || !loadConfig().clientId) return Promise.resolve(false);
    return loadGsi().then(() => !!buildTokenClient()).catch(() => false);
  }

  // interactive=false → silent; interactive=true → account chooser. MUST run synchronously from the
  // user gesture: requestAccessToken is called with NO async work before it, so preload() must have
  // already built the client (done at boot + on setClientId). If not ready yet, reject 'gsi-not-ready'
  // and warm it up so the next tap succeeds.
  function requestToken(interactive) {
    return new Promise((resolve, reject) => {
      const tc = buildTokenClient();
      if (!tc) { preload(); return reject(new Error('gsi-not-ready')); }
      if (pending) return reject(new Error('token-in-flight'));
      pending = { resolve, reject };
      try { tc.requestAccessToken({ prompt: interactive ? 'consent' : '' }); }
      catch (e) { pending = null; reject(e); }
    });
  }
  function ensureToken(interactive) {
    if (tokenValid()) return Promise.resolve(accessToken);
    return requestToken(!!interactive);
  }

  function api(path, options) {
    return fetch(path, { ...options, headers: { Authorization: `Bearer ${accessToken}`, ...(options && options.headers) } })
      .then(res => { if (!res.ok) throw new Error(`drive-${res.status}`); return res; });
  }

  // Create the app's Gym-Sync folder once; store folderId (owned-field write only).
  function ensureFolder() {
    const existing = loadConfig().folderId;
    if (existing) return Promise.resolve(existing);
    return api('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    }).then(res => res.json()).then(file => updateConfig(c => { c.folderId = file.id; }).folderId);
  }
  // Create the empty coach-plan.json once; store planFileId. The PC brain UPDATES this file's
  // content later (via the synced Drive desktop mirror); the app only ever reads it by fileId.
  function ensurePlanFile(folderId) {
    const existing = loadConfig().planFileId;
    if (existing) return Promise.resolve(existing);
    const meta = { name: PLAN_NAME, parents: [folderId], mimeType: 'application/json' };
    return multipartCreate(meta, '{}').then(file => updateConfig(c => { c.planFileId = file.id; }).planFileId);
  }

  function multipartCreate(meta, content) {
    const boundary = 'gymsync' + Date.now();
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
      + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    }).then(res => res.json());
  }
  // Upload one session. If we already created a Drive file for this sessionId, PATCH its
  // content instead of POST-creating a duplicate. Resolves with the fileId.
  function uploadSession(folderId, payload, existingFileId) {
    const json = JSON.stringify(payload);
    if (existingFileId) {
      return api(`https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json
      }).then(() => existingFileId);
    }
    return multipartCreate({ name: `session-${payload.sessionId}.json`, parents: [folderId] }, json).then(file => file.id);
  }

  // ---------- public browser API ----------
  const configured = () => !!loadConfig().clientId;
  function status() {
    const c = loadConfig();
    return { configured: !!c.clientId, connected: tokenValid(), queued: (c.queue || []).length, lastSyncAt: c.lastSyncAt, planActive: !!c.plan };
  }
  function getBeighton() { return !!loadConfig().beightonUnlocked; }
  function setBeighton(on) { const c = loadConfig(); c.beightonUnlocked = !!on; return saveConfig(c).beightonUnlocked; }
  function getPlan() { return loadConfig().plan; }
  function setClientId(id) { const c = loadConfig(); c.clientId = String(id || '').trim(); saveConfig(c); preload(); return c.clientId; }

  // Enqueue on session completion, then try to flush. Silent-fails to the queue.
  function onSessionComplete(session) {
    updateConfig(c => { c.queue = enqueue(c.queue, sessionToPayload(session)); });
    return flush();
  }

  // Flush the queue. Never popup (silent token only); on any failure items stay queued.
  // Single-flight: concurrent callers share one in-flight promise so the same session is
  // never uploaded twice in parallel; a lost response re-PATCHes via uploadedFiles, not re-POSTs.
  let flushInFlight = null;
  function flush() {
    if (flushInFlight) return flushInFlight;
    if (!loadConfig().clientId || !(loadConfig().queue || []).length) return Promise.resolve(status());
    flushInFlight = ensureToken(false)
      .then(() => ensureFolder())
      .then(folderId => loadConfig().queue.reduce((chain, payload) => chain.then(() =>
        uploadSession(folderId, payload, loadConfig().uploadedFiles[payload.sessionId]).then(fileId => {
          updateConfig(c => {
            c.queue = removeFromQueue(c.queue, payload.sessionId);
            c.uploadedFiles[payload.sessionId] = fileId;
            c.lastSyncAt = Date.now();
          });
        }).catch(() => { /* keep this one queued, stop the run */ throw new Error('stop'); })
      ), Promise.resolve()))
      .then(() => status())
      .catch(() => status()) // deferred to next launch
      .finally(() => { flushInFlight = null; });
    return flushInFlight;
  }

  // Down-sync: read coach-plan.json by stored fileId, parse, store. Silent-fails.
  const PLAN_FETCH_MS = 6 * 3600 * 1000; // brain writes the plan nightly; a 6h cadence is plenty
  function downSync(force) {
    const c = loadConfig();
    if (!c.clientId || !c.planFileId) return Promise.resolve(getPlan());
    // GIS token requests flash a popup even in silent mode; don't pay that on every cold open.
    if (!force && !tokenValid() && c.lastPlanFetchAt && Date.now() - c.lastPlanFetchAt < PLAN_FETCH_MS) return Promise.resolve(getPlan());
    return ensureToken(false)
      .then(() => api(`https://www.googleapis.com/drive/v3/files/${c.planFileId}?alt=media`))
      .then(res => res.json())
      .then(plan => updateConfig(c => { if (plan && plan.planId) c.plan = plan; c.lastPlanFetchAt = Date.now(); }).plan)
      .catch(() => getPlan());
  }
  // Drop a stored plan the app couldn't use (poisoned/malformed) so it can't break every launch.
  function clearPlan() { return updateConfig(c => { c.plan = null; }).plan; }

  // First connect — MUST be called from a user gesture (Settings). Requests consent, then creates
  // the folder + empty plan file, then flushes anything queued and pulls any existing plan.
  function connect() {
    return ensureToken(true)
      .then(() => ensureFolder())
      .then(folderId => ensurePlanFile(folderId))
      .then(() => flush()).then(() => downSync(true)).then(() => status());
  }
  function disconnect() {
    accessToken = null; tokenExpiry = 0;
    updateConfig(c => { c.plan = null; }); // keep folderId/planFileId so the loop survives reconnect
    return status();
  }

  // Point sync at a profile's namespaced config key and HARD-RESET all in-memory auth, so one
  // profile's Google token/tokenClient can never upload another profile's sessions after a switch.
  function setUser(configKey) {
    activeSyncKey = configKey || SYNC_KEY;
    accessToken = null; tokenExpiry = 0; pending = null; flushInFlight = null;
    tokenClient = null; tokenClientId = null; // rebuilt on demand for the new profile's clientId
    if (typeof document !== 'undefined') { try { preload(); } catch (e) { } }
    return activeSyncKey;
  }

  // Fallback when sync isn't configured: share the session JSON as a file (download-fallback).
  function exportSession(session) {
    const payload = sessionToPayload(session);
    const json = JSON.stringify(payload, null, 2);
    const filename = `session-${payload.sessionId || 'export'}.json`;
    if (typeof navigator !== 'undefined' && navigator.canShare && typeof File !== 'undefined') {
      const file = new File([json], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: 'Gym session' }).catch(() => downloadJson(json, filename));
    }
    return Promise.resolve(downloadJson(json, filename));
  }
  function downloadJson(json, filename) {
    if (typeof document === 'undefined') return;
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = filename; link.click();
    URL.revokeObjectURL(link.href);
  }

  // Warm up GIS at startup if a clientId is already saved, so the first Connect tap opens the popup.
  if (typeof document !== 'undefined') { try { preload(); } catch (e) {} }

  return {
    // pure
    sessionToPayload, enqueue, removeFromQueue, loadConfig, saveConfig, updateConfig,
    // browser
    configured, status, getBeighton, setBeighton, getPlan, setClientId, clearPlan, preload,
    onSessionComplete, flush, downSync, connect, disconnect, exportSession, setUser,
    SYNC_KEY, FOLDER_NAME
  };
});
