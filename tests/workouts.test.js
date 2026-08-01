// Curated workouts (council 2026-08-01): the variant maths and the scheme path through createSession.
// Volume variants are COMPUTED, never stored - so the only thing worth pinning is that the maths is
// right, that it never mutates the catalogue data, and that a scheme opens a session with blank loads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'exercises.js'), 'utf8');
const { DUCK_EXERCISES, GYM_WORKOUTS } =
  new Function(`${src}; return { DUCK_EXERCISES, GYM_WORKOUTS };`)();
const muscleOf = id => (DUCK_EXERCISES.find(e => e.id === id) || {}).muscle || '';
const MOBILITY = new Set(['Mobility', 'Stretches']);

// A hand-built workout keeps the maths readable: a 2-set opener (already the floor), a mobility
// drill that expansion must skip, and two 3+ movements.
const FIXTURE = {
  id: 'wk-test', goal: 'TEST', name: 'Test', mins: 30, blurb: 'b', note: 'n',
  exercises: [
    { id: 'mo1', sets: 3, reps: '10-12', rest: 30 },  // Mobility
    { id: 'ch1', sets: 4, reps: '3-5', rest: 180 },   // Chest
    { id: 'lg1', sets: 2, reps: '6-8', rest: 120 },   // Legs, already at the floor
    { id: 'ba3', sets: 3, reps: '6-10', rest: 120 }   // Back
  ]
};
const sets = list => list.map(e => e.sets);

test('base returns the written scheme, ids/reps/rest intact', () => {
  const out = Core.workoutScheme(FIXTURE, 'base', muscleOf);
  assert.deepEqual(sets(out), [3, 4, 2, 3]);
  assert.deepEqual(out.map(e => e.id), ['mo1', 'ch1', 'lg1', 'ba3']);
  assert.deepEqual(out.map(e => e.reps), ['10-12', '3-5', '6-8', '6-10']);
  assert.deepEqual(out.map(e => e.rest), [30, 180, 120, 120]);
});

test('reduced drops one set only where the scheme carries 3 or more', () => {
  assert.deepEqual(sets(Core.workoutScheme(FIXTURE, 'reduced', muscleOf)), [2, 3, 2, 2]);
});

test('expanded adds one set to the first TWO non-mobility movements only', () => {
  // mo1 is skipped (Mobility), so ch1 and ba3 take the sets; lg1 sits between them untouched.
  assert.deepEqual(sets(Core.workoutScheme(FIXTURE, 'expanded', muscleOf)), [3, 5, 3, 3]);
});

test('every variant leaves the source workout untouched', () => {
  const snapshot = JSON.stringify(FIXTURE);
  for (const variant of ['reduced', 'base', 'expanded']) Core.workoutScheme(FIXTURE, variant, muscleOf);
  assert.equal(JSON.stringify(FIXTURE), snapshot);
});

test('reduced never drops a real workout below one set, expanded never pads mobility', () => {
  for (const w of GYM_WORKOUTS) {
    for (const e of Core.workoutScheme(w, 'reduced', muscleOf)) assert.ok(e.sets >= 1, `${w.id}/${e.id} fell to ${e.sets}`);
    const base = Core.workoutScheme(w, 'base', muscleOf);
    const up = Core.workoutScheme(w, 'expanded', muscleOf);
    const grew = up.filter((e, i) => e.sets > base[i].sets);
    assert.ok(grew.length <= 2, `${w.id} expanded ${grew.length} movements`);
    for (const e of grew) assert.ok(!MOBILITY.has(muscleOf(e.id)), `${w.id} expanded mobility work ${e.id}`);
  }
});

test('createSession builds blank set rows from a scheme and stamps the plan', () => {
  const scheme = Core.workoutScheme(FIXTURE, 'base', muscleOf);
  const session = Core.createSession({ id: FIXTURE.id, name: FIXTURE.name, exercises: scheme }, 1000);
  assert.equal(session.routineId, 'wk-test', 'the workout id must land in routineId so the weekly count still works');
  assert.equal(session.name, 'Test');
  assert.deepEqual(session.exercises.map(e => e.sets.length), [3, 4, 2, 3]);
  assert.deepEqual(session.exercises.map(e => e.exerciseId), ['mo1', 'ch1', 'lg1', 'ba3']);
  assert.deepEqual(session.exercises.map(e => e.targetReps), ['10-12', '3-5', '6-8', '6-10']);
  assert.deepEqual(session.exercises.map(e => e.restSeconds), [30, 180, 120, 120]);
  // Loads are NEVER invented - every row opens blank and fills from the lifter's own history.
  for (const exercise of session.exercises)
    for (const set of exercise.sets) assert.deepEqual(set, { weight: '', reps: '', done: false });
  // Distinct objects, not a shared row.
  session.exercises[1].sets[0].weight = '80';
  assert.equal(session.exercises[1].sets[1].weight, '');
});

test('the exerciseIds path is unchanged: one blank set, no plan stamps', () => {
  const session = Core.createSession({ id: 'r1', name: 'Routine', exerciseIds: ['ch1', 'ba3'] }, 2000);
  assert.deepEqual(session.exercises, [
    { exerciseId: 'ch1', notes: '', sets: [{ weight: '', reps: '', done: false }] },
    { exerciseId: 'ba3', notes: '', sets: [{ weight: '', reps: '', done: false }] }
  ]);
  assert.equal(session.routineId, 'r1');
  const quick = Core.createSession({ id: null, name: 'Quick workout', exerciseIds: [] }, 3000);
  assert.deepEqual(quick.exercises, []);
  assert.equal(quick.routineId, null);
});
