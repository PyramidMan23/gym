// Local profiles — Track B (council 2026-07-19-council-gym-multiuser).
// Shared-phone identity boundary: per-user namespaced state + sync, one shared catalogue.
// UMD like core.js/sync.js: browser global (DuckGymProfiles) + require()-able node module.
// Everything here is a pure function over a Storage-like adapter (getItem/setItem/removeItem/key/length),
// so the whole migration + registry lifecycle is unit-testable with a fake store and no browser.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DuckGymProfiles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const PROFILES_KEY = 'gymProfiles';
  const LEGACY_STATE_KEY = 'duckGymV2';   // the app's per-user state before profiles
  const LEGACY_SYNC_KEY = 'gymSyncV1';     // the sync config before profiles
  const stateKeyFor = id => `gym:user:${id}:state`;
  const syncKeyFor = id => `gym:user:${id}:sync`;
  const ID_RE = /^p_[A-Za-z0-9]+$/;
  const USER_STATE_RE = /^gym:user:(p_[A-Za-z0-9]+):state$/;

  const webcrypto = () => root.crypto || (typeof crypto !== 'undefined' ? crypto : null);
  function randomBytes(n) {
    const bytes = new Uint8Array(n), c = webcrypto();
    if (c && c.getRandomValues) c.getRandomValues(bytes);
    // ponytail: Math.random fallback only where WebCrypto is absent — never on a real phone; ids/salts stay opaque either way.
    else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
  }
  const toHex = bytes => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  const newId = () => 'p_' + toHex(randomBytes(8));

  const initial = name => (String(name || '').trim()[0] || '?').toUpperCase();

  function normalizeProfile(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !ID_RE.test(p.id) || typeof p.name !== 'string') return null;
    return {
      id: p.id,
      name: p.name,
      emoji: typeof p.emoji === 'string' ? p.emoji : '',
      locked: !!p.locked,
      pinHash: typeof p.pinHash === 'string' ? p.pinHash : null,
      salt: typeof p.salt === 'string' ? p.salt : null,
      createdAt: Number(p.createdAt) || Date.now()
    };
  }

  // Parse + validate the registry. Returns null on missing/corrupt/empty so the caller rebuilds.
  function parseRegistry(raw) {
    if (raw == null) return null;
    let data; try { data = JSON.parse(raw); } catch { return null; }
    if (!data || typeof data !== 'object' || !Array.isArray(data.profiles)) return null;
    const seen = new Set();
    const profiles = [];
    for (const p of data.profiles) {
      const norm = normalizeProfile(p);
      if (!norm || seen.has(norm.id)) continue;
      seen.add(norm.id); profiles.push(norm);
    }
    if (!profiles.length) return null;
    let activeId = typeof data.activeId === 'string' && seen.has(data.activeId) ? data.activeId : profiles[0].id;
    return {
      activeId, profiles,
      migratedAt: Number(data.migratedAt) || null,
      recoveredAt: Number(data.recoveredAt) || null
    };
  }

  function readRegistry(storage) { return parseRegistry(storage.getItem(PROFILES_KEY)); }
  function writeRegistry(storage, reg) { storage.setItem(PROFILES_KEY, JSON.stringify(reg)); return reg; }
  // Read/modify/write helper — mutate is handed a fresh parsed registry.
  function updateRegistry(storage, mutate) {
    const reg = readRegistry(storage);
    if (!reg) return null;
    mutate(reg);
    // A mutation can never orphan the active pointer.
    if (!reg.profiles.some(p => p.id === reg.activeId)) reg.activeId = reg.profiles[0] ? reg.profiles[0].id : reg.activeId;
    return writeRegistry(storage, reg);
  }

  // Enumerate profile ids that already own namespaced state — the anchor for corrupt-registry recovery.
  function listStateIds(storage) {
    const ids = [], n = Number(storage.length) || 0;
    for (let i = 0; i < n; i++) {
      const key = storage.key ? storage.key(i) : null;
      const m = key && key.match(USER_STATE_RE);
      if (m) ids.push(m[1]);
    }
    return ids;
  }

  const blankProfile = (id, name, now) => ({ id, name: name || '', emoji: '', locked: false, pinHash: null, salt: null, createdAt: now });

  // Ensure a valid registry + active profile exists. Handles: normal boot, first-ever run,
  // legacy migration (copy, never move), and corrupt-registry recovery. IDEMPOTENT — re-running
  // never duplicates a profile, never re-copies over newer namespaced data, never clobbers a name.
  function bootstrap(storage, now) {
    now = now || Date.now();
    const rawReg = storage.getItem(PROFILES_KEY);
    const reg = parseRegistry(rawReg);
    if (reg) {
      // Valid registry → normal boot. Repair a dangling active pointer only.
      if (!reg.profiles.some(p => p.id === reg.activeId)) { reg.activeId = reg.profiles[0].id; writeRegistry(storage, reg); }
      const active = reg.profiles.find(p => p.id === reg.activeId);
      return { registry: reg, activeId: reg.activeId, migrated: false, created: false, recovered: false, needsName: !active.name };
    }

    // No usable registry. If a raw value was present it was corrupt — back it up before overwriting.
    let recovered = false;
    if (rawReg != null) { try { storage.setItem(PROFILES_KEY + '.corrupt.' + now, rawReg); } catch { } recovered = true; }

    // Recovery: if namespaced state already exists, rebuild the registry around it so no data is orphaned.
    const existingIds = listStateIds(storage);
    if (existingIds.length) {
      const profiles = existingIds.map((id, i) => blankProfile(id, '', now + i));
      const rebuilt = { activeId: profiles[0].id, profiles, migratedAt: null, recoveredAt: now };
      writeRegistry(storage, rebuilt);
      return { registry: rebuilt, activeId: rebuilt.activeId, migrated: false, created: false, recovered: true, needsName: true };
    }

    // Fresh registry: one profile. Copy any legacy state/sync into its namespace (guarded → idempotent).
    const id = newId();
    let migrated = false;
    const legacyState = storage.getItem(LEGACY_STATE_KEY);
    const legacySync = storage.getItem(LEGACY_SYNC_KEY);
    if (legacyState != null && storage.getItem(stateKeyFor(id)) == null) { storage.setItem(stateKeyFor(id), legacyState); migrated = true; }
    if (legacySync != null && storage.getItem(syncKeyFor(id)) == null) { storage.setItem(syncKeyFor(id), legacySync); migrated = true; }
    // Legacy keys are LEFT in place untouched as a rollback safety copy.
    const fresh = {
      activeId: id, profiles: [blankProfile(id, '', now)],
      migratedAt: migrated ? now : null, recoveredAt: recovered ? now : null
    };
    writeRegistry(storage, fresh);
    return { registry: fresh, activeId: id, migrated, created: true, recovered, needsName: true };
  }

  function getRegistry(storage) { return readRegistry(storage); }
  function listProfiles(storage) { const r = readRegistry(storage); return r ? r.profiles : []; }
  function getActive(storage) { const r = readRegistry(storage); return r ? r.profiles.find(p => p.id === r.activeId) || null : null; }
  function getProfile(storage, id) { const r = readRegistry(storage); return r ? r.profiles.find(p => p.id === id) || null : null; }

  function setActive(storage, id) { return updateRegistry(storage, r => { if (r.profiles.some(p => p.id === id)) r.activeId = id; }); }
  function setName(storage, id, name) {
    return updateRegistry(storage, r => { const p = r.profiles.find(x => x.id === id); if (p) p.name = String(name || '').trim(); });
  }
  // Add a profile (does not switch to it). Returns the new id.
  function addProfile(storage, name, now) {
    const id = newId();
    updateRegistry(storage, r => { r.profiles.push(blankProfile(id, String(name || '').trim(), now || Date.now())); });
    return id;
  }
  // Delete a profile + its namespaced state/sync. Refuses to delete the last profile.
  // If the active profile is deleted the active pointer moves to another (returned as newActiveId).
  function deleteProfile(storage, id) {
    const reg = readRegistry(storage);
    if (!reg || reg.profiles.length <= 1 || !reg.profiles.some(p => p.id === id)) return { ok: false, newActiveId: reg ? reg.activeId : null };
    reg.profiles = reg.profiles.filter(p => p.id !== id);
    if (reg.activeId === id) reg.activeId = reg.profiles[0].id;
    writeRegistry(storage, reg);
    try { storage.removeItem(stateKeyFor(id)); storage.removeItem(syncKeyFor(id)); } catch { }
    return { ok: true, newActiveId: reg.activeId };
  }

  // ---- Optional PIN lock (council: a UI privacy boundary, NOT forensic security) ----
  async function sha256Hex(text) {
    const c = webcrypto();
    if (!(c && c.subtle)) throw new Error('no-subtle-crypto');
    const digest = await c.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return toHex(new Uint8Array(digest));
  }
  const hashPin = (pin, salt) => sha256Hex(`${salt}:${pin}`);
  async function setPin(storage, id, pin) {
    const salt = toHex(randomBytes(16));
    const pinHash = await hashPin(String(pin), salt);
    updateRegistry(storage, r => { const p = r.profiles.find(x => x.id === id); if (p) { p.locked = true; p.pinHash = pinHash; p.salt = salt; } });
    return true;
  }
  function clearPin(storage, id) {
    return updateRegistry(storage, r => { const p = r.profiles.find(x => x.id === id); if (p) { p.locked = false; p.pinHash = null; p.salt = null; } });
  }
  async function verifyPin(profile, pin) {
    if (!profile || !profile.pinHash || !profile.salt) return false;
    return (await hashPin(String(pin), profile.salt)) === profile.pinHash;
  }

  return {
    // constants + key helpers
    PROFILES_KEY, LEGACY_STATE_KEY, LEGACY_SYNC_KEY, stateKeyFor, syncKeyFor, newId, initial,
    // registry lifecycle
    parseRegistry, bootstrap, getRegistry, listProfiles, getActive, getProfile, listStateIds,
    setActive, setName, addProfile, deleteProfile,
    // pin
    hashPin, setPin, clearPin, verifyPin
  };
});
