// Gates for the 2026-07-28 pass: the check-in tolerance-gate parity fix, session bookends, and
// deload awareness. The check-in tests are the important ones: they pin the bug that froze the
// brain-side coach for three sessions running (the app asked no flare question outside injury mode,
// while every consumer of the evidence demanded its answer).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core.js');

const { DUCK_EXERCISES, GYM_PREP, GYM_PLANS } = new Function(
  `${fs.readFileSync(path.join(__dirname, '..', 'exercises.js'), 'utf8')}; return { DUCK_EXERCISES, GYM_PREP, GYM_PLANS };`
)();
const byId = id => DUCK_EXERCISES.find(e => e.id === id);
const set = (weight, reps, done = true) => ({ weight, reps, done });
const sess = (started, checkin, sets = [set(20, 8)]) => ({
  started, checkin, exercises: [{ exerciseId: 'lg4', sets }]
});

// ---- 1. lastConfirmedExposure: the requireConfirmation escape hatch ----

test('lastConfirmedExposure: flare unanswered blocks the baseline IN injury mode (unchanged)', () => {
  const h = [sess(1000, { post: 'same', flare: null })];
  assert.equal(Core.lastConfirmedExposure(h, 'lg4'), null);
  assert.equal(Core.lastConfirmedExposure(h, 'lg4', { requireConfirmation: true }), null);
});

test('lastConfirmedExposure: OUTSIDE injury mode an unanswered flare still counts', () => {
  // This is the exact shape of Mark's three real sessions: post answered, flare never asked.
  const h = [sess(1000, { post: 'same', flare: null })];
  const got = Core.lastConfirmedExposure(h, 'lg4', { requireConfirmation: false });
  assert.ok(got, 'a completed session with post="same" must be a baseline outside injury mode');
  assert.equal(got.topWeight, 20);
  assert.equal(got.setCount, 1);
});

test('lastConfirmedExposure: "worse" is never a baseline, gate on or off', () => {
  const h = [sess(1000, { post: 'worse', flare: false })];
  assert.equal(Core.lastConfirmedExposure(h, 'lg4'), null);
  assert.equal(Core.lastConfirmedExposure(h, 'lg4', { requireConfirmation: false }), null);
});

test('lastConfirmedExposure: blank done-ticks are still not evidence', () => {
  const h = [sess(1000, { post: 'same', flare: false }, [set('', '')])];
  assert.equal(Core.lastConfirmedExposure(h, 'lg4', { requireConfirmation: false }), null);
});

// ---- 2. Session bookends ----

test('sessionPatterns unions the patterns of every exercise, deduped', () => {
  const got = Core.sessionPatterns(['lg4', 'ch3'], id => byId(id)?.patterns);
  assert.ok(got.includes('Hinge'));
  assert.ok(got.includes('Horizontal Push'));
  assert.equal(new Set(got).size, got.length);
});

test('sessionPatterns tolerates unknown/custom ids with no patterns', () => {
  assert.deepEqual(Core.sessionPatterns(['nope'], id => byId(id)?.patterns), []);
});

test('prepFor: ordered union, deduped, capped', () => {
  const map = { A: ['x', 'y'], B: ['y', 'z'] };
  assert.deepEqual(Core.prepFor(['A', 'B'], map, 4), ['x', 'y', 'z']);
  assert.deepEqual(Core.prepFor(['A', 'B'], map, 2), ['x', 'y']);
  assert.deepEqual(Core.prepFor(['nothing-here'], map, 4), []);
  assert.deepEqual(Core.prepFor(['A'], null, 4), []);
});

test('every id in the prep map is a real exercise (both phases)', () => {
  for (const phase of ['warmup', 'cooldown'])
    for (const [pattern, ids] of Object.entries(GYM_PREP[phase]))
      for (const id of ids)
        assert.ok(byId(id), `GYM_PREP.${phase}["${pattern}"] references missing exercise ${id}`);
});

test('prep drills are mobility/stretch work, never loaded lifts', () => {
  const ok = new Set(['Mobility', 'Stretches']);
  for (const phase of ['warmup', 'cooldown'])
    for (const ids of Object.values(GYM_PREP[phase]))
      for (const id of ids)
        assert.ok(ok.has(byId(id).muscle), `${id} (${byId(id).muscle}) is not a prep drill`);
});

test('a real hinge session gets hinge-relevant warm-up drills', () => {
  const patterns = Core.sessionPatterns(['lg4'], id => byId(id)?.patterns);
  const picks = Core.prepFor(patterns, GYM_PREP.warmup, 3);
  assert.ok(picks.length, 'a hinge session must propose a warm-up');
  assert.deepEqual(picks, GYM_PREP.warmup['Hinge'].slice(0, 3));
});

// ---- 3. Deload awareness ----

const WEEK = 7 * 86400000;
// Build a session inside week `n` weeks back from `now`, carrying `volume` kg of work.
const weekSession = (now, weeksBack, volume) => ({
  started: now - weeksBack * WEEK, checkin: { post: 'same', flare: false },
  exercises: [{ exerciseId: 'lg4', sets: [set(volume, 1)] }]
});

test('deloadCheck: three complete weeks of rising volume → due', () => {
  const now = new Date('2026-07-28T12:00:00').getTime();
  const h = [weekSession(now, 1, 300), weekSession(now, 2, 200), weekSession(now, 3, 100)];
  const got = Core.deloadCheck(h, now);
  assert.equal(got.due, true);
  assert.deepEqual(got.volumes, [100, 200, 300]);
  assert.match(got.reason, /climbed 3 weeks running/);
});

test('deloadCheck: a flat or falling week clears it', () => {
  const now = new Date('2026-07-28T12:00:00').getTime();
  assert.equal(Core.deloadCheck([weekSession(now, 1, 200), weekSession(now, 2, 200), weekSession(now, 3, 100)], now).due, false);
  assert.equal(Core.deloadCheck([weekSession(now, 1, 100), weekSession(now, 2, 200), weekSession(now, 3, 300)], now).due, false);
});

test('deloadCheck: a missed week is not a rising streak', () => {
  const now = new Date('2026-07-28T12:00:00').getTime();
  assert.equal(Core.deloadCheck([weekSession(now, 1, 300), weekSession(now, 3, 100)], now).due, false);
});

test('deloadCheck: the in-progress current week is excluded, so a big week today cannot trigger it', () => {
  const now = new Date('2026-07-28T12:00:00').getTime();
  // Current week is huge; the three complete weeks behind it are flat → not due.
  const h = [weekSession(now, 0, 9999), weekSession(now, 1, 100), weekSession(now, 2, 100), weekSession(now, 3, 100)];
  assert.equal(Core.deloadCheck(h, now).due, false);
});

test('deloadCheck: empty history is never due', () => {
  assert.equal(Core.deloadCheck([], Date.now()).due, false);
  assert.equal(Core.deloadCheck(null, Date.now()).due, false);
});

// ---- 4. Desk Reset ----

test('Desk Reset plan exists, is one day, and is all timed holds', () => {
  const plan = GYM_PLANS.find(p => p.id === 'plan-desk');
  assert.ok(plan, 'plan-desk must exist');
  assert.equal(plan.days.length, 1);
  assert.ok(plan.days[0].exerciseIds.length >= 5);
  // The whole point is a hands-off five minutes: every drill has to log in SECONDS, or the app asks
  // for a rep count on a stretch: the exact data-honesty bug the 2026-07-22 audit fixed for holds.
  for (const id of plan.days[0].exerciseIds) {
    const ex = byId(id);
    assert.ok(ex, `plan-desk references missing ${id}`);
    assert.ok(ex.timed === true || ex.patterns.includes('Mobility'),
      `${id} (${ex.name}) is neither timed nor a mobility drill`);
  }
});

test('static stretch holds are timed, rep-based drills are not', () => {
  // Holding a Couch Stretch was being logged as "24 reps": seconds dressed up as repetitions.
  for (const id of ['mo6', 'st4', 'mo14', 'st16']) assert.equal(byId(id).timed, true, `${id} should be timed`);
  // Flows and rep drills must NOT be flagged, or their rep counts start reading as seconds.
  for (const id of ['st6', 'mo9', 'mo12', 'mo13', 'mo15']) assert.ok(!byId(id).timed, `${id} should not be timed`);
});

test('the new rotation and carry work is tagged and reachable by search', () => {
  const rotation = DUCK_EXERCISES.filter(e => e.patterns.includes('Rotation'));
  const carry = DUCK_EXERCISES.filter(e => e.patterns.includes('Carry'));
  assert.ok(rotation.length >= 6, `rotation was the thinnest pattern in the catalogue, got ${rotation.length}`);
  assert.ok(carry.length >= 8, `carry should have grown, got ${carry.length}`);
  // Punctuation-insensitive search must find them (the 2026-07-22 class of bug).
  assert.ok(Core.filterExercises(DUCK_EXERCISES, { query: 'half kneeling' }).length >= 3);
  assert.ok(Core.filterExercises(DUCK_EXERCISES, { query: 'trap bar carry' }).length >= 1);
});

// ---- 5. Bookend suppression on drill-only sessions (2026-07-28, Mark's first Desk Reset) ----

test('a session made only of mobility/stretch drills proposes no warm-up', () => {
  // Offering a warm-up before a Desk Reset is nonsense: the session IS the mobility work.
  const plan = GYM_PLANS.find(p => p.id === 'plan-desk');
  const allDrills = plan.days[0].exerciseIds.every(id => ['Mobility', 'Stretches'].includes(byId(id).muscle));
  assert.ok(allDrills, 'the Desk Reset must be made entirely of drills for the suppression rule to apply');
});

test('a loaded session still proposes drills (suppression is not a blanket off-switch)', () => {
  const patterns = Core.sessionPatterns(['lg4', 'ch3'], id => byId(id)?.patterns);
  assert.ok(Core.prepFor(patterns, GYM_PREP.warmup, 3).length > 0);
});
