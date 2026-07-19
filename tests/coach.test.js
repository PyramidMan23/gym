const test = require('node:test');
const assert = require('node:assert/strict');
const Coach = require('../coach.js');
const Sync = require('../sync.js');

const mkSession = (id, started, checkin) => ({ id, started, checkin,
  exercises: [{ exerciseId: 'ch1', sets: [{ weight: 40, reps: 8, done: true }] }] });
const basePlan = (over = {}) => ({
  planId: 'p1', createdAt: 1, basedThroughSessionId: 's-base', expiresAfterSessions: 4,
  capabilities: ['reentry'], notes: '', sessions: [{ title: 'Day A', exercises: [{ exerciseId: 'ch1', sets: 3, reps: 8, load: 40 }] }],
  ...over });
const known = new Set(['ch1', 'ba6', 'lg4']);
const ctx = (over = {}) => ({ history: [mkSession('s-base', 100)], beightonUnlocked: false, isKnown: id => known.has(id), ...over });

// ---- capability gate ----
test('plan with exactly ["reentry"] is usable', () => {
  assert.equal(Coach.validatePlan(basePlan(), ctx()).status, 'usable');
});
test('extra capability is rejected while Beighton is locked', () => {
  const v = Coach.validatePlan(basePlan({ capabilities: ['reentry', 'beighton'] }), ctx());
  assert.equal(v.status, 'rejected');
});
test('extra capability is accepted once Beighton is unlocked', () => {
  const v = Coach.validatePlan(basePlan({ capabilities: ['reentry', 'beighton'] }), ctx({ beightonUnlocked: true }));
  assert.equal(v.status, 'usable');
});
test('capabilities missing "reentry" is rejected', () => {
  assert.equal(Coach.validatePlan(basePlan({ capabilities: ['strength'] }), ctx()).status, 'rejected');
});
test('unreadable plan is rejected, never throws', () => {
  assert.equal(Coach.validatePlan(null, ctx()).status, 'rejected');
  assert.equal(Coach.validatePlan({ planId: 'x' }, ctx()).status, 'rejected');
});

// ---- evidence-boundary supersession ----
test('too many sessions after the evidence boundary supersedes the plan', () => {
  const history = [
    mkSession('s3', 400, { post: 'same', flare: false }),
    mkSession('s2', 300, { post: 'same', flare: false }),
    mkSession('s1', 200, { post: 'same', flare: false }),
    mkSession('s-base', 100)
  ];
  const v = Coach.validatePlan(basePlan({ expiresAfterSessions: 2 }), ctx({ history }));
  assert.equal(v.status, 'superseded');
  assert.equal(v.postCount, 3);
});
test('within the session budget stays usable', () => {
  const history = [mkSession('s1', 200, { post: 'same', flare: false }), mkSession('s-base', 100)];
  assert.equal(Coach.validatePlan(basePlan({ expiresAfterSessions: 2 }), ctx({ history })).status, 'usable');
});

// ---- flare supersession ----
test('a post-boundary flare supersedes the plan', () => {
  const history = [mkSession('s1', 200, { post: 'better', flare: true }), mkSession('s-base', 100)];
  assert.equal(Coach.validatePlan(basePlan(), ctx({ history })).status, 'superseded');
});
test('a post-boundary "worse" post-answer supersedes the plan', () => {
  const history = [mkSession('s1', 200, { post: 'worse', flare: false }), mkSession('s-base', 100)];
  assert.equal(Coach.validatePlan(basePlan(), ctx({ history })).status, 'superseded');
});
test('a flare BEFORE the boundary does not supersede', () => {
  const history = [mkSession('s-base', 100), mkSession('s0', 50, { post: 'worse', flare: true })];
  assert.equal(Coach.validatePlan(basePlan(), ctx({ history })).status, 'usable');
});

// ---- malformed-plan hardening (cross-review #3) ----
test('sessions:[null] is rejected, not thrown', () => {
  assert.equal(Coach.validatePlan(basePlan({ sessions: [null] }), ctx()).status, 'rejected');
});
test('exercises:[null] inside a session is rejected, not thrown', () => {
  assert.equal(Coach.validatePlan(basePlan({ sessions: [{ title: 'A', exercises: [null] }] }), ctx()).status, 'rejected');
});
test('non-object plans (string/array) are rejected, not thrown', () => {
  assert.equal(Coach.validatePlan('a plan', ctx()).status, 'rejected');
  assert.equal(Coach.validatePlan([basePlan()], ctx()).status, 'rejected');
  assert.equal(Coach.validatePlan(basePlan({ sessions: [{ title: 'A' }] }), ctx()).status, 'rejected'); // missing exercises array
});

// ---- untrusted-field rendering safety (cross-review #1) ----
test('doseLine renders hostile plan fields inert: strings dropped, only finite numbers shown', () => {
  assert.equal(Coach.doseLine({ load: '<img src=x onerror=alert(1)>', sets: '<script>', reps: 8 }), '');
  assert.equal(Coach.doseLine({ load: 40, sets: 3, reps: 8 }), '40 kg · 3×8');
  assert.equal(Coach.doseLine({ load: Infinity, sets: NaN, reps: 8 }), '');
  assert.equal(Coach.doseLine({ sets: 3, reps: 8 }), '3×8');
  assert.equal(Coach.doseLine(null), '');
});
test('coachSession sanitizes untrusted fields: numeric strings become null, cue coerced to string', () => {
  const plan = basePlan({ sessions: [{ title: 'A', exercises: [
    { exerciseId: 'ch1', sets: '3"><i>', reps: 8, load: '40', cue: { evil: true } }] }] });
  const s = Coach.coachSession(plan, [], () => true);
  assert.equal(s.exercises[0].sets, null);
  assert.equal(s.exercises[0].load, null);
  assert.equal(s.exercises[0].reps, 8);
  assert.equal(s.exercises[0].cue, '');
});

// ---- unknown exercise ids ----
test('unknown exercise ids are collected, not crashed on, plan still usable', () => {
  const plan = basePlan({ sessions: [{ title: 'Day A', exercises: [
    { exerciseId: 'ch1', sets: 3, reps: 8 }, { exerciseId: 'zzz', sets: 3, reps: 8 }] }] });
  const v = Coach.validatePlan(plan, ctx());
  assert.equal(v.status, 'usable');
  assert.deepEqual(v.unknownExerciseIds, ['zzz']);
});

// ---- local deterministic coach ----
test('local ramp cycles days and steps down after an adverse last session', () => {
  const rampDays = [{ name: 'A', exerciseIds: ['ch1'] }, { name: 'B', exerciseIds: ['ba6'] }, { name: 'C', exerciseIds: ['lg4'] }];
  const clean = Coach.localSession([mkSession('s1', 100, { post: 'same', flare: false })], rampDays, { confirmedFor: () => ({ topWeight: 50 }) });
  assert.equal(clean.title, 'B'); // 1 completed session -> index 1
  assert.equal(clean.stepDown, false);
  assert.equal(clean.exercises[0].load, 50); // load comes from the user's own confirmed exposure
  const down = Coach.localSession([mkSession('s1', 100, { post: 'worse', flare: false })], rampDays, { confirmedFor: () => ({ topWeight: 50 }) });
  assert.equal(down.stepDown, true);
  assert.equal(down.exercises[0].load, 40); // ~20% off
  assert.equal(down.exercises[0].sets, Coach.REENTRY_DOSE.sets - 1); // one fewer set
});

// ---- queue durability ----
test('enqueue dedupes by sessionId (idempotent) and removeFromQueue drops the right item', () => {
  const p1 = { sessionId: 'a', name: 'one' }, p2 = { sessionId: 'b', name: 'two' };
  let q = Sync.enqueue(Sync.enqueue([], p1), p2);
  assert.equal(q.length, 2);
  q = Sync.enqueue(q, { sessionId: 'a', name: 'one-updated' }); // re-enqueue same id
  assert.equal(q.length, 2);
  assert.equal(q.find(x => x.sessionId === 'a').name, 'one-updated');
  q = Sync.removeFromQueue(q, 'a');
  assert.deepEqual(q.map(x => x.sessionId), ['b']);
});
test('queue survives a JSON round-trip (durable localStorage shape)', () => {
  const q = Sync.enqueue([], Sync.sessionToPayload({ id: 's1', started: 1, finished: 2,
    checkin: { pre: 3, post: 'same', flare: false },
    exercises: [{ exerciseId: 'ch1', notes: 'n', sets: [{ weight: 40, reps: 8, done: true, side: 'L' }] }] }));
  const round = JSON.parse(JSON.stringify(q));
  assert.deepEqual(round, q);
  assert.equal(round[0].sessionId, 's1');
  assert.equal(round[0].checkin.flare, false); // three-touch safety answers preserved
  assert.equal(round[0].exercises[0].sets[0].side, 'L'); // L/R side tag preserved
});
test('sessionToPayload captures a stable sessionId and full set data', () => {
  const p = Sync.sessionToPayload({ id: 'x9', exercises: [{ exerciseId: 'ba6', sets: [{ weight: '', reps: '', done: false }] }] });
  assert.equal(p.sessionId, 'x9');
  assert.equal(p.exercises[0].sets[0].done, false);
});
