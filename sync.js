// Google Drive up/down sync (drive.file scope ONLY) + a durable local session queue.
// UMD like core.js: browser global (DuckGymSync) and a require()-able node module.
// Design invariants (council 2026-07-18):
//  - Never block or corrupt the workout flow: every network/auth failure silently re-queues.
//  - Never popup mid-workout: an interactive token is only requested from a Settings tap.
//  - drive.file can only read files the APP created → always read coach-plan.json by its stored
//    fileId; never search-and-recreate (recreating breaks the PC-side down-sync loop).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DuckGymSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SYNC_KEY = 'gymSyncV1';
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
    return { clientId: '', folderId: null, planFileId: null, queue: [], beightonUnlocked: false, lastSyncAt: null, plan: null };
  }
  function loadConfig() {
    if (!hasLS()) return defaults();
    try { const c = JSON.parse(localStorage.getItem(SYNC_KEY)); return { ...defaults(), ...(c || {}) }; }
    catch { return defaults(); }
  }
  function saveConfig(config) {
    if (hasLS()) { try { localStorage.setItem(SYNC_KEY, JSON.stringify(config)); } catch { } }
    return config;
  }

  // ---------- token (in-memory only; SPAs get no refresh token, ~1h expiry) ----------
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;
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

  // interactive=false → silent; if it needs interaction we reject so the caller can defer to next launch.
  function requestToken(interactive) {
    return loadGsi().then(() => new Promise((resolve, reject) => {
      const clientId = loadConfig().clientId;
      if (!clientId) return reject(new Error('not-configured'));
      tokenClient = root.google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE,
        callback: response => {
          if (response && response.access_token) {
            accessToken = response.access_token;
            tokenExpiry = Date.now() + (Number(response.expires_in) || 3600) * 1000;
            resolve(accessToken);
          } else reject(new Error('no-token'));
        },
        error_callback: err => reject(err || new Error('token-error'))
      });
      // '' = silent (no UI); 'consent' forces the account chooser on the first connect.
      tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    }));
  }
  function ensureToken(interactive) {
    if (tokenValid()) return Promise.resolve(accessToken);
    return requestToken(!!interactive);
  }

  function api(path, options) {
    return fetch(path, { ...options, headers: { Authorization: `Bearer ${accessToken}`, ...(options && options.headers) } })
      .then(res => { if (!res.ok) throw new Error(`drive-${res.status}`); return res; });
  }

  // Create the app's Gym-Sync folder once; store folderId.
  function ensureFolder(config) {
    if (config.folderId) return Promise.resolve(config.folderId);
    return api('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    }).then(res => res.json()).then(file => { config.folderId = file.id; saveConfig(config); return file.id; });
  }
  // Create the empty coach-plan.json once; store planFileId. The PC brain UPDATES this file's
  // content later (via the synced Drive desktop mirror); the app only ever reads it by fileId.
  function ensurePlanFile(config) {
    if (config.planFileId) return Promise.resolve(config.planFileId);
    const meta = { name: PLAN_NAME, parents: [config.folderId], mimeType: 'application/json' };
    const boundary = 'gymsync' + Date.now();
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
      + `--${boundary}\r\nContent-Type: application/json\r\n\r\n{}\r\n--${boundary}--`;
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    }).then(res => res.json()).then(file => { config.planFileId = file.id; saveConfig(config); return file.id; });
  }

  function uploadSession(config, payload) {
    const meta = { name: `session-${payload.sessionId}.json`, parents: [config.folderId] };
    const boundary = 'gymsync' + Date.now();
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
      + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--`;
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    });
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
  function setClientId(id) { const c = loadConfig(); c.clientId = String(id || '').trim(); saveConfig(c); return c.clientId; }

  // Enqueue on session completion, then try to flush. Silent-fails to the queue.
  function onSessionComplete(session) {
    const c = loadConfig();
    c.queue = enqueue(c.queue, sessionToPayload(session));
    saveConfig(c);
    return flush();
  }

  // Flush the queue. Never popup (silent token only); on any failure items stay queued.
  function flush() {
    const c = loadConfig();
    if (!c.clientId || !(c.queue || []).length) return Promise.resolve(status());
    return ensureToken(false)
      .then(() => ensureFolder(c))
      .then(() => (c.queue || []).reduce((chain, payload) => chain.then(() =>
        uploadSession(c, payload).then(() => {
          const fresh = loadConfig();
          fresh.queue = removeFromQueue(fresh.queue, payload.sessionId);
          fresh.lastSyncAt = Date.now();
          saveConfig(fresh);
        }).catch(() => { /* keep this one queued, stop the run */ throw new Error('stop'); })
      ), Promise.resolve()))
      .then(() => status())
      .catch(() => status()); // deferred to next launch
  }

  // Down-sync: read coach-plan.json by stored fileId, parse, store. Silent-fails.
  function downSync() {
    const c = loadConfig();
    if (!c.clientId || !c.planFileId) return Promise.resolve(getPlan());
    return ensureToken(false)
      .then(() => api(`https://www.googleapis.com/drive/v3/files/${c.planFileId}?alt=media`))
      .then(res => res.json())
      .then(plan => { const fresh = loadConfig(); fresh.plan = plan && plan.planId ? plan : fresh.plan; saveConfig(fresh); return fresh.plan; })
      .catch(() => getPlan());
  }

  // First connect — MUST be called from a user gesture (Settings). Requests consent, then creates
  // the folder + empty plan file, then flushes anything queued and pulls any existing plan.
  function connect() {
    return ensureToken(true).then(() => {
      const c = loadConfig();
      return ensureFolder(c).then(() => ensurePlanFile(c)).then(() => flush()).then(() => downSync()).then(() => status());
    });
  }
  function disconnect() {
    accessToken = null; tokenExpiry = 0;
    const c = loadConfig(); c.plan = null; saveConfig(c); // keep folderId/planFileId so the loop survives reconnect
    return status();
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

  return {
    // pure
    sessionToPayload, enqueue, removeFromQueue, loadConfig, saveConfig,
    // browser
    configured, status, getBeighton, setBeighton, getPlan, setClientId,
    onSessionComplete, flush, downSync, connect, disconnect, exportSession,
    SYNC_KEY, FOLDER_NAME
  };
});
