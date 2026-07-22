// Declared goals (2026-07-22): the app can finally measure progress toward something the lifter
// stated, not just emergent PRs. Progress is measured from where they STARTED, so a goal never
// credits work done before it existed.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const HANG = 'gr3', SQUAT = 'lg22';
const set = (weight, reps) => ({ weight: String(weight), reps: String(reps), done: true });
const session = (started, exercises = []) => ({ id: 's' + started, started, finished: started + 3600000, exercises });
const WEEK = 7 * 86400000;
// A fixed Wednesday, so week-boundary maths is deterministic.
const NOW = new Date('2026-07-22T10:00:00').getTime();

test.beforeEach(() => Core.setTimedExercises([HANG]));
test.after(() => Core.setTimedExercises([]));

// ---- strength ----
test('strength goal measures distance travelled from the starting best', () => {
  const history = [session(NOW - 86400000, [{ exerciseId: SQUAT, sets: [set(80, 5)] }])];
  const goal = { id: 'g1', type: 'strength', exerciseId: SQUAT, target: 100, startValue: 60, created: NOW - WEEK };
  const p = Core.goalProgress(goal, { history, now: NOW });
  assert.equal(p.current, 80);
  assert.equal(p.target, 100);
  assert.equal(p.unit, 'kg');
  assert.equal(p.pct, 0.5, '60 -> 80 of a 60 -> 100 goal is half way');
  assert.equal(p.done, false);
  assert.equal(p.remaining, 20);
});

test('strength goal completes when the target is lifted', () => {
  const history = [session(NOW - 86400000, [{ exerciseId: SQUAT, sets: [set(100, 3)] }])];
  const p = Core.goalProgress({ type: 'strength', exerciseId: SQUAT, target: 100, startValue: 60 }, { history, now: NOW });
  assert.equal(p.done, true);
  assert.equal(p.pct, 1);
  assert.equal(p.remaining, 0);
});

test('strength goal on a HOLD is measured in seconds, not kilos', () => {
  const history = [session(NOW - 86400000, [{ exerciseId: HANG, sets: [set('', 75)] }])];
  const p = Core.goalProgress({ type: 'strength', exerciseId: HANG, target: 120, startValue: 60 }, { history, now: NOW });
  assert.equal(p.unit, 's');
  assert.equal(p.current, 75);
  assert.equal(p.pct, 0.25);
});

test('strength goal with no logged sets reports no evidence, never a fake zero', () => {
  const p = Core.goalProgress({ type: 'strength', exerciseId: SQUAT, target: 100, startValue: null }, { history: [], now: NOW });
  assert.equal(p.current, null);
  assert.equal(p.noEvidence, true);
  assert.equal(p.pct, 0);
});

test('progress never runs backwards past zero or past full', () => {
  const back = [session(NOW - 86400000, [{ exerciseId: SQUAT, sets: [set(40, 5)] }])];
  assert.equal(Core.goalProgress({ type: 'strength', exerciseId: SQUAT, target: 100, startValue: 60 }, { history: back, now: NOW }).pct, 0);
  const over = [session(NOW - 86400000, [{ exerciseId: SQUAT, sets: [set(140, 5)] }])];
  assert.equal(Core.goalProgress({ type: 'strength', exerciseId: SQUAT, target: 100, startValue: 60 }, { history: over, now: NOW }).pct, 1);
});

// ---- bodyweight (must work in BOTH directions) ----
test('bodyweight goal going down', () => {
  const bodyweight = [{ t: NOW - WEEK, kg: 90 }, { t: NOW - 86400000, kg: 86 }];
  const p = Core.goalProgress({ type: 'bodyweight', target: 80, startValue: 90 }, { bodyweight, now: NOW });
  assert.equal(p.current, 86);
  assert.equal(p.pct, 0.4, '90 -> 86 of a 90 -> 80 goal');
  assert.equal(p.done, false);
  assert.equal(p.remaining, 6);
});

test('bodyweight goal going up', () => {
  const bodyweight = [{ t: NOW - WEEK, kg: 70 }, { t: NOW - 86400000, kg: 74 }];
  const p = Core.goalProgress({ type: 'bodyweight', target: 80, startValue: 70 }, { bodyweight, now: NOW });
  assert.equal(p.pct, 0.4);
  assert.equal(p.remaining, 6);
  assert.equal(p.done, false);
});

test('bodyweight goal completes on reaching the target from either side', () => {
  const down = Core.goalProgress({ type: 'bodyweight', target: 80, startValue: 90 }, { bodyweight: [{ t: NOW, kg: 79 }], now: NOW });
  assert.equal(down.done, true);
  const up = Core.goalProgress({ type: 'bodyweight', target: 80, startValue: 70 }, { bodyweight: [{ t: NOW, kg: 81 }], now: NOW });
  assert.equal(up.done, true);
});

test('bodyweight uses the LATEST entry regardless of insertion order', () => {
  const bodyweight = [{ t: NOW - 86400000, kg: 86 }, { t: NOW - WEEK, kg: 90 }];
  assert.equal(Core.latestBodyweight(bodyweight), 86);
  assert.equal(Core.latestBodyweight([]), null);
});

// ---- consistency ----
test('consistency goal counts this week against the target', () => {
  const history = [session(NOW - 86400000), session(NOW - 2 * 86400000)];
  const p = Core.goalProgress({ type: 'consistency', target: 3 }, { history, now: NOW });
  assert.equal(p.current, 2);
  assert.equal(p.remaining, 1);
  assert.equal(p.done, false);
  assert.ok(p.pct > 0.66 && p.pct < 0.67);
});

test('an unfinished week never breaks the streak', () => {
  // Two full prior weeks at 3 sessions, nothing logged yet this week.
  const history = [];
  for (const w of [1, 2]) for (const d of [0, 1, 2]) history.push(session(NOW - w * WEEK - d * 86400000));
  const p = Core.goalProgress({ type: 'consistency', target: 3 }, { history, now: NOW });
  assert.equal(p.current, 0, 'nothing logged this week yet');
  assert.equal(p.streak, 2, 'the two completed weeks still count');
});

test('the current week joins the streak once it is met', () => {
  // NOW is a Wednesday and weeks start Monday, so only 0-2 days back is still "this week".
  const history = [session(NOW), session(NOW - 86400000), session(NOW - 2 * 86400000)];
  for (const d of [0, 1, 2]) history.push(session(NOW - WEEK - d * 86400000));
  const p = Core.goalProgress({ type: 'consistency', target: 3 }, { history, now: NOW });
  assert.equal(p.current, 3);
  assert.equal(p.done, true);
  assert.equal(p.streak, 2, 'this week is met, so it counts alongside last week');
});

test('a missed week ends the streak', () => {
  const history = [];
  for (const d of [0, 1, 2]) history.push(session(NOW - WEEK - d * 86400000)); // last week: 3
  for (const d of [0, 1, 2]) history.push(session(NOW - 3 * WEEK - d * 86400000)); // 3 weeks ago: 3, gap between
  assert.equal(Core.weekStreak(history, 3, NOW), 1);
});

// ---- storage hygiene ----
test('normalizeGoals drops malformed rows instead of throwing in a render', () => {
  const goals = Core.normalizeGoals([
    { id: 'g1', type: 'strength', exerciseId: SQUAT, target: 100, created: 1 },
    { id: 'g2', type: 'strength', target: 100 },            // no exercise
    { id: 'g3', type: 'nonsense', target: 5 },              // unknown type
    { id: 'g4', type: 'bodyweight', target: 0 },            // non-positive target
    { id: 'g5', type: 'consistency', target: 4, created: 2 },
    null, 'nope', 42
  ]);
  assert.deepEqual(goals.map(g => g.id), ['g1', 'g5']);
  assert.equal(goals[1].exerciseId, null);
  assert.equal(Core.normalizeGoals(null).length, 0);
});

test('newlyAchieved returns only unstamped, genuinely met goals', () => {
  const history = [session(NOW - 86400000, [{ exerciseId: SQUAT, sets: [set(100, 3)] }])];
  const goals = [
    { id: 'hit', type: 'strength', exerciseId: SQUAT, target: 100, startValue: 60 },
    { id: 'already', type: 'strength', exerciseId: SQUAT, target: 90, startValue: 60, achievedAt: NOW - 1000 },
    { id: 'miss', type: 'strength', exerciseId: SQUAT, target: 140, startValue: 60 }
  ];
  assert.deepEqual(Core.newlyAchieved(goals, { history, now: NOW }).map(g => g.id), ['hit']);
});

test('goalProgress refuses an unknown goal shape rather than guessing', () => {
  assert.equal(Core.goalProgress(null, {}), null);
  assert.equal(Core.goalProgress({ type: 'wat', target: 1 }, {}), null);
});
