// Bodyweight load model (2026-08-05).
// Mark: "can we count calisthenic exercises and exercises with no weight, can we count bodyweight
// there? lets really make sure were doing this as good as we can and it makes 100% sense."
//
// The model: a calisthenics set IS loaded work, so it counts - but only where there is a published
// or geometrically obvious share of body mass. Lever work (hanging leg raise, nordic curl) has no
// honest multiplier and stays off the kilogram axis rather than being handed a made-up one.
// These gates pin BOTH halves: what counts, and what deliberately does not.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core.js');

// exercises.js is a browser script, so it is loaded by evaluating it with an exports tail appended.
const catPath = path.join(__dirname, '..', 'exercises.js');
const shimPath = path.join(__dirname, '.catalogue.cjs');
fs.writeFileSync(shimPath, fs.readFileSync(catPath, 'utf8') + '\nmodule.exports={DUCK_EXERCISES,GYM_BW_FACTORS,gymBodyweightFactor};\n');
const { DUCK_EXERCISES, GYM_BW_FACTORS, gymBodyweightFactor } = require(shimPath);
test.after(() => { try { fs.unlinkSync(shimPath); } catch {} });

const byId = id => DUCK_EXERCISES.find(e => e.id === id);
const S = (weight, reps) => ({ weight: String(weight), reps: String(reps), done: true });

function installModel(bodyweightKg) {
  Core.setTimedExercises(DUCK_EXERCISES.filter(e => e.timed).map(e => e.id));
  Core.setBodyweightModel({
    factorFor: id => gymBodyweightFactor(byId(id)),
    bodyweightFor: () => bodyweightKg
  });
}
test.afterEach(() => { Core.setTimedExercises([]); Core.setBodyweightModel({}); });

// ---- The table itself ---------------------------------------------------------------------------
// THE gate that matters most. The first draft of the factor table guessed four ids and landed a
// 0.45 factor on a Rope Triceps Pushdown and 0.75 on a Seated Barbell Overhead Press. Pinning each
// id to the NAME it is meant to describe makes that class of mistake impossible to ship.
test('every id override names the exercise it is meant to describe', () => {
  const EXPECTED = {
    cs7: 'Knee Push-Up',
    cs6: 'Incline Push-Up',
    cs26: 'Decline Push-Up',
    cs9: 'Pike Push-Up',
    cs27: 'Pseudo-Planche Push-Up',
    ar21: 'Bench Dip',
    ch17: 'Deficit Push-Up'
  };
  assert.deepStrictEqual(Object.keys(GYM_BW_FACTORS.byId).sort(), Object.keys(EXPECTED).sort(),
    'the override list changed - re-verify each id against the catalogue before updating this gate');
  for (const [id, name] of Object.entries(EXPECTED))
    assert.strictEqual(byId(id)?.name, name, `${id} must be ${name}`);
});

test('no factor is outside the physically possible range', () => {
  for (const e of DUCK_EXERCISES) {
    const f = gymBodyweightFactor(e);
    if (f == null) continue;
    assert.ok(f > 0.3 && f <= 1.0, `${e.name} factor ${f} is not a plausible share of body mass`);
  }
});

test('external-load movements never get a bodyweight factor', () => {
  // Otherwise body mass would be added on top of the weight the lifter already typed.
  const EXTERNAL = ['Barbell', 'EZ Bar', 'Trap Bar', 'Dumbbell', 'Kettlebell', 'Cable', 'Smith', 'Machine', 'Band', 'Tib Bar', 'Wrist Axe', 'Plate', 'Rope'];
  const leaked = DUCK_EXERCISES.filter(e => gymBodyweightFactor(e) != null
    && (e.equip || []).some(k => EXTERNAL.includes(k))
    && !Object.prototype.hasOwnProperty.call(GYM_BW_FACTORS.byId, e.id));
  assert.deepStrictEqual(leaked.map(e => e.name), [],
    'these carry external kit and must not also be loaded by body mass');
});

test('a timed hold never carries a bodyweight load - it is on the seconds axis', () => {
  installModel(80);
  for (const e of DUCK_EXERCISES.filter(x => x.timed))
    assert.strictEqual(Core.bodyweightFactor(e.id), null, `${e.name} is timed and must stay off the kg axis`);
});

test('lever work is deliberately NOT given a fabricated load', () => {
  // The honest boundary of the model. If someone later invents a multiplier for these, this fails.
  for (const id of ['co1', 'lg13', 'co10', 'co11'])
    if (byId(id)) assert.strictEqual(gymBodyweightFactor(byId(id)), null,
      `${byId(id).name} has no defensible body-mass share and must stay on the reps axis`);
});

// ---- Volume -------------------------------------------------------------------------------------
test('a push-up session counts real kilograms instead of zero', () => {
  installModel(80);
  const session = { id: 's1', exercises: [{ exerciseId: 'ch8', sets: [S('', 20), S('', 15), S('', 15)] }] };
  // 80 kg x 0.70 = 56 kg per rep, 50 reps.
  assert.strictEqual(Core.calculateVolume(session), 56 * 50);
});

test('a pull-up counts full bodyweight, and a dip belt adds on top', () => {
  installModel(80);
  const plain = { exercises: [{ exerciseId: 'ba3', sets: [S('', 8)] }] };
  const belted = { exercises: [{ exerciseId: 'ba3', sets: [S(10, 8)] }] };
  assert.strictEqual(Core.calculateVolume(plain), 80 * 8);
  assert.strictEqual(Core.calculateVolume(belted), 90 * 8, 'added weight is summed, never substituted');
});

test('with no bodyweight logged nothing is invented - the load stays zero', () => {
  installModel(null);
  const session = { exercises: [{ exerciseId: 'ch8', sets: [S('', 20)] }] };
  assert.strictEqual(Core.calculateVolume(session), 0);
  const work = Core.sessionWork(session);
  assert.strictEqual(work.needsBodyweight, true, 'the app must ask for a bodyweight rather than guess one');
  assert.strictEqual(work.repsUncounted, 20, 'the reps are still reported as real work');
});

test('an external lift is completely unaffected by the model', () => {
  installModel(80);
  const session = { exercises: [{ exerciseId: 'lg3', sets: [S(50, 10), S(50, 8)] }] };
  assert.strictEqual(Core.calculateVolume(session), 50 * 18);
});

// ---- The three axes -----------------------------------------------------------------------------
test('sessionWork separates external kg, bodyweight kg, seconds and unmeasurable reps', () => {
  installModel(80);
  const session = { exercises: [
    { exerciseId: 'lg3', sets: [S(50, 10)] },        // external: 500
    { exerciseId: 'ba3', sets: [S('', 8)] },         // pull-up: 80 x 1.0 x 8 = 640
    { exerciseId: 'co1', sets: [S('', 10), S('', 10)] }, // hanging leg raise: no honest load
    { exerciseId: 'cs35', sets: [S('', 20)] }        // parallette L-sit: timed, 20 seconds
  ] };
  const work = Core.sessionWork(session);
  assert.strictEqual(work.externalKg, 500);
  assert.strictEqual(work.bodyweightKg, 640);
  assert.strictEqual(work.kg, 1140);
  assert.strictEqual(work.seconds, 20);
  assert.strictEqual(work.setsUncounted, 2);
  assert.strictEqual(work.repsUncounted, 20);
  assert.strictEqual(work.needsBodyweight, false);
});

test('the axes are never summed into one number', () => {
  installModel(80);
  const work = Core.sessionWork({ exercises: [{ exerciseId: 'cs35', sets: [S('', 60)] }] });
  assert.strictEqual(work.kg, 0, 'a 60-second hold is not 60 kilograms of anything');
  assert.strictEqual(work.seconds, 60);
});

// ---- Interaction with the load-gap check --------------------------------------------------------
test('a bodyweight movement is never nagged for a missing load', () => {
  installModel(80);
  // A pull-up logged with no weight is CORRECT - the blank field means "no belt".
  const history = [{ id: 'old', started: 1, exercises: [{ exerciseId: 'ba3', sets: [S(10, 6)] }] }];
  const session = { id: 'new', exercises: [{ exerciseId: 'ba3', sets: [S('', 8)] }] };
  assert.deepStrictEqual(Core.loadGaps(history, session), [],
    'a blank weight on a pull-up is not a forgotten number');
});

test('a machine lift IS still nagged - that was the original bug', () => {
  installModel(80);
  const history = [{ id: 'old', started: 1, exercises: [{ exerciseId: 'lg23', sets: [S(60, 10)] }] }];
  const session = { id: 'new', exercises: [{ exerciseId: 'lg23', sets: [S('', 10)] }] };
  assert.deepStrictEqual(Core.loadGaps(history, session), [{ exerciseId: 'lg23', lastWeight: 60 }]);
});

test('bodyweight movements count as covered once a bodyweight is known', () => {
  installModel(80);
  const session = { exercises: [{ exerciseId: 'ba3', sets: [S('', 8)] }, { exerciseId: 'lg3', sets: [S(50, 5)] }] };
  assert.deepStrictEqual(Core.volumeCoverage(session), { loaded: 2, total: 2, complete: true });
  installModel(null);
  assert.strictEqual(Core.volumeCoverage(session).loaded, 1, 'without a bodyweight the pull-up is not covered');
});

test('openingLoads never pre-fills a belt onto a bodyweight movement', () => {
  installModel(80);
  const history = [{ id: 'a', started: 9, exercises: [{ exerciseId: 'ba3', sets: [S(10, 6)] }] }];
  assert.deepStrictEqual(Core.openingLoads(history, ['ba3']), {},
    'seeding 10 kg would claim a dip belt the lifter has not put on');
});

// ---- Which bodyweight ---------------------------------------------------------------------------
test('a session is valued at the latest weigh-in AT OR BEFORE it', () => {
  const log = [{ t: 1000, kg: 70 }, { t: 9000, kg: 90 }];
  assert.strictEqual(Core.bodyweightAsOf(log, 1200), 70);
  assert.strictEqual(Core.bodyweightAsOf(log, 9500), 90);
  assert.strictEqual(Core.bodyweightAsOf([], 5000), null);
  assert.strictEqual(Core.bodyweightAsOf([{ t: 1, kg: 0 }], 1), null, 'a zero weigh-in is not a bodyweight');
});

// THE council finding (2026-08-05). The first version took the nearest weigh-in in EITHER
// direction, so logging a weigh-in today silently changed what a session last month was worth -
// the exact instability the function was written to prevent. Verified by running it, then fixed.
test('a FUTURE weigh-in can never change what a past session was worth', () => {
  const day = 86400000;
  const before = [{ t: 0, kg: 70 }];
  const after = [{ t: 0, kg: 70 }, { t: 12 * day, kg: 95 }];
  assert.strictEqual(Core.bodyweightAsOf(before, 10 * day), 70);
  assert.strictEqual(Core.bodyweightAsOf(after, 10 * day), 70,
    'adding a later weigh-in must not move an earlier session');
});

test('a session older than every weigh-in has NO body mass until one is confirmed', () => {
  const log = [{ t: 9000, kg: 80 }];
  assert.strictEqual(Core.bodyweightAsOf(log, 1000), null, 'borrowing a future weight is fabrication');
  assert.strictEqual(Core.bodyweightAsOf(log, 1000, 78), 78, 'an explicitly confirmed backfill is allowed');
});

test('a pinned session bodyweight is what the app must use, whatever is logged later', () => {
  // finishWorkout stamps session.bodyweightKg; the app resolves that FIRST. Modelled here the same
  // way the app registers it, so the contract is gated rather than merely intended.
  Core.setTimedExercises([]);
  Core.setBodyweightModel({
    factorFor: id => gymBodyweightFactor(byId(id)),
    bodyweightFor: session => (Number(session?.bodyweightKg) > 0 ? Number(session.bodyweightKg)
      : Core.bodyweightAsOf([{ t: 0, kg: 100 }], session?.started))
  });
  const pinned = { started: 5000, bodyweightKg: 80, exercises: [{ exerciseId: 'ba3', sets: [S('', 10)] }] };
  assert.strictEqual(Core.calculateVolume(pinned), 800, 'the pinned 80 kg wins over the logged 100 kg');
});

test('sessionsAwaitingBodyweight finds exactly the sessions a backfill would cover', () => {
  Core.setTimedExercises([]);
  Core.setBodyweightModel({ factorFor: id => gymBodyweightFactor(byId(id)), bodyweightFor: () => null });
  const log = [{ t: 9000, kg: 80 }];
  const history = [
    { id: 'old-cali', started: 1000, exercises: [{ exerciseId: 'ch8', sets: [S('', 20)] }] },
    { id: 'old-barbell', started: 1000, exercises: [{ exerciseId: 'lg3', sets: [S(50, 5)] }] },
    { id: 'new-cali', started: 9500, exercises: [{ exerciseId: 'ch8', sets: [S('', 20)] }] },
    { id: 'pinned', started: 1000, bodyweightKg: 79, exercises: [{ exerciseId: 'ch8', sets: [S('', 20)] }] }
  ];
  const pending = Core.sessionsAwaitingBodyweight(history, log, null);
  assert.deepStrictEqual(pending.map(s => s.id), ['old-cali'],
    'only pre-first-weigh-in sessions with unmeasured bodyweight work qualify');
  assert.deepStrictEqual(Core.sessionsAwaitingBodyweight(history, log, 78).map(s => s.id), [],
    'once a backfill is confirmed nothing is still awaiting one');
});

test('Ty legs session: bodyweight loading does NOT paper over the real bug', () => {
  // His unloaded lifts are lever work and a machine he forgot to load. The model must leave the
  // machine gap visible rather than hiding it behind an invented bodyweight number.
  installModel(80);
  const legs = {
    id: 'ty', exercises: [
      { exerciseId: 'lg3', sets: [S(50, 10), S(50, 8), S(50, 8)] },
      { exerciseId: 'lg23', sets: [S('', 10), S('', 10), S('', 8)] },   // Leg Extension, machine
      { exerciseId: 'co1', sets: [S('', 10), S('', 10), S('', 10)] }    // Hanging Leg Raise, lever
    ]
  };
  const history = [{ id: 'prev', started: 1, exercises: [{ exerciseId: 'lg23', sets: [S(60, 10)] }] }];
  assert.deepStrictEqual(Core.loadGaps(history, legs), [{ exerciseId: 'lg23', lastWeight: 60 }]);
  const work = Core.sessionWork(legs);
  assert.strictEqual(work.bodyweightKg, 0, 'none of these movements has an honest body-mass share');
  // 10+10+8 bare leg-extension reps, plus 10+10+10 leg raises.
  assert.strictEqual(work.repsUncounted, 58, 'the leg raises and the bare machine sets are still reported');
});
