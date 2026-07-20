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

test('plateBreakdown: exact greedy per-side split, remainder flagged, sub-bar handled', () => {
  assert.deepEqual(Core.plateBreakdown(100, 20).perSide, [25, 15]);
  assert.equal(Core.plateBreakdown(100, 20).exact, true);
  assert.deepEqual(Core.plateBreakdown(82.5, 20).perSide, [25, 5, 1.25]);
  const odd = Core.plateBreakdown(101, 20);
  assert.equal(odd.exact, false);
  assert.equal(odd.remainder, 1);
  assert.deepEqual(Core.plateBreakdown(15, 20).perSide, []);
  assert.equal(Core.plateBreakdown(20, 20).exact, true);
});

test('muscleVolumeWeeks: trailing weeks oldest→newest, current week last', () => {
  const wed = new Date('2026-07-15T12:00:00').getTime(); // fixed mid-week so ±8d maps deterministically
  const thisWeek = { ...session, started: wed - 1000 };
  const lastWeek = { ...session, started: wed - 3 * 24 * 3600 * 1000 }; // Sunday before = previous week
  const weeks = Core.muscleVolumeWeeks([thisWeek, lastWeek], look, 3, wed);
  assert.equal(weeks.length, 3);
  assert.equal(weeks[2].Chest.direct, 2);          // current week
  assert.equal(weeks[1].Chest.direct, 2);          // previous week
  assert.equal(weeks[0].Chest, undefined);         // two weeks back: nothing
});

test('planVolume: default 3 sets per exercise, same two ledgers', () => {
  const pv = Core.planVolume([{ exerciseIds: ['bench', 'squat'] }], look);
  assert.equal(pv.Chest.direct, 3);
  assert.equal(pv.Shoulders.assisting, 3);
  assert.equal(pv.Legs.direct, 3);
  assert.equal(pv.Core.assisting, 3);
  assert.equal(pv.Shoulders.direct, 0);
});
