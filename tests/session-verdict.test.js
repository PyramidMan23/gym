// Gates for Core.sessionVerdict (council 2026-07-28): the receipt's verdict layer must be computed
// from evidence, honest on first exposure, and immune to drop sets and blank ticks.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const set = (weight, reps, done = true, drop = false) => ({ weight, reps, done, drop });
const sess = (started, exercises) => ({ started, exercises });
const ex = (id, sets) => ({ exerciseId: id, sets });

test('no history at all: baseline verdict with honest copy hook', () => {
  const today = sess(2000, [ex('bench', [set(60, 8)])]);
  const v = Core.sessionVerdict([], today);
  assert.equal(v.verdict, 'baseline');
  assert.equal(v.considered, 0);
  assert.equal(v.baseline, 1);
});

test('heavier top set advances, and becomes the highlight', () => {
  const h = [sess(1000, [ex('bench', [set(60, 8)])])];
  const today = sess(2000, [ex('bench', [set(62.5, 8)])]);
  const v = Core.sessionVerdict(h, today);
  assert.equal(v.verdict, 'advanced');
  assert.deepEqual(v.highlight, { exerciseId: 'bench', kind: 'load', delta: 2.5 });
});

test('same load, more reps advances on the reps axis', () => {
  const h = [sess(1000, [ex('bench', [set(60, 8)])])];
  const v = Core.sessionVerdict(h, sess(2000, [ex('bench', [set(60, 10)])]));
  assert.equal(v.verdict, 'advanced');
  assert.deepEqual(v.highlight, { exerciseId: 'bench', kind: 'reps', delta: 2 });
});

test('matching last time exactly is held, not advanced and not a failure', () => {
  const h = [sess(1000, [ex('bench', [set(60, 8)])])];
  const v = Core.sessionVerdict(h, sess(2000, [ex('bench', [set(60, 8)])]));
  assert.equal(v.verdict, 'held');
  assert.equal(v.advanced, 0);
});

test('a clearly lighter day reads backed-off', () => {
  const h = [sess(1000, [ex('bench', [set(60, 8)])]), sess(999, [ex('row', [set(50, 8)])])];
  const today = sess(2000, [ex('bench', [set(40, 6)]), ex('row', [set(35, 6)])]);
  assert.equal(Core.sessionVerdict(h, today).verdict, 'backed-off');
});

test('majority rule: 2 of 3 advanced carries the day', () => {
  const h = [sess(1000, [ex('a', [set(60, 8)]), ex('b', [set(40, 8)]), ex('c', [set(20, 8)])])];
  const today = sess(2000, [ex('a', [set(62.5, 8)]), ex('b', [set(40, 9)]), ex('c', [set(20, 8)])]);
  const v = Core.sessionVerdict(h, today);
  assert.equal(v.verdict, 'advanced');
  assert.equal(v.advanced, 2);
  assert.equal(v.considered, 3);
});

test('drop sets never judge the day', () => {
  const h = [sess(1000, [ex('bench', [set(60, 8)])])];
  // Top working set matches; the heavy-looking extra is a drop and must be ignored.
  const v = Core.sessionVerdict(h, sess(2000, [ex('bench', [set(60, 8), set(48, 12, true, true)])]));
  assert.equal(v.verdict, 'held');
});

test('timed exercises advance on seconds', () => {
  Core.setTimedExercises(['hang']);
  try {
    const h = [sess(1000, [ex('hang', [set(0, 40)])])];
    const v = Core.sessionVerdict(h, sess(2000, [ex('hang', [set(0, 50)])]));
    assert.equal(v.verdict, 'advanced');
    assert.deepEqual(v.highlight, { exerciseId: 'hang', kind: 'time', delta: 10 });
  } finally { Core.setTimedExercises([]); }
});

test('load beats reps beats time when picking the single highlight', () => {
  const h = [sess(1000, [ex('a', [set(60, 8)]), ex('b', [set(40, 8)])])];
  const today = sess(2000, [ex('a', [set(60, 12)]), ex('b', [set(42.5, 8)])]);
  assert.equal(Core.sessionVerdict(h, today).highlight.kind, 'load');
});

test('blank done-ticks and empty sessions produce none, never a crash', () => {
  assert.equal(Core.sessionVerdict([], sess(2000, [ex('bench', [set('', '')])])).verdict, 'none');
  assert.equal(Core.sessionVerdict([], sess(2000, [])).verdict, 'none');
  assert.equal(Core.sessionVerdict(null, null).verdict, 'none');
});

test('deload reason shows exact figures, never two identical rounded numbers', () => {
  const WEEK = 7 * 86400000;
  const now = new Date('2026-07-28T12:00:00').getTime();
  const wk = (back, kg) => sess(now - back * WEEK, [ex('dl', [set(kg, 1)])]);
  const got = Core.deloadCheck([wk(1, 6340), wk(2, 6260), wk(3, 2840)], now);
  assert.equal(got.due, true);
  assert.match(got.reason, /2,840/);
  assert.match(got.reason, /6,260/);
  assert.match(got.reason, /6,340/);
});
