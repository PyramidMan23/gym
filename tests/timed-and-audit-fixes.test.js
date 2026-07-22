// Audit 2026-07-22 regression suite. Every case here failed before the fix it names.
// Timed exercises store SECONDS in the `reps` field; before this pass core.js had zero awareness
// of that, so a 60-second hold was mathematically a 60-rep set everywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const HANG = 'gr3';   // Dead Hang — bodyweight, timed
const WHANG = 'gr1';  // Hang Board Max Hangs — can be weighted, timed
const SQUAT = 'lg22'; // rep-based control

const set = (weight, reps, extra = {}) => ({ weight: String(weight), reps: String(reps), done: true, ...extra });
// A session that passes the injury-mode confirmation gate (post not 'worse', flare answered 'no').
const session = (id, started, exercises, checkin = { pre: null, post: 'same', flare: false }) =>
  ({ id, started, finished: started + 3600000, checkin, exercises });

test.beforeEach(() => Core.setTimedExercises([HANG, WHANG]));
test.after(() => Core.setTimedExercises([]));

test('registry: timed ids are recognised, others are not', () => {
  assert.equal(Core.isTimed(HANG), true);
  assert.equal(Core.isTimed(SQUAT), false);
  Core.setTimedExercises([]);
  assert.equal(Core.isTimed(HANG), false, 'empty registry = pre-timed behaviour for every exercise');
});

test('volume: a weighted 60s hold does not mint 1200kg of volume', () => {
  const s = { exercises: [{ exerciseId: WHANG, sets: [set(20, 60)] }] };
  assert.equal(Core.calculateVolume(s), 0);
  // the same numbers on a rep-based lift still count normally
  assert.equal(Core.calculateVolume({ exercises: [{ exerciseId: SQUAT, sets: [set(20, 60)] }] }), 1200);
});

test('volume: mixed session counts only the rep-based work', () => {
  const s = { exercises: [
    { exerciseId: SQUAT, sets: [set(100, 5), set(100, 5)] },
    { exerciseId: HANG, sets: [set('', 90)] }
  ] };
  assert.equal(Core.calculateVolume(s), 1000);
});

test('PR: a longer bodyweight hang IS a PR (it never could be before)', () => {
  const history = [session('s1', 1000, [{ exerciseId: HANG, sets: [set('', 45)] }])];
  const prs = Core.detectPRs(history, { exercises: [{ exerciseId: HANG, sets: [set('', 60)] }] });
  assert.equal(prs.length, 1);
  assert.equal(prs[0].seconds, 60);
  assert.equal(prs[0].estimated1RM, undefined, 'no phantom 1RM on a hold');
});

test('PR: a shorter hang is not a PR', () => {
  const history = [session('s1', 1000, [{ exerciseId: HANG, sets: [set('', 60)] }])];
  assert.deepEqual(Core.detectPRs(history, { exercises: [{ exerciseId: HANG, sets: [set('', 30)] }] }), []);
});

test('PR: a heavier weighted hold for the same time still counts', () => {
  const history = [session('s1', 1000, [{ exerciseId: WHANG, sets: [set(10, 30)] }])];
  const prs = Core.detectPRs(history, { exercises: [{ exerciseId: WHANG, sets: [set(20, 30)] }] });
  assert.equal(prs.length, 1);
  assert.equal(prs[0].weight, 20);
});

test('PR: rep-based detection is untouched', () => {
  const history = [session('s1', 1000, [{ exerciseId: SQUAT, sets: [set(100, 5)] }])];
  const prs = Core.detectPRs(history, { exercises: [{ exerciseId: SQUAT, sets: [set(110, 5)] }] });
  assert.equal(prs.length, 1);
  assert.ok(prs[0].estimated1RM > 0);
  assert.equal(prs[0].seconds, undefined);
});

test('trend: holds plot seconds, never a phantom e1RM', () => {
  const history = [
    session('s1', 1000, [{ exerciseId: WHANG, sets: [set(20, 30)] }]),
    session('s2', 2000, [{ exerciseId: WHANG, sets: [set(20, 45)] }])
  ];
  const points = Core.exerciseTrend(history, WHANG);
  assert.deepEqual(points.map(p => p.seconds), [30, 45]);
  assert.deepEqual(points.map(p => p.e1rm), [0, 0]);
});

test('progression: a hold adds SECONDS, never load with reset reps', () => {
  const history = [session('s1', 1000, [{ exerciseId: HANG, sets: [set('', 60)], rir: 3 }])];
  const t = Core.nextTarget(history, HANG, {});
  assert.equal(t.rule, 'add-time');
  assert.equal(t.reps, 65);
  assert.equal(t.weight, 0, 'bodyweight hang must never be prescribed phantom load');
  assert.equal(t.timed, true);
});

test('progression: the pre-fix bug is gone (60s no longer reads as "above rep range")', () => {
  const history = [session('s1', 1000, [{ exerciseId: HANG, sets: [set('', 60)], rir: 3 }])];
  const t = Core.nextTarget(history, HANG, { step: 2.5 });
  assert.notEqual(t.rule, 'add-load');
  assert.notEqual(t.reps, 8, 'a 60s hang must not become an 8-second target');
});

test('progression: low RIR holds the hold; no RIR repeats it', () => {
  const base = sets => [session('s1', 1000, [{ exerciseId: HANG, sets, rir: undefined }])];
  const holdH = [session('s1', 1000, [{ exerciseId: HANG, sets: [set('', 60)], rir: 1 }])];
  assert.equal(Core.nextTarget(holdH, HANG, {}).rule, 'hold');
  assert.equal(Core.nextTarget(holdH, HANG, {}).reps, 60);
  assert.equal(Core.nextTarget(base([set('', 60)]), HANG, {}).rule, 'repeat-no-rir');
});

test('progression: step-down shortens a hold instead of scaling zero load', () => {
  const history = [session('s1', 1000, [{ exerciseId: HANG, sets: [set('', 60)], rir: 3 }])];
  const t = Core.nextTarget(history, HANG, { stepDown: true });
  assert.equal(t.rule, 'step-down');
  assert.equal(t.reps, 54);
  assert.ok(t.reps < 60 && t.reps >= 1);
});

test('progression: rep-based double progression is unchanged', () => {
  const history = [session('s1', 1000, [{ exerciseId: SQUAT, sets: [set(100, 8)], rir: 3 }])];
  assert.deepEqual(Core.nextTarget(history, SQUAT, { step: 2.5 }), { weight: 100, reps: 9, rule: 'add-rep' });
  const topped = [session('s1', 1000, [{ exerciseId: SQUAT, sets: [set(100, 12)], rir: 3 }])];
  assert.deepEqual(Core.nextTarget(topped, SQUAT, { step: 2.5 }), { weight: 102.5, reps: 8, rule: 'add-load' });
});

test('repRecords: holds return no rep table', () => {
  const history = [session('s1', 1000, [{ exerciseId: HANG, sets: [set(5, 8)] }])];
  assert.deepEqual(Core.repRecords(history, HANG), []);
  assert.equal(Core.repRecords(history, SQUAT).length, 0, 'no squat sets in this history');
});

// ---- injury mode / progression gate ----
test('no-injury lifters get a target without answering a flare check', () => {
  const history = [session('s1', 1000, [{ exerciseId: SQUAT, sets: [set(100, 8)], rir: 3 }], { pre: null, post: null, flare: null })];
  assert.equal(Core.nextTarget(history, SQUAT, {}), null, 'injury gate (default) still requires confirmation');
  const t = Core.nextTarget(history, SQUAT, { requireConfirmation: false });
  assert.equal(t.rule, 'add-rep');
});

test('a session marked "worse" is never a basis, gate on or off', () => {
  const history = [session('s1', 1000, [{ exerciseId: SQUAT, sets: [set(100, 8)], rir: 3 }], { pre: null, post: 'worse', flare: null })];
  assert.equal(Core.confirmedBasis(history, SQUAT, { requireConfirmation: false }), null);
  assert.equal(Core.confirmedBasis(history, SQUAT), null);
});

// ---- pain gate ----
test('pain gate: sustained 6,6,6 now forces a step-down', () => {
  const history = [
    session('s1', 3000, [], { pre: 6, post: 'same', flare: false }),
    session('s2', 2000, [], { pre: 6, post: 'same', flare: false }),
    session('s3', 1000, [], { pre: 6, post: 'same', flare: false })
  ];
  const gate = Core.painGate(history, null);
  assert.equal(gate.stepDown, true);
  assert.equal(gate.block, false);
});

test('pain gate: rising pain still steps down, 7+ still blocks, low steady does not', () => {
  const rising = [
    session('s1', 3000, [], { pre: 5, post: 'same', flare: false }),
    session('s2', 2000, [], { pre: 3, post: 'same', flare: false }),
    session('s3', 1000, [], { pre: 1, post: 'same', flare: false })
  ];
  assert.equal(Core.painGate(rising, null).stepDown, true);
  assert.equal(Core.painGate([], 8).block, true);
  const calm = [
    session('s1', 3000, [], { pre: 2, post: 'same', flare: false }),
    session('s2', 2000, [], { pre: 2, post: 'same', flare: false }),
    session('s3', 1000, [], { pre: 2, post: 'same', flare: false })
  ];
  assert.deepEqual(Core.painGate(calm, null), { block: false, stepDown: false, reason: '' });
});

// ---- backup validation ----
test('backup import rejects an activeSession with no exercises array', () => {
  const good = { version: 2, routines: [], history: [], activeSession: { exercises: [] }, preferences: {} };
  assert.doesNotThrow(() => Core.validateBackup(good, []));
  const bad = { version: 2, routines: [], history: [], activeSession: {}, preferences: {} };
  assert.throws(() => Core.validateBackup(bad, []), /Invalid/);
  const alsoBad = { version: 2, routines: [], history: [], activeSession: { exercises: 'nope' }, preferences: {} };
  assert.throws(() => Core.validateBackup(alsoBad, []), /Invalid/);
  const noSession = { version: 2, routines: [], history: [], activeSession: null, preferences: {} };
  assert.doesNotThrow(() => Core.validateBackup(noSession, []));
});

// ---- sync: deleting a workout must not leave it queued ----
test('Sync.forget drops a deleted session from the queue and its file map', () => {
  const Sync = require('../sync.js');
  const store = {};
  global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  try {
    Sync.updateConfig(c => {
      c.queue = [{ sessionId: 'sKEEP' }, { sessionId: 'sGONE' }];
      c.uploadedFiles = { sGONE: 'file123', sKEEP: 'file456' };
    });
    Sync.forget('sGONE');
    const after = Sync.loadConfig();
    assert.deepEqual(after.queue.map(q => q.sessionId), ['sKEEP']);
    assert.equal(after.uploadedFiles.sGONE, undefined);
    assert.equal(after.uploadedFiles.sKEEP, 'file456');
  } finally { delete global.localStorage; }
});
