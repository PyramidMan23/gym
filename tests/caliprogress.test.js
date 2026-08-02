// Core.caliProgress - the calisthenics ledger behind Progress > Trends (v2).
// Bodyweight strength does not progress in kilos, so it gets its own read. These tests pin the two
// things that matter most: it reports only what was LOGGED (never a manufactured number), and its
// "next unlock" restates the double-progression rule the app already runs rather than inventing one.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const DAY = 86400000;
const NOW = 1780000000000; // fixed clock: caliProgress splits on a block window, so "now" must not drift
const set = (weight, reps, done = true) => ({ weight: String(weight), reps: String(reps), done });
const sess = (daysAgo, exercises) => ({ id: 's' + daysAgo, started: NOW - daysAgo * DAY, exercises });
const ex = (exerciseId, sets) => ({ exerciseId, sets });
const IDS = ['ba3', 'ch19', 'ch17', 'gr3', 'cs35'];
const opts = { now: NOW, blockDays: 28 };

// gr3 (Dead Hang) and cs35 (Parallette L-Sit) are the timed ones in the real catalogue.
test.before(() => Core.setTimedExercises(['gr3', 'cs35']));

test('rep movements report the best single-set rep count, and the vest that set carried', () => {
  const h = [sess(2, [ex('ba3', [set(0, 8), set(8, 6), set(0, 11)])])];
  const r = Core.caliProgress(h, IDS, opts);
  const pull = r.reps.find(e => e.exerciseId === 'ba3');
  assert.equal(pull.value, 11, 'the best SET is the score, not the last set and not a total');
  assert.equal(pull.load, 0, 'the vest is the load logged on that best set');
});

test('ties on reps break to the heavier vest, so added load is never hidden', () => {
  const h = [sess(2, [ex('ch19', [set(0, 10), set(8, 10)])])];
  const r = Core.caliProgress(h, IDS, opts);
  assert.equal(r.reps.find(e => e.exerciseId === 'ch19').load, 8);
});

test('previous best comes from BEFORE the block, and the delta is the gain', () => {
  const h = [sess(2, [ex('ba3', [set(0, 11)])]), sess(40, [ex('ba3', [set(0, 8)])])];
  const pull = Core.caliProgress(h, IDS, opts).reps.find(e => e.exerciseId === 'ba3');
  assert.equal(pull.value, 11);
  assert.equal(pull.previousValue, 8);
  assert.equal(pull.delta, 3);
});

test('a first-ever exposure has no previous best and claims no gain', () => {
  const pull = Core.caliProgress([sess(2, [ex('ba3', [set(0, 6)])])], IDS, opts).reps.find(e => e.exerciseId === 'ba3');
  assert.equal(pull.previousValue, null);
  assert.equal(pull.delta, 0, 'a first exposure must never read as progress');
});

test('timed exercises land in holds, in seconds, with a next tier', () => {
  const r = Core.caliProgress([sess(3, [ex('gr3', [set(0, 45)])])], IDS, { ...opts, secondsStep: 5 });
  assert.equal(r.reps.length, 0, 'a hold is not a rep movement');
  assert.equal(r.holds[0].exerciseId, 'gr3');
  assert.equal(r.holds[0].value, 45, 'seconds live in the reps field, as the logger already stores them');
  assert.equal(r.holds[0].nextTier, 50);
});

test('nothing logged means nothing reported - no invented rows', () => {
  const r = Core.caliProgress([], IDS, opts);
  assert.deepEqual(r.reps, []);
  assert.deepEqual(r.holds, []);
  assert.equal(r.gained, 0);
  assert.equal(r.nextUnlock, null);
  // An exercise present but with only unfinished sets is still nothing.
  const blank = Core.caliProgress([sess(2, [ex('ba3', [set(0, 10, false)])])], IDS, opts);
  assert.deepEqual(blank.reps, [], 'an unticked set is not evidence');
});

test('a set with no weight AND no reps is not evidence even when ticked', () => {
  const h = [sess(2, [ex('ba3', [{ weight: '', reps: '', done: true }])])];
  assert.deepEqual(Core.caliProgress(h, IDS, opts).reps, []);
});

test('ids not asked for are ignored, so the ledger stays bodyweight-only', () => {
  const h = [sess(2, [ex('lg1', [set(100, 5)]), ex('ba3', [set(0, 9)])])];
  const r = Core.caliProgress(h, IDS, opts);
  assert.equal(r.reps.length, 1);
  assert.equal(r.reps[0].exerciseId, 'ba3');
});

test('next unlock below the rep target counts the reps still to go', () => {
  const r = Core.caliProgress([sess(2, [ex('ba3', [set(8, 9)])])], IDS, { ...opts, repTarget: 12, step: 4 });
  assert.equal(r.nextUnlock.kind, 'reps');
  assert.equal(r.nextUnlock.exerciseId, 'ba3');
  assert.equal(r.nextUnlock.repsToGo, 3, '3 more reps then the vest moves - the same double progression nextTarget runs');
  assert.equal(r.nextUnlock.fromLoad, 8);
  assert.equal(r.nextUnlock.toLoad, 12);
});

test('at the top of the rep range the unlock becomes the load step itself', () => {
  const r = Core.caliProgress([sess(2, [ex('ba3', [set(8, 12)])])], IDS, { ...opts, repTarget: 12, step: 4 });
  assert.equal(r.nextUnlock.kind, 'load');
  assert.equal(r.nextUnlock.repsToGo, 0);
  assert.equal(r.nextUnlock.toLoad, 12);
});

test('gained sums only real improvements, never regressions', () => {
  const h = [
    sess(2, [ex('ba3', [set(0, 11)]), ex('ch19', [set(0, 5)])]),
    sess(40, [ex('ba3', [set(0, 8)]), ex('ch19', [set(0, 9)])]),
  ];
  const r = Core.caliProgress(h, IDS, opts);
  assert.equal(r.reps.find(e => e.exerciseId === 'ch19').delta, -4, 'a drop is reported honestly');
  assert.equal(r.gained, 3, 'but the headline gain never nets a regression into a bigger number');
});

test('reps and seconds are reported separately - different units are never summed', () => {
  const h = [
    sess(2, [ex('ba3', [set(0, 11)]), ex('gr3', [set(0, 52)])]),
    sess(40, [ex('ba3', [set(0, 8)]), ex('gr3', [set(0, 41)])]),
  ];
  const r = Core.caliProgress(h, IDS, opts);
  assert.equal(r.gainedReps, 3);
  assert.equal(r.gainedSeconds, 11);
  assert.equal(r.gained, 3, 'the headline figure is REPS - "+14" from 3 reps and 11 seconds means nothing');
});

test('a standing best with no work this block still shows, flagged as not logged this block', () => {
  const r = Core.caliProgress([sess(60, [ex('ba3', [set(0, 10)])])], IDS, opts);
  const pull = r.reps.find(e => e.exerciseId === 'ba3');
  assert.equal(pull.value, 10);
  assert.equal(pull.loggedThisBlock, false);
  assert.equal(pull.delta, 0, 'an untouched standing best is not this block\'s progress');
});

test('caliProgress is pure: it never mutates the history it reads', () => {
  const h = [sess(2, [ex('ba3', [set(0, 9), set(0, 7)])])];
  const copy = JSON.parse(JSON.stringify(h));
  Core.caliProgress(h, IDS, opts);
  assert.deepEqual(h, copy);
});
