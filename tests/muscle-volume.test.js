const test = require('node:test');
const assert = require('node:assert');
const Core = require('../core.js');

const CAT = {
  bench: { primary: 'Chest', all: ['Chest', 'Shoulders', 'Arms'] },
  squat: { primary: 'Legs', all: ['Legs', 'Core'] }
};
const look = id => CAT[id] || null;
const now = Date.now();
const session = { started: now - 1000, exercises: [
  { exerciseId: 'bench', sets: [{ done: true }, { done: true }, { done: false }] },
  { exerciseId: 'squat', sets: [{ done: true }] },
  { exerciseId: 'unknown', sets: [{ done: true }] }
] };

test('two-ledger counts: primary direct, secondaries assisting, incomplete + unknown excluded', () => {
  const mv = Core.muscleVolume([session], look, now);
  assert.equal(mv.Chest.direct, 2);
  assert.equal(mv.Chest.assisting, 0);
  assert.equal(mv.Shoulders.direct, 0);
  assert.equal(mv.Shoulders.assisting, 2);
  assert.equal(mv.Arms.assisting, 2);
  assert.equal(mv.Legs.direct, 1);
  assert.equal(mv.Core.assisting, 1);
  assert.equal(mv.Chest.by.bench.direct, 2);
  assert.ok(!('unknown' in (mv.Chest.by)));
});

test('sessions outside the local week are ignored', () => {
  const old = { ...session, started: now - 9 * 24 * 3600 * 1000 };
  assert.deepEqual(Core.muscleVolume([old], look, now), {});
});

test('planVolume: default 3 sets per exercise, same two ledgers', () => {
  const pv = Core.planVolume([{ exerciseIds: ['bench', 'squat'] }], look);
  assert.equal(pv.Chest.direct, 3);
  assert.equal(pv.Shoulders.assisting, 3);
  assert.equal(pv.Legs.direct, 3);
  assert.equal(pv.Core.assisting, 3);
  assert.equal(pv.Shoulders.direct, 0);
});
