const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

test('calculateVolume counts only completed weighted sets', () => {
  const session = { exercises: [{ sets: [
    { weight: 100, reps: 5, done: true },
    { weight: 100, reps: 5, done: false },
    { weight: 0, reps: 12, done: true }
  ] }] };
  assert.equal(Core.calculateVolume(session), 500);
});

test('createSession makes independent sets and preserves exercise order', () => {
  const routine = { id: 'r1', name: 'Upper', exerciseIds: ['bench', 'row'] };
  const session = Core.createSession(routine, 1234);
  assert.equal(session.name, 'Upper');
  assert.deepEqual(session.exercises.map(x => x.exerciseId), ['bench', 'row']);
  session.exercises[0].sets[0].reps = 8;
  assert.equal(session.exercises[1].sets[0].reps, '');
});

test('previousPerformance returns latest completed sets for an exercise', () => {
  const history = [
    { started: 200, exercises: [{ exerciseId: 'bench', sets: [{ weight: 80, reps: 8, done: true }] }] },
    { started: 100, exercises: [{ exerciseId: 'bench', sets: [{ weight: 70, reps: 10, done: true }] }] }
  ];
  assert.deepEqual(Core.previousPerformance(history, 'bench'), [{ weight: 80, reps: 8 }]);
});

test('detectPRs finds weight and estimated one rep max records without double counting exercise', () => {
  const history = [{ exercises: [{ exerciseId: 'bench', sets: [{ weight: 80, reps: 5, done: true }] }] }];
  const session = { exercises: [
    { exerciseId: 'bench', sets: [{ weight: 82.5, reps: 5, done: true }] },
    { exerciseId: 'row', sets: [{ weight: 50, reps: 10, done: true }] }
  ] };
  const prs = Core.detectPRs(history, session);
  assert.equal(prs.length, 2);
  assert.deepEqual(prs.map(x => x.exerciseId), ['bench', 'row']);
});

test('summarizeSession returns duration, completed sets and volume', () => {
  const session = { started: 1000, finished: 61000, exercises: [{ sets: [
    { weight: 20, reps: 10, done: true }, { weight: 20, reps: 10, done: false }
  ] }] };
  assert.deepEqual(Core.summarizeSession(session), { durationMinutes: 1, completedSets: 1, volume: 200 });
});

test('weeklyStats uses local week boundary and counts workouts and volume', () => {
  const now = new Date('2026-07-12T12:00:00').getTime();
  const history = [
    { started: new Date('2026-07-12T09:00:00').getTime(), exercises: [{ sets: [{ weight: 10, reps: 10, done: true }] }] },
    { started: new Date('2026-07-05T09:00:00').getTime(), exercises: [{ sets: [{ weight: 99, reps: 10, done: true }] }] }
  ];
  assert.deepEqual(Core.weeklyStats(history, now), { workouts: 1, volume: 100, completedSets: 1 });
});

test('migrateLegacy preserves existing routines, history and custom exercises', () => {
  const migrated = Core.migrateLegacy({
    dg_workouts: JSON.stringify([{ id: 'w1', name: 'Legs', exerciseIds: ['b1'] }]),
    dg_history: JSON.stringify([{ id: 's1', name: 'Legs', started: 1, exercises: [] }]),
    dg_custom: JSON.stringify([{ id: 'c1', name: 'My Move', muscle: 'Core' }])
  });
  assert.equal(migrated.routines.length, 1);
  assert.equal(migrated.history.length, 1);
  assert.equal(migrated.customExercises[0].equipment, 'Custom equipment');
  assert.equal(migrated.preferences.weeklyWorkoutGoal, 4);
  assert.equal(migrated.preferences.weeklySetGoal, 48);
  assert.equal(migrated.preferences.weeklyVolumeGoal, 10000);
  assert.equal(migrated.version, 2);
});

test('formatDuration handles hours and short sessions', () => {
  assert.equal(Core.formatDuration(59), '00:59');
  assert.equal(Core.formatDuration(3661), '1:01:01');
});

test('ringProgress clamps completion while preserving the real value', () => {
  assert.deepEqual(Core.ringProgress(3, 4), { value: 3, goal: 4, ratio: 0.75 });
  assert.deepEqual(Core.ringProgress(7, 4), { value: 7, goal: 4, ratio: 1 });
  assert.deepEqual(Core.ringProgress(2, 0), { value: 2, goal: 0, ratio: 0 });
});

test('normalizeActivityGoals repairs missing, invalid and string preferences', () => {
  assert.deepEqual(Core.normalizeActivityGoals({}), {
    weeklyWorkoutGoal: 4,
    weeklySetGoal: 48,
    weeklyVolumeGoal: 10000
  });
  assert.deepEqual(Core.normalizeActivityGoals({
    weeklyWorkoutGoal: '5',
    weeklySetGoal: 0,
    weeklyVolumeGoal: -20
  }), {
    weeklyWorkoutGoal: 5,
    weeklySetGoal: 48,
    weeklyVolumeGoal: 10000
  });
});

test('activityMessage encourages each stage of weekly completion', () => {
  assert.deepEqual(Core.activityMessage(0), { title: 'Start your week.', detail: 'One completed set starts the rings.' });
  assert.deepEqual(Core.activityMessage(0.25), { title: 'Momentum started.', detail: 'Keep the next session simple.' });
  assert.deepEqual(Core.activityMessage(0.75), { title: 'Nearly closed.', detail: 'One strong session could do it.' });
  assert.deepEqual(Core.activityMessage(1), { title: 'Week completed.', detail: 'Goals hit. Anything else is bonus work.' });
});

test('setCompletionState supplies visible and accessible set status', () => {
  assert.deepEqual(Core.setCompletionState(false, 2), {
    className: '',
    status: 'Pending',
    actionLabel: 'Mark set 2 complete'
  });
  assert.deepEqual(Core.setCompletionState(true, 2), {
    className: 'completed',
    status: 'Completed',
    actionLabel: 'Mark set 2 incomplete'
  });
});

test('validateBackup accepts a complete v2 backup and normalizes its goals', () => {
  const backup = { version: 2, routines: [], history: [], customExercises: [], activeSession: null, preferences: { weeklyWorkoutGoal: '5' } };
  const validated = Core.validateBackup(backup);
  assert.notEqual(validated, backup);
  assert.equal(validated.preferences.weeklyWorkoutGoal, 5);
  assert.equal(validated.preferences.weeklySetGoal, 48);
});

test('validateBackup rejects malformed collections and active sessions', () => {
  assert.throws(() => Core.validateBackup({ version: 2, routines: [], history: {} }), /Invalid Duck Gym backup/);
  assert.throws(() => Core.validateBackup({ version: 2, routines: [], history: [], activeSession: 'bad' }), /Invalid Duck Gym backup/);
});

test('exerciseTrend returns per-session best e1RM oldest-first', () => {
  const history = [
    { started: 300, exercises: [{ exerciseId: 'bench', sets: [{ weight: 90, reps: 5, done: true }] }] },
    { started: 100, exercises: [{ exerciseId: 'bench', sets: [{ weight: 80, reps: 5, done: true }, { weight: 85, reps: 3, done: true }] }] },
    { started: 200, exercises: [{ exerciseId: 'squat', sets: [{ weight: 100, reps: 5, done: true }] }] },
    { started: 400, exercises: [{ exerciseId: 'bench', sets: [{ weight: 95, reps: 2, done: false }] }] }
  ];
  const trend = Core.exerciseTrend(history, 'bench');
  assert.deepEqual(trend.map(p => p.started), [100, 300]);
  assert.equal(trend[1].topWeight, 90);
  assert.equal(trend[1].e1rm, 105);
});

test('exerciseExposures counts sessions with completed sets; prFeed flattens newest-first', () => {
  const history = [
    { id: 'b', started: 200, prs: [{ exerciseId: 'bench', weight: 90, estimated1RM: 105 }],
      exercises: [{ exerciseId: 'bench', sets: [{ weight: 90, reps: 5, done: true }] }] },
    { id: 'a', started: 100, prs: [{ exerciseId: 'bench', weight: 80, estimated1RM: 93 }],
      exercises: [{ exerciseId: 'bench', sets: [{ weight: 80, reps: 5, done: true }] }] }
  ];
  assert.deepEqual(Core.exerciseExposures(history), { bench: 2 });
  assert.deepEqual(Core.prFeed(history, 5).map(p => p.started), [200, 100]);
});

test('lastConfirmedExposure requires post!=worse AND flare===false', () => {
  const mkSession = (started, checkin) => ({ started, checkin,
    exercises: [{ exerciseId: 'bench', sets: [{ weight: 80, reps: 5, done: true }] }] });
  const confirmed = mkSession(100, { post: 'same', flare: false });
  const flared = mkSession(200, { post: 'better', flare: true });
  const unresolved = mkSession(300, { post: 'same', flare: null });
  const worse = mkSession(400, { post: 'worse', flare: false });
  assert.equal(Core.lastConfirmedExposure([worse, unresolved, flared, confirmed], 'bench').started, 100);
  assert.equal(Core.lastConfirmedExposure([unresolved], 'bench'), null);
  assert.equal(Core.lastConfirmedExposure([mkSession(500, undefined)], 'bench'), null);
});

test('validateBackup carries exerciseCues through import', () => {
  const data = { version: 2, routines: [], history: [], customExercises: [], activeSession: null,
    exerciseCues: { ch1: { text: 'stance square', updated: 5 } }, preferences: {} };
  assert.deepEqual(Core.validateBackup(data).exerciseCues, { ch1: { text: 'stance square', updated: 5 } });
  assert.deepEqual(Core.validateBackup({ ...data, exerciseCues: undefined }).exerciseCues, {});
});

test('coachEligible gates the coach card on skin-in-the-game (Track B scoping)', () => {
  // Brand-new profile: no history, no routines, no sync → neutral empty state (card suppressed).
  assert.equal(Core.coachEligible({ history: [], routines: [] }, false), false);
  // Any of the three signals earns the card.
  assert.equal(Core.coachEligible({ history: [{ id: 's1' }], routines: [] }, false), true);
  assert.equal(Core.coachEligible({ history: [], routines: [{ id: 'r1' }] }, false), true);
  assert.equal(Core.coachEligible({ history: [], routines: [] }, true), true);
  // Defensive: missing fields never throw and read as ineligible.
  assert.equal(Core.coachEligible(undefined, false), false);
  assert.equal(Core.coachEligible({}, false), false);
});

test('per-profile backup round-trips a profile state without bleeding into another', () => {
  // A profile exports its own state; validateBackup normalises it back with favourites/history intact.
  const profileA = { version: 2, routines: [{ id: 'r1', name: 'Upper', exerciseIds: ['b0'] }],
    history: [{ id: 's1', started: 1, exercises: [] }], customExercises: [], activeSession: null,
    favourites: ['b0'], preferences: { restSeconds: 120 } };
  const restored = Core.validateBackup(profileA, ['b0']);
  assert.deepEqual(restored.favourites, ['b0']);
  assert.equal(restored.history.length, 1);
  assert.equal(restored.routines[0].name, 'Upper');
  assert.equal(restored.preferences.restSeconds, 120);
  // Deep copy — importing into one profile can't mutate the exported object shared with another.
  restored.history.push({ id: 's2' });
  assert.equal(profileA.history.length, 1);
});
