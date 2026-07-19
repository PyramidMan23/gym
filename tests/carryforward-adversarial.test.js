const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core.js');

const set = (weight = '', reps = '', done = false, extra = {}) => ({ weight, reps, done, ...extra });

test('set 1 never prefills, even when later sets completed out of order', () => {
  const exercise = { exerciseId: 'bench', sets: [set(), set('82.5', '6', false), set('90', '3', true)] };
  assert.equal(Core.carryForward(exercise, 0), null);
  assert.equal(Core.carryForward(exercise, 1), null, 'a later completed set must not flow backwards');
});

test('only the nearest preceding completed set seeds an out-of-order gap', () => {
  const exercise = { sets: [set('80', '8', true), set(), set('90', '3', true), set()] };
  assert.deepEqual(Core.carryForward(exercise, 1), { weight: '80', reps: '8' });
  assert.deepEqual(Core.carryForward(exercise, 3), { weight: '90', reps: '3' });
});

test('un-completing a source immediately makes it ineligible', () => {
  const exercise = { sets: [set('70', '10', true), set('', '', false, { prefilled: true })] };
  assert.deepEqual(Core.carryForward(exercise, 1), { weight: '70', reps: '10' });
  exercise.sets[0].done = false;
  assert.equal(Core.carryForward(exercise, 1), null);
});

test('deleting and adding sets recomputes the nearest source from current indices', () => {
  const exercise = { sets: [set('60', '10', true), set('65', '8', true), set()] };
  exercise.sets.splice(1, 1);
  assert.deepEqual(Core.carryForward(exercise, 1), { weight: '60', reps: '10' });
  exercise.sets.splice(1, 0, set('62.5', '9', true));
  exercise.sets.push(set());
  assert.deepEqual(Core.carryForward(exercise, 2), { weight: '62.5', reps: '9' });
  assert.deepEqual(Core.carryForward(exercise, 3), { weight: '62.5', reps: '9' });
});

test('edited decimal values carry exactly and source metadata does not leak', () => {
  const exercise = { sets: [set('80', '8', true, { prefilled: true }), set()] };
  exercise.sets[0].weight = '82.5';
  delete exercise.sets[0].prefilled;
  assert.deepEqual(Core.carryForward(exercise, 1), { weight: '82.5', reps: '8' });
  assert.equal('prefilled' in Core.carryForward(exercise, 1), false);
});

test('the app edit path clears the prefilled marker', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(source, /function updateSet\([^)]*\)\s*\{[^}]*delete set\.prefilled;/s);
});

test('zero is entered data, decimals are preserved, and untouched set 1 alone offers adoption', () => {
  const exercise = { sets: [set('0', '12', true), set()] };
  assert.deepEqual(Core.carryForward(exercise, 1), { weight: '0', reps: '12' });
  assert.equal(Core.showAdoptAction(set(0, '', false), 0, true), false);
  assert.equal(Core.showAdoptAction(set('', '', false), 0, true), true);
});

test('bodyweight reps carry with an intentionally empty weight', () => {
  const exercise = { sets: [set('', '12', true), set()] };
  assert.deepEqual(Core.carryForward(exercise, 1), { weight: '', reps: '12' });
});

test('an empty-fields done tick adopts nothing', () => {
  const exercise = { sets: [set('', '', true), set()] };
  assert.equal(Core.carryForward(exercise, 1), null);
});

test('carry-forward is isolated to the exercise object supplied', () => {
  const bench = { exerciseId: 'bench', sets: [set('100', '5', true), set()] };
  const row = { exerciseId: 'row', sets: [set(), set()] };
  assert.deepEqual(Core.carryForward(bench, 1), { weight: '100', reps: '5' });
  assert.equal(Core.carryForward(row, 1), null);
});

test('an exercise with every set complete has no destination to prefill', () => {
  const exercise = { sets: [set('80', '8', true), set('82.5', '6', true)] };
  assert.equal(Core.carryForward(exercise, exercise.sets.length), null);
});

test('stepValue clamps at zero and repeated 2.5 steps do not drift', () => {
  assert.equal(Core.stepValue(0, 2.5, -1), 0);
  assert.equal(Core.stepValue(1, 2.5, -1), 0);
  let value = 0;
  for (let i = 0; i < 17; i++) value = Core.stepValue(value, 2.5, 1);
  assert.equal(value, 42.5);
  for (let i = 0; i < 17; i++) value = Core.stepValue(value, 2.5, -1);
  assert.equal(value, 0);
});

test('shouldBuzz requires both enabled preference and an available API', () => {
  assert.equal(Core.shouldBuzz({ haptics: false }, true), false);
  assert.equal(Core.shouldBuzz({ haptics: true }, false), false);
  assert.equal(Core.shouldBuzz(undefined, false), false);
  assert.equal(Core.shouldBuzz(undefined, true), true);
});
