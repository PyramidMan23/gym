// Mark's Right-Side Chain plan (2026-08-03) - the first plan built from a PERSON, not a goal tag.
//
// These gate the REASONS the plan exists, not its syntax. Mark's verdict on every build before it was
// "I'm just doing generic exercises, it's not really made for me and my imbalances", and each rule
// below is a specific thing he has reported about his own body. A future edit that quietly puts a back
// squat or an overhead press back in would undo the whole point while every other gate stayed green -
// that is the failure this file exists to catch. Gate the invariant, never the implementation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'exercises.js'), 'utf8');
const { DUCK_EXERCISES, GYM_PLANS } =
  new Function(`${src}; return { DUCK_EXERCISES, GYM_PLANS };`)();

const plan = GYM_PLANS.find(p => p.id === 'plan-mark-chain');
const byId = id => DUCK_EXERCISES.find(e => e.id === id);
const allIds = () => plan.days.flatMap(d => d.exercises.map(e => e.id));
const nameOf = id => (byId(id) || {}).name || id;

test('the plan exists and every day carries a real scheme', () => {
  assert.ok(plan, 'plan-mark-chain is missing');
  assert.equal(plan.days.length, 4);
  for (const day of plan.days) {
    assert.ok(Array.isArray(day.exercises) && day.exercises.length, `${day.name} has no scheme`);
    assert.ok(day.note, `${day.name} has no note - the reasoning is the feature`);
    for (const e of day.exercises) {
      assert.ok(Number.isInteger(e.sets) && e.sets > 0, `${day.name}/${e.id} bad sets`);
      assert.match(String(e.reps), /^\d+-\d+$/, `${day.name}/${e.id} reps must be a lo-hi range`);
      assert.ok(Number.isInteger(e.rest) && e.rest > 0, `${day.name}/${e.id} bad rest`);
    }
  }
});

test('every exercise id resolves to the real catalogue - none invented', () => {
  for (const id of allIds()) assert.ok(byId(id), `${id} is not in the catalogue`);
});

test('exerciseIds is DERIVED from the scheme, so the two lists cannot drift', () => {
  for (const day of plan.days) {
    assert.deepEqual(day.exerciseIds, day.exercises.map(e => e.id), `${day.name} lists disagree`);
  }
  // and the derivation must not have touched the older bare-list plans
  const ret = GYM_PLANS.find(p => p.id === 'plan-return');
  assert.ok(ret.days.every(d => Array.isArray(d.exerciseIds) && !d.exercises));
});

test('NO back squat and NO overhead pressing - his two stated provokers', () => {
  // Back squat is his stated main injury trigger; the belt squat is the substitution.
  const squats = ['lg1', 'lg3'];
  for (const id of squats) {
    assert.ok(!allIds().includes(id), `${nameOf(id)} is his trigger and must not be in this plan`);
  }
  assert.ok(allIds().includes('lg22'), 'Belt Squat is the whole substitution - it must be here');

  // Overhead pressing loads the upper traps hardest and his traps are constantly tight.
  const overhead = ['sh1', 'sh2', 'sh3'].filter(byId);
  for (const id of overhead) {
    assert.ok(!allIds().includes(id), `${nameOf(id)} is overhead pressing and must not be in this plan`);
  }
});

test('the hinge is the kickstand RDL - his one proven pain-free pattern', () => {
  const hingeDay = plan.days.find(d => /Hinge/.test(d.name));
  assert.ok(hingeDay, 'no hinge day');
  assert.equal(hingeDay.exercises[0].id, 'lg4', 'Kickstand RDL must LEAD the hinge day');
  assert.match(hingeDay.note, /LEFT foot forward/,
    'the left-foot-forward setup is the finding - it must be stated on the day');
});

test('pressing is capped at floor range, never a full-depth bench', () => {
  const ids = allIds();
  assert.ok(ids.includes('ch15'), 'Barbell Floor Press is the prescribed press');
  // A +16cm ape index turns a full-depth bench into deep shoulder extension - the impinging position.
  for (const id of ['ch1', 'ch3', 'ch4', 'ch2'].filter(byId)) {
    assert.ok(!ids.includes(id), `${nameOf(id)} is a full-range bench and must not be in this plan`);
  }
});

test('pulling outweighs pressing, and there is ZERO overhead pressing', () => {
  // Classify by the catalogue's own `patterns` vocabulary, not by the `muscle` tag: muscle is a
  // hypertrophy taxonomy, so Face Pull and Band Pull-Apart sit under 'Shoulders' while being
  // posterior-shoulder PULLING work. Counting them as push is what made the first version of this
  // test fire - and it also caught a false "two pulls for every push" claim in the plan's own copy.
  const setsFor = pats => plan.days.flatMap(d => d.exercises)
    .filter(e => ((byId(e.id) || {}).patterns || []).some(p => pats.includes(p)))
    .reduce((n, e) => n + e.sets, 0);
  const pull = setsFor(['Horizontal Pull', 'Vertical Pull']);
  const push = setsFor(['Horizontal Push']);
  assert.ok(pull > push, `compound pull ${pull} must exceed compound push ${push}`);

  // The hard rule, straight off his map: overhead loads the upper traps hardest and his are tight.
  assert.equal(setsFor(['Vertical Push']), 0, 'no vertical pressing may appear in this plan');

  // And the direct counters to the shoulder pattern must be present, not just the absence of harm.
  const ids = allIds();
  assert.ok(ids.includes('sh7'), 'Face Pull: external rotation + lower trap');
  assert.ok(ids.includes('sh8'), 'Band Pull-Apart: cheap posterior shoulder volume');
  assert.ok(ids.includes('mo13'), 'Prone Y-T-W: the left scapula winging');
});

test('the stop rules and the side rule are actually written down', () => {
  assert.match(plan.note, /tingling|numbness/i, 'the neural-tension stop rule must be stated');
  assert.match(plan.note, /RIGHT side first/i, 'weaker-side-first is the point of the plan');
  // It must not claim to treat or correct anything - Mark has no clinician and this is training.
  assert.ok(!/\bcorrect(s|ive)?\b(?! anything)/i.test(plan.note.replace(/nothing here claims to correct anything\.?/i, '')),
    'the plan must not claim to correct anything');
});

test('a plan day opens a session with its real dose, through the existing scheme path', () => {
  const day = plan.days[0];
  const session = Core.createSession({ id: 'plan-mark-chain-d0', name: day.name, exercises: day.exercises });
  assert.equal(session.exercises.length, day.exercises.length);
  const first = session.exercises[0];
  assert.equal(first.exerciseId, 'lg22');
  assert.equal(first.sets.length, 4, 'four planned sets, not one blank');
  assert.equal(first.targetReps, '6-10');
  assert.equal(first.restSeconds, 150);
  assert.ok(first.sets.every(s => s.planned === true && s.weight === '' && s.done === false),
    'planned sets must be blank and flagged, never pre-filled');
});

test('holds and carries are prescribed in SECONDS, matching the timed registry', () => {
  Core.setTimedExercises(DUCK_EXERCISES.filter(e => e.timed).map(e => e.id));
  // Anything the app logs in seconds must read as a duration, so a "30-45" is 30-45s not 30-45 reps.
  const timed = allIds().filter(id => Core.isTimed(id));
  assert.ok(timed.length >= 4, 'the plan should carry holds and carries');
  assert.ok(timed.includes('gr3') && timed.includes('gr7'), 'dead hang + farmer carry are timed');
});
