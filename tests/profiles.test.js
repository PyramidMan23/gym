const test = require('node:test');
const assert = require('node:assert/strict');
const Profiles = require('../profiles.js');

// Minimal localStorage-compatible fake: getItem/setItem/removeItem/key/length over a Map.
function fakeStore(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    _dump: () => Object.fromEntries(map)
  };
}
const V2 = extra => JSON.stringify({ version: 2, routines: [], history: [], customExercises: [], activeSession: null, exerciseCues: {}, favourites: [], preferences: { restSeconds: 90 }, ...extra });

test('fresh boot with no legacy: one unnamed profile, no migration', () => {
  const s = fakeStore();
  const boot = Profiles.bootstrap(s, 1000);
  assert.equal(boot.created, true);
  assert.equal(boot.migrated, false);
  assert.equal(boot.needsName, true);
  const reg = Profiles.getRegistry(s);
  assert.equal(reg.profiles.length, 1);
  assert.equal(reg.activeId, boot.activeId);
  assert.equal(reg.migratedAt, null);
  // No namespaced state was invented for an empty install.
  assert.equal(s.getItem(Profiles.stateKeyFor(boot.activeId)), null);
});

test('migration copies legacy state+sync into the namespace and LEAVES legacy in place', () => {
  const legacyState = V2({ favourites: ['b0'] });
  const legacySync = JSON.stringify({ clientId: 'abc.apps.googleusercontent.com', queue: [] });
  const s = fakeStore({ duckGymV2: legacyState, gymSyncV1: legacySync });
  const boot = Profiles.bootstrap(s, 2000);
  assert.equal(boot.migrated, true);
  assert.equal(boot.needsName, true);
  const id = boot.activeId;
  // Copy fidelity: byte-identical copy into the namespaced keys.
  assert.equal(s.getItem(Profiles.stateKeyFor(id)), legacyState);
  assert.equal(s.getItem(Profiles.syncKeyFor(id)), legacySync);
  // Rollback safety: legacy keys untouched.
  assert.equal(s.getItem('duckGymV2'), legacyState);
  assert.equal(s.getItem('gymSyncV1'), legacySync);
  assert.equal(Profiles.getRegistry(s).migratedAt, 2000);
});

test('migration is idempotent: re-running never duplicates or overwrites newer namespaced data', () => {
  const s = fakeStore({ duckGymV2: V2({ favourites: ['a'] }) });
  const boot = Profiles.bootstrap(s, 3000);
  const id = boot.activeId;
  // Name it (mimic first-run) and evolve the namespaced state past the legacy snapshot.
  Profiles.setName(s, id, 'Mark');
  const newer = V2({ favourites: ['a', 'b', 'c'] });
  s.setItem(Profiles.stateKeyFor(id), newer);
  // Re-boot repeatedly.
  const boot2 = Profiles.bootstrap(s, 3001);
  Profiles.bootstrap(s, 3002);
  assert.equal(boot2.created, false);
  assert.equal(boot2.migrated, false);
  assert.equal(boot2.needsName, false); // already named
  assert.equal(Profiles.listProfiles(s).length, 1); // no duplicate profile
  assert.equal(s.getItem(Profiles.stateKeyFor(id)), newer); // newer data NOT clobbered by legacy
  assert.equal(boot2.activeId, id);
});

test('corrupt registry with existing namespaced state: backs up + rebuilds around real data', () => {
  const s = fakeStore();
  // Seed two real profiles worth of namespaced state.
  s.setItem('gym:user:p_aaaa:state', V2({ favourites: ['x'] }));
  s.setItem('gym:user:p_bbbb:state', V2({ favourites: ['y'] }));
  s.setItem('gymProfiles', '{ this is : not json');
  const boot = Profiles.bootstrap(s, 4000);
  assert.equal(boot.recovered, true);
  const reg = Profiles.getRegistry(s);
  const ids = reg.profiles.map(p => p.id).sort();
  assert.deepEqual(ids, ['p_aaaa', 'p_bbbb']); // rebuilt from the real state, nothing orphaned
  // The corrupt blob was preserved (not silently dropped).
  assert.equal(s.getItem('gymProfiles.corrupt.4000'), '{ this is : not json');
  // Data still readable under each profile.
  assert.equal(s.getItem('gym:user:p_aaaa:state'), V2({ favourites: ['x'] }));
});

test('corrupt registry with NO namespaced state: backs up + creates a fresh profile', () => {
  const s = fakeStore({ gymProfiles: 'null' });
  const boot = Profiles.bootstrap(s, 4100);
  assert.equal(boot.created, true);
  assert.equal(Profiles.listProfiles(s).length, 1);
  assert.equal(s.getItem('gymProfiles.corrupt.4100'), 'null');
});

test('namespacing isolation: two profiles keep independent state keys', () => {
  const s = fakeStore();
  const a = Profiles.bootstrap(s, 5000).activeId;
  Profiles.setName(s, a, 'A');
  s.setItem(Profiles.stateKeyFor(a), V2({ favourites: ['a-only'] }));
  const b = Profiles.addProfile(s, 'B', 5001);
  s.setItem(Profiles.stateKeyFor(b), V2({ favourites: ['b-only'] }));
  assert.notEqual(Profiles.stateKeyFor(a), Profiles.stateKeyFor(b));
  assert.match(s.getItem(Profiles.stateKeyFor(a)), /a-only/);
  assert.doesNotMatch(s.getItem(Profiles.stateKeyFor(a)), /b-only/);
  assert.match(s.getItem(Profiles.stateKeyFor(b)), /b-only/);
  // Switching active never mutates either profile's state.
  Profiles.setActive(s, b);
  assert.match(s.getItem(Profiles.stateKeyFor(a)), /a-only/);
});

test('deleteProfile removes its namespaced keys, refuses the last, reassigns active', () => {
  const s = fakeStore();
  const a = Profiles.bootstrap(s, 6000).activeId;
  const b = Profiles.addProfile(s, 'B', 6001);
  s.setItem(Profiles.stateKeyFor(b), V2());
  s.setItem(Profiles.syncKeyFor(b), '{}');
  Profiles.setActive(s, b);
  const res = Profiles.deleteProfile(s, b);
  assert.equal(res.ok, true);
  assert.equal(res.newActiveId, a); // active moved off the deleted profile
  assert.equal(s.getItem(Profiles.stateKeyFor(b)), null);
  assert.equal(s.getItem(Profiles.syncKeyFor(b)), null);
  // Cannot delete the last remaining profile.
  const last = Profiles.deleteProfile(s, a);
  assert.equal(last.ok, false);
  assert.equal(Profiles.listProfiles(s).length, 1);
});

test('PIN: set → verify roundtrip, wrong PIN fails, salt makes hashes non-trivial', async () => {
  const s = fakeStore();
  const a = Profiles.bootstrap(s, 7000).activeId;
  await Profiles.setPin(s, a, '1234');
  const p = Profiles.getProfile(s, a);
  assert.equal(p.locked, true);
  assert.equal(typeof p.pinHash, 'string');
  assert.equal(typeof p.salt, 'string');
  assert.notEqual(p.pinHash, '1234'); // never stored in the clear
  assert.equal(await Profiles.verifyPin(p, '1234'), true);
  assert.equal(await Profiles.verifyPin(p, '0000'), false);
  Profiles.clearPin(s, a);
  const cleared = Profiles.getProfile(s, a);
  assert.equal(cleared.locked, false);
  assert.equal(cleared.pinHash, null);
  assert.equal(await Profiles.verifyPin(cleared, '1234'), false);
});

test('registry survives a dangling activeId by repointing to a real profile', () => {
  const s = fakeStore({ gymProfiles: JSON.stringify({ activeId: 'p_ghost', profiles: [{ id: 'p_real', name: 'R', createdAt: 1 }] }) });
  const boot = Profiles.bootstrap(s, 8000);
  assert.equal(boot.activeId, 'p_real');
  assert.equal(Profiles.getActive(s).id, 'p_real');
});
