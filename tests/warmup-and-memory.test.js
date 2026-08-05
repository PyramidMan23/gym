// Warm-up ladders and the warm-up/working-set boundary (2026-08-05, whole-app review).
// The dangerous part of adding warm-ups is not generating them - it is that a 20 kg empty bar must
// never be mistaken for evidence of what you can lift. These gates pin that boundary.
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../core.js');

test.beforeEach(() => { Core.setTimedExercises([]); Core.setBodyweightModel({}); });

test('a warm-up ladder ramps to the working weight and never reaches it', () => {
  const rungs = Core.warmupSets(100, 20, 2.5);
  assert.ok(rungs.length >= 3, 'a 100 kg lift deserves a real ramp');
  assert.strictEqual(rungs[0].kg, 20, 'the ladder starts with the empty bar');
  for (const r of rungs) assert.ok(r.kg < 100, `${r.kg} is not below the working weight`);
  // Monotonically heavier, monotonically fewer reps.
  for (let i = 1; i < rungs.length; i++) {
    assert.ok(rungs[i].kg > rungs[i - 1].kg, 'each rung must be heavier than the last');
    assert.ok(rungs[i].reps <= rungs[i - 1].reps, 'reps must not climb as load climbs');
  }
});

test('every rung is loadable on the lifter own increment', () => {
  for (const step of [2.5, 1.25, 5]) {
    for (const r of Core.warmupSets(142.5, 20, step))
      assert.ok(Math.abs(r.kg / step - Math.round(r.kg / step)) < 1e-9,
        `${r.kg} kg is not reachable in ${step} kg steps`);
  }
});

test('a light working weight gets NO warm-up - a ramp to 25 kg is theatre', () => {
  assert.deepStrictEqual(Core.warmupSets(25, 20), []);
  assert.deepStrictEqual(Core.warmupSets(20, 20), []);
  assert.deepStrictEqual(Core.warmupSets(0, 20), []);
});

test('duplicate rungs are collapsed rather than repeated', () => {
  const rungs = Core.warmupSets(40, 20, 2.5);
  const kgs = rungs.map(r => r.kg);
  assert.strictEqual(new Set(kgs).size, kgs.length, 'the same load twice is not a ramp');
});

test('a heavier bar shifts the whole ladder', () => {
  assert.strictEqual(Core.warmupSets(120, 25, 2.5)[0].kg, 25);
});

// ---- The boundary that matters ------------------------------------------------------------------
const W = (weight, reps, extra) => Object.assign({ weight: String(weight), reps: String(reps), done: true }, extra || {});

test('warm-up sets are NOT evidence of what you lifted', () => {
  const history = [{
    id: 's1', started: 1000,
    exercises: [{ exerciseId: 'lg1', sets: [W(20, 8, { warmup: true }), W(60, 5, { warmup: true }), W(100, 5), W(100, 5)] }]
  }];
  // previousPerformance drives the "last time" line AND the opening prefill. If it saw the warm-ups
  // it would offer an empty bar as next session's starting load.
  const prev = Core.previousPerformance(history, 'lg1');
  assert.deepStrictEqual(prev, [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }]);
  assert.deepStrictEqual(Core.openingLoads(history, ['lg1']), { lg1: 100 });
});

test('warm-up sets DO count as work done - they are still reps under load', () => {
  const session = { exercises: [{ exerciseId: 'lg1', sets: [W(20, 8, { warmup: true }), W(100, 5)] }] };
  assert.strictEqual(Core.calculateVolume(session), 20 * 8 + 100 * 5);
  assert.strictEqual(Core.summarizeSession(session).completedSets, 2);
});

test('an all-warm-up exercise reports no previous performance at all', () => {
  const history = [{ id: 's1', started: 1000, exercises: [{ exerciseId: 'lg1', sets: [W(20, 8, { warmup: true })] }] }];
  assert.deepStrictEqual(Core.previousPerformance(history, 'lg1'), [],
    'bailing out after warm-ups is not a working set');
});

test('plateBreakdown gives a loadable per-side answer for the hint', () => {
  const b = Core.plateBreakdown(100, 20);
  assert.strictEqual(b.perSide.reduce((a, x) => a + x, 0) * 2 + 20, 100);
  assert.strictEqual(b.remainder, 0);
  // An unloadable target reports the shortfall rather than rounding it away silently.
  assert.ok(Core.plateBreakdown(101, 20).remainder > 0);
});

test('recentSessionsFor returns newest first and skips sessions without the lift', () => {
  const history = [
    { id: 'c', started: 3000, exercises: [{ exerciseId: 'ch1', sets: [W(60, 8)] }] },
    { id: 'b', started: 2000, exercises: [{ exerciseId: 'lg1', sets: [W(90, 5)] }] },
    { id: 'a', started: 1000, exercises: [{ exerciseId: 'lg1', sets: [W(80, 5)] }] }
  ];
  const recent = Core.recentSessionsFor(history, 'lg1', 3);
  assert.deepStrictEqual(recent.map(r => r.started), [2000, 1000]);
});
