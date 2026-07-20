const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

// A confirmed-tolerated session: post !== 'worse' AND checkin.flare === false.
const sess = (started, sets, rir, checkin = { post: 'same', flare: false }) => ({
  started, checkin, exercises: [{ exerciseId: 'bench', rir, sets }]
});
const set = (weight, reps, done = true) => ({ weight, reps, done });

test('nextTarget: no prior confirmed data → null', () => {
  assert.equal(Core.nextTarget([], 'bench', {}), null);
  // A done set with no confirming check-in is not a basis.
  const unconfirmed = [{ started: 1, checkin: { post: 'same', flare: null }, exercises: [{ exerciseId: 'bench', rir: 3, sets: [set(80, 8)] }] }];
  assert.equal(Core.nextTarget(unconfirmed, 'bench', {}), null);
});

test('nextTarget: reps below top of range + RIR>=2 → same load, +1 rep', () => {
  const h = [sess(1000, [set(80, 8)], 3)];
  assert.deepEqual(Core.nextTarget(h, 'bench', {}), { weight: 80, reps: 9, rule: 'add-rep' });
});

test('nextTarget: at top of range + RIR>=2 → +1 step load, reps to bottom', () => {
  const h = [sess(1000, [set(80, 12)], 2)];
  assert.deepEqual(Core.nextTarget(h, 'bench', {}), { weight: 82.5, reps: 8, rule: 'add-load' });
});

test('nextTarget: RIR<=1 → hold', () => {
  const h = [sess(1000, [set(80, 12)], 1)];
  assert.deepEqual(Core.nextTarget(h, 'bench', {}), { weight: 80, reps: 12, rule: 'hold' });
});

test('nextTarget: RIR missing → repeat (never progress without evidence)', () => {
  const h = [sess(1000, [set(80, 8)], undefined)];
  assert.deepEqual(Core.nextTarget(h, 'bench', {}), { weight: 80, reps: 8, rule: 'repeat-no-rir' });
});

test('nextTarget: RIR skip → repeat', () => {
  const h = [sess(1000, [set(80, 8)], 'skip')];
  assert.deepEqual(Core.nextTarget(h, 'bench', {}), { weight: 80, reps: 8, rule: 'repeat-no-rir' });
});

test('nextTarget: stepDown → 0.9x rounded to step, same reps', () => {
  const h = [sess(1000, [set(100, 10)], 3)];
  assert.deepEqual(Core.nextTarget(h, 'bench', { stepDown: true }), { weight: 90, reps: 10, rule: 'step-down' });
});

test('nextTarget: block → null weight with rule blocked (even with data)', () => {
  const h = [sess(1000, [set(80, 8)], 3)];
  assert.deepEqual(Core.nextTarget(h, 'bench', { block: true }), { weight: null, reps: null, rule: 'blocked' });
});

test('nextTarget: opts.lastRir overrides stored rir; custom range + step honoured', () => {
  const h = [sess(1000, [set(60, 5)], 'skip')];
  assert.deepEqual(Core.nextTarget(h, 'bench', { lastRir: 3, repRange: [5, 8], step: 5 }), { weight: 60, reps: 6, rule: 'add-rep' });
  const h2 = [sess(1000, [set(60, 8)], 3)];
  assert.deepEqual(Core.nextTarget(h2, 'bench', { repRange: [5, 8], step: 5 }), { weight: 65, reps: 5, rule: 'add-load' });
});

test('nextTarget: basis is the TOP set of the confirmed session', () => {
  const h = [sess(1000, [set(70, 10), set(80, 6), set(75, 8)], 3)];
  assert.deepEqual(Core.nextTarget(h, 'bench', {}), { weight: 80, reps: 7, rule: 'add-rep' });
});

test('nextTarget: drop-set RIR never progresses the heavy set (basis = top NON-DROP set)', () => {
  // Main 100×8 + drop 80×12; the exercise-level RIR 3 belongs to the last WORKING set —
  // the drop must not become the basis nor let its numbers leak into the target.
  const h = [{ started: 1000, checkin: { post: 'same', flare: false }, exercises: [{ exerciseId: 'bench', rir: 3, sets: [
    { weight: 100, reps: 8, done: true },
    { weight: 80, reps: 12, done: true, drop: true }
  ] }] }];
  assert.deepEqual(Core.confirmedBasis(h, 'bench'), { weight: 100, reps: 8, rir: 3 });
  assert.deepEqual(Core.nextTarget(h, 'bench', {}), { weight: 100, reps: 9, rule: 'add-rep' });
});

test('nextTarget: all-drop exercise has no working-set RIR referent → conservative repeat', () => {
  const h = [{ started: 1000, checkin: { post: 'same', flare: false }, exercises: [{ exerciseId: 'bench', rir: 3, sets: [
    { weight: 80, reps: 12, done: true, drop: true }
  ] }] }];
  assert.equal(Core.confirmedBasis(h, 'bench').rir, undefined);
  assert.equal(Core.nextTarget(h, 'bench', {}).rule, 'repeat-no-rir');
});

test('painGate: currentPre >= 7 → block', () => {
  const g = Core.painGate([], 8);
  assert.equal(g.block, true);
  assert.equal(g.stepDown, false);
  assert.match(g.reason, /get it assessed/);
});

test('painGate: strictly rising pre across 3 sessions (today included) → stepDown', () => {
  const h = [
    { started: 3000, checkin: { pre: 4 }, exercises: [] },
    { started: 2000, checkin: { pre: 3 }, exercises: [] }
  ];
  const g = Core.painGate(h, 5);
  assert.equal(g.stepDown, true);
  assert.equal(g.block, false);
});

test('painGate: non-monotonic pain → no action', () => {
  const h = [
    { started: 3000, checkin: { pre: 5 }, exercises: [] },
    { started: 2000, checkin: { pre: 3 }, exercises: [] }
  ];
  const g = Core.painGate(h, 4); // 3,5,4 not strictly increasing
  assert.deepEqual(g, { block: false, stepDown: false, reason: '' });
});

test('painGate: fewer than 3 datapoints → no stepDown', () => {
  assert.deepEqual(Core.painGate([{ started: 1, checkin: { pre: 2 }, exercises: [] }], 3), { block: false, stepDown: false, reason: '' });
});

test('sideBalance: per-exercise L/R with signed gap and gapSessions', () => {
  const h = [
    { started: 2000, exercises: [{ exerciseId: 'db', sets: [
      { weight: 30, reps: 10, done: true, side: 'L' },
      { weight: 26, reps: 10, done: true, side: 'R' }
    ] }] },
    { started: 1000, exercises: [{ exerciseId: 'db', sets: [
      { weight: 28, reps: 10, done: true, side: 'L' },
      { weight: 24, reps: 10, done: true, side: 'R' }
    ] }] }
  ];
  const b = Core.sideBalance(h);
  assert.equal(b.db.left.topWeight, 30);
  assert.equal(b.db.right.topWeight, 26);
  assert.equal(b.db.left.sets, 2);
  assert.equal(b.db.gapPct, Math.round((30 - 26) / 30 * 100)); // +13, left heavier
  assert.equal(b.db.gapSessions, 2); // both sessions gap > 10%
});

test('sideBalance: only side-tagged sets counted; untagged exercise absent', () => {
  const h = [{ started: 1, exercises: [{ exerciseId: 'x', sets: [{ weight: 50, reps: 5, done: true }] }] }];
  assert.deepEqual(Core.sideBalance(h), {});
});

test('weeklyRecap: this week vs last week with muscle deltas', () => {
  const now = Date.UTC(2026, 6, 15, 12); // Wed
  const look = id => ({ bench: { primary: 'Chest', all: ['Chest'] } }[id] || null);
  const thisWk = { started: now - 86400000, checkin: { pre: 3 }, prs: [{}], exercises: [{ exerciseId: 'bench', sets: [{ weight: 80, reps: 8, done: true }, { weight: 80, reps: 8, done: true }] }] };
  const lastWk = { started: now - 8 * 86400000, checkin: { pre: 5 }, exercises: [{ exerciseId: 'bench', sets: [{ weight: 70, reps: 8, done: true }] }] };
  const r = Core.weeklyRecap([thisWk, lastWk], look, now);
  assert.equal(r.sets, 2);
  assert.equal(r.setsDelta, 1);
  assert.equal(r.workouts, 1);
  assert.equal(r.prs, 1);
  assert.equal(r.topMuscleDeltas[0].muscle, 'Chest');
  assert.equal(r.topMuscleDeltas[0].delta, 1); // 2 direct this week - 1 last
  assert.equal(r.painDelta, -2); // 3 - 5
});

test('recapInsights: muscle change + L/R direction, numbers only', () => {
  const recap = { topMuscleDeltas: [{ muscle: 'Chest', delta: 6 }] };
  const out = Core.recapInsights(recap, { name: 'DB press', side: 'left', gapPct: 15 });
  assert.equal(out.length, 2);
  assert.match(out[0], /Chest direct sets up 6/);
  assert.match(out[1], /Left leads right by 15% on DB press/);
});

test('repRecords: heaviest at each rep count 1..10, only existing rows', () => {
  const h = [{ exercises: [{ exerciseId: 'bench', sets: [
    { weight: 100, reps: 3, done: true }, { weight: 90, reps: 3, done: true }, { weight: 80, reps: 8, done: true }
  ] }] }];
  assert.deepEqual(Core.repRecords(h, 'bench'), [{ reps: 3, weight: 100 }, { reps: 8, weight: 80 }]);
});

test('validateBackup preserves a well-formed bodyweight log and drops junk', () => {
  const out = Core.validateBackup({ version: 2, routines: [], history: [], customExercises: [], activeSession: null, bodyweight: [{ t: 1, kg: 80 }, { bad: true }, { t: 'x', kg: 5 }] }, []);
  assert.deepEqual(out.bodyweight, [{ t: 1, kg: 80 }]);
  const noKey = Core.validateBackup({ version: 2, routines: [], history: [], customExercises: [], activeSession: null }, []);
  assert.deepEqual(noKey.bodyweight, []);
});

test('bodyweightTrend: last N days, oldest first', () => {
  const now = 100 * 86400000;
  const entries = [{ t: now, kg: 80 }, { t: now - 200 * 86400000, kg: 85 }, { t: now - 10 * 86400000, kg: 82 }];
  assert.deepEqual(Core.bodyweightTrend(entries, 90, now), [{ t: now - 10 * 86400000, kg: 82 }, { t: now, kg: 80 }]);
});
