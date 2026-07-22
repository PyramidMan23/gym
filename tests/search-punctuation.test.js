// The catalogue spells things "Pull-Up"; people type "pull up" and "pullup". Before 2026-07-22 a
// raw substring match meant the app's most common searches returned ZERO results — found when a
// friend of Mark's went looking for an exercise and concluded it wasn't in the app.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const ex = (id, name, extra = {}) => ({ id, name, muscle: 'Calisthenics', muscles: ['Calisthenics'],
  patterns: ['Isolation'], family: 'Test', equip: ['Bodyweight'], equipment: 'Bodyweight', ...extra });
const CAT = [
  ex('a', 'Pull-Up'),
  ex('b', 'Band-Assisted Pull-Up'),
  ex('c', 'Push-Up'),
  ex('d', 'Parallette L-Sit', { equipment: 'Parallettes / dip bars / floor — support hold' }),
  ex('e', 'Hanging Tuck L-Sit'),
  ex('f', 'Barbell Bench Press'),
  ex('g', 'Goblet Squat')
];
const names = q => Core.filterExercises(CAT, { query: q }).map(e => e.name);

test('a hyphenated name is found however the user spaces it', () => {
  for (const q of ['pull-up', 'pull up', 'pullup', 'PULL UP', '  pull   up  ']) {
    assert.ok(names(q).includes('Pull-Up'), `"${q}" failed to find Pull-Up`);
  }
});

test('the exact name outranks a longer variant, whatever the spacing', () => {
  for (const q of ['pull up', 'pullup', 'pull-up']) {
    assert.equal(names(q)[0], 'Pull-Up', `"${q}" ranked the wrong result first`);
  }
});

test('multi-word names survive losing their space', () => {
  assert.ok(names('benchpress').includes('Barbell Bench Press'));
  assert.ok(names('bench press').includes('Barbell Bench Press'));
});

test('L-Sit is reachable by every spelling a person would try', () => {
  for (const q of ['l-sit', 'l sit', 'lsit']) {
    const hits = names(q);
    assert.ok(hits.includes('Parallette L-Sit'), `"${q}" missed the parallette variant`);
    assert.ok(hits.includes('Hanging Tuck L-Sit'), `"${q}" missed the hanging variant`);
  }
});

test('kit named only in the human-readable equipment string is searchable', () => {
  assert.deepEqual(names('parallette'), ['Parallette L-Sit']);
  assert.deepEqual(names('parallettes'), ['Parallette L-Sit']);
});

test('search stays selective — it did not become a match-everything', () => {
  assert.deepEqual(names('goblet'), ['Goblet Squat']);
  assert.deepEqual(names('zzzz'), []);
  assert.equal(names('push up').includes('Goblet Squat'), false);
});

test('an empty query still returns the whole catalogue', () => {
  assert.equal(names('').length, CAT.length);
  assert.equal(names('   ').length, CAT.length);
});
