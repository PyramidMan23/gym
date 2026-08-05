// Volume honesty + session duration (2026-08-05).
// Ty reported "the same workout a week apart, wildly different volume". It was never a maths bug:
// kg volume is sum(weight x reps), so a set ticked off with no weight contributes exactly zero and
// disappears from the headline. These gates pin the three reads that make that visible, and the
// duration read that stops a session left open overnight reporting 1618 minutes of training.
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../core.js');

// Ty's real Legs session, 2026-07-28, transcribed from his screenshot. Three loaded lifts,
// five logged bare. The kg tile said 4.4k; that is the sum of the three loaded ones only.
const TY_LEGS = () => ({
  id: 'ty1', name: 'Ty · PPL · Legs', started: 1000, finished: 1000 + 70 * 60000,
  exercises: [
    { exerciseId: 'lg3', sets: [w(50, 10), w(50, 8), w(50, 8)] },              // Smith Machine Squat
    { exerciseId: 'lg42', sets: [w(60, 10), w(60, 10), w(60, 10)] },           // Trap Bar RDL
    { exerciseId: 'lg43', sets: [w(40, 12), w(45, 8), w(45, 10)] },            // Banded Glute Bridge
    { exerciseId: 'lg23', sets: [w('', 10), w('', 10), w('', 8)] },            // Leg Extension - bare
    { exerciseId: 'lg14', sets: [w('', 10), w('', 10), w('', 10)] },           // Leg Curl - bare
    { exerciseId: 'lg13', sets: [w('', 7), w('', 7), w('', 7)] },              // Nordic - bare
    { exerciseId: 'lg19', sets: [w('', 12), w('', 12), w('', 12)] },           // Tibialis (SL) - bare
    { exerciseId: 'co1', sets: [w('', 10), w('', 10), w('', 10)] }             // Hanging Leg Raise - bare
  ]
});
function w(weight, reps, extra) { return Object.assign({ weight: String(weight), reps: String(reps), done: true }, extra || {}); }

test.beforeEach(() => Core.setTimedExercises([]));

test('the kg headline counts only the loaded lifts - which is the whole bug', () => {
  const s = TY_LEGS();
  assert.strictEqual(Core.calculateVolume(s), 4390); // matches the 4.4k his phone showed
  const cover = Core.volumeCoverage(s);
  assert.deepStrictEqual({ loaded: cover.loaded, total: cover.total, complete: cover.complete },
    { loaded: 3, total: 8, complete: false });
});

test('an identical session differs by thousands purely on whether a load got typed', () => {
  const bare = TY_LEGS();
  const typed = TY_LEGS();
  // Same movements, same reps, same order. The only difference is 60 kg on the leg extension.
  typed.exercises[3].sets.forEach(set => { set.weight = '60'; });
  assert.strictEqual(Core.calculateVolume(bare), 4390);
  assert.strictEqual(Core.calculateVolume(typed), 6070);
  assert.ok(Core.calculateVolume(typed) - Core.calculateVolume(bare) > 1600);
});

test('volumeCoverage ignores timed holds - they are not on the kg axis at all', () => {
  Core.setTimedExercises(['cs35']);
  const s = TY_LEGS();
  s.exercises.push({ exerciseId: 'cs35', sets: [w('', 20), w('', 15)] });
  const cover = Core.volumeCoverage(s);
  assert.strictEqual(cover.total, 8, 'the hold must not be counted as a lift missing its load');
});

test('volumeCoverage ignores exercises with no completed sets', () => {
  const s = TY_LEGS();
  s.exercises.push({ exerciseId: 'lg20', sets: [{ weight: '', reps: '', done: false }] });
  assert.strictEqual(Core.volumeCoverage(s).total, 8);
});

test('loadGaps names only lifts this lifter has loaded BEFORE - never a guess', () => {
  const session = TY_LEGS();
  const history = [{
    id: 'older', started: 500,
    exercises: [
      { exerciseId: 'lg23', sets: [w(60, 10), w(65, 8)] },  // leg extension WAS loaded last week
      { exerciseId: 'co1', sets: [w('', 10)] }              // hanging leg raise never was
    ]
  }];
  const gaps = Core.loadGaps(history, session);
  assert.deepStrictEqual(gaps, [{ exerciseId: 'lg23', lastWeight: 65 }]);
});

test('loadGaps is silent for a lifter with no history at all', () => {
  assert.deepStrictEqual(Core.loadGaps([], TY_LEGS()), []);
});

test('loadGaps ignores the session under inspection even when it is already in history', () => {
  const session = TY_LEGS();
  // A finished session checked against a history that already contains it must not compare to itself.
  const history = [session, { id: 'older', started: 500, exercises: [{ exerciseId: 'lg14', sets: [w(35, 10)] }] }];
  const gaps = Core.loadGaps(history, session);
  assert.deepStrictEqual(gaps.map(g => g.exerciseId), ['lg14']);
});

test('openingLoads returns the lifter own top load per lift, and nothing for the never-loaded', () => {
  const history = [
    { id: 'a', started: 900, exercises: [{ exerciseId: 'lg3', sets: [w(50, 10), w(55, 6)] }] },
    { id: 'b', started: 800, exercises: [{ exerciseId: 'co1', sets: [w('', 10)] }] }
  ];
  const loads = Core.openingLoads(history, ['lg3', 'co1', 'lg99']);
  assert.deepStrictEqual(loads, { lg3: 55 });
});

test('openingLoads never seeds a timed hold', () => {
  Core.setTimedExercises(['cs35']);
  const history = [{ id: 'a', started: 900, exercises: [{ exerciseId: 'cs35', sets: [w(10, 30)] }] }];
  assert.deepStrictEqual(Core.openingLoads(history, ['cs35']), {});
});

// ---- Duration ---------------------------------------------------------------------------------
test('a plausible session still reports plain wall time', () => {
  const s = { started: 0, finished: 70 * 60000, exercises: [] };
  assert.deepStrictEqual(Core.sessionMinutes(s), { minutes: 70, capped: false, estimated: false });
});

test('a session left open overnight reports its real training span from the set stamps', () => {
  const base = 1000;
  const s = {
    started: base, finished: base + 27 * 3600000,   // ticked "finish" the next evening
    exercises: [{ exerciseId: 'lg3', sets: [
      { weight: '50', reps: '10', done: true, at: base + 5 * 60000 },
      { weight: '50', reps: '8', done: true, at: base + 68 * 60000 }
    ] }]
  };
  const read = Core.sessionMinutes(s);
  assert.deepStrictEqual(read, { minutes: 63, capped: false, estimated: true });
});

test('an implausible session with no stamps refuses to invent a number', () => {
  const s = { started: 0, finished: 27 * 3600000, exercises: [{ exerciseId: 'lg3', sets: [w(50, 10)] }] };
  const read = Core.sessionMinutes(s);
  assert.strictEqual(read.minutes, null);
  assert.strictEqual(read.capped, true);
  // summarizeSession still hands every caller a number to print, flagged as a floor not a measurement.
  const summary = Core.summarizeSession(s);
  assert.strictEqual(summary.durationCapped, true);
  assert.strictEqual(summary.durationMinutes, 240);
});

test('Ty 1618-minute receipt: the exact reported figure can no longer be produced', () => {
  const s = { started: 0, finished: 1618 * 60000, exercises: [{ exerciseId: 'lg3', sets: [w(50, 10)] }] };
  assert.notStrictEqual(Core.summarizeSession(s).durationMinutes, 1618);
});

test('stamps spanning longer than the cap are rejected too - a stamp is not a licence', () => {
  const s = {
    started: 0, finished: 30 * 3600000,
    exercises: [{ exerciseId: 'lg3', sets: [
      { weight: '50', reps: '10', done: true, at: 0 },
      { weight: '50', reps: '8', done: true, at: 29 * 3600000 }
    ] }]
  };
  assert.strictEqual(Core.sessionMinutes(s).capped, true);
});

test('a single stamp cannot make a span - one point is not a duration', () => {
  const s = { started: 0, finished: 27 * 3600000,
    exercises: [{ exerciseId: 'lg3', sets: [{ weight: '50', reps: '10', done: true, at: 500 }] }] };
  assert.strictEqual(Core.trainingSpanMs(s), null);
  assert.strictEqual(Core.sessionMinutes(s).capped, true);
});
