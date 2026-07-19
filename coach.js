// Deterministic local re-entry coach + remote-plan validation contract (council 2026-07-18).
// UMD like core.js: a browser global (DuckGymCoach) and a require()-able node module.
// The validator is pure and evidence-driven — a remote plan only survives if the body's own
// logged evidence says it should. The local coach is always available with zero network.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DuckGymCoach = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const num = value => Number(value) || 0;
  const SUPERSEDED = 'Plan superseded by new evidence — using safe local programming.';
  // ponytail: a plan SHOULD carry expiresAfterSessions; this ceiling only applies when it omits one.
  const DEFAULT_EXPIRES = 6;
  // Conservative re-entry dose. Load is never invented — it comes from the user's own confirmed
  // exposure; only sets/reps are defaulted so the local ramp can prescribe at all.
  const REENTRY_DOSE = { sets: 3, reps: 8 };

  // Plan JSON contract:
  // { planId, createdAt, basedThroughSessionId, expiresAfterSessions, capabilities:["reentry",...],
  //   notes, sessions:[{title, exercises:[{exerciseId, sets, reps, load, cue}]}] }
  const isObj = value => !!value && typeof value === 'object' && !Array.isArray(value);
  function isPlanShape(plan) {
    return isObj(plan)
      && typeof plan.planId === 'string'
      && Array.isArray(plan.capabilities)
      && Array.isArray(plan.sessions)
      // Deep shape: every session an object with an exercises array of objects —
      // a malformed remote plan must reject cleanly, never throw later in render.
      && plan.sessions.every(session => isObj(session) && Array.isArray(session.exercises)
        && session.exercises.every(isObj));
  }

  // Untrusted-plan number: finite number in → number out, anything else → null.
  const safeNum = value => (typeof value === 'number' && Number.isFinite(value)) ? value : null;
  // Pure dose formatter for the coach card — plain text only, numbers coerced, so the
  // caller can esc() the result and a hostile plan (load:"<img onerror>") renders inert.
  function doseLine(exercise) {
    const load = safeNum(exercise && exercise.load);
    const sets = safeNum(exercise && exercise.sets);
    const reps = safeNum(exercise && exercise.reps);
    return [load !== null ? `${load} kg` : '', sets !== null && reps !== null ? `${sets}×${reps}` : ''].filter(Boolean).join(' · ');
  }

  // Capability gate: exactly ["reentry"] unless the Beighton filming has unlocked "beighton".
  function capabilityAllowed(caps, beightonUnlocked) {
    const allowed = new Set(['reentry']);
    if (beightonUnlocked) allowed.add('beighton');
    return Array.isArray(caps) && caps.length > 0 && caps.includes('reentry') && caps.every(c => allowed.has(c));
  }

  function boundaryStarted(history, basedId) {
    const based = (history || []).find(session => session.id === basedId);
    // No anchor found → treat everything as post-evidence (conservative: supersede more readily).
    return based ? num(based.started) : -Infinity;
  }
  function postSessions(history, basedId) {
    const boundary = boundaryStarted(history, basedId);
    return (history || []).filter(session => num(session.started) > boundary);
  }
  function adverse(session) {
    const checkin = session && session.checkin;
    return !!checkin && (checkin.post === 'worse' || checkin.flare === true);
  }

  function planUnknownIds(plan, isKnown) {
    const ids = [];
    for (const session of plan.sessions || [])
      for (const exercise of session.exercises || [])
        if (!isKnown(exercise.exerciseId) && !ids.includes(exercise.exerciseId)) ids.push(exercise.exerciseId);
    return ids;
  }

  // Hard validation. Returns {status:'usable'|'rejected'|'superseded', reason, postCount, unknownExerciseIds}.
  // rejected = never usable (unreadable / locked capability). superseded = was reentry, evidence killed it.
  function validatePlan(plan, context) {
    const ctx = context || {};
    const isKnown = ctx.isKnown || (() => true);
    if (!isPlanShape(plan))
      return { status: 'rejected', code: 'unreadable', reason: 'This plan could not be read.', postCount: 0, unknownExerciseIds: [] };
    const unknown = planUnknownIds(plan, isKnown);
    if (!capabilityAllowed(plan.capabilities, !!ctx.beightonUnlocked))
      return { status: 'rejected', reason: 'This plan needs a capability that hasn’t been unlocked.', postCount: 0, unknownExerciseIds: unknown };
    const post = postSessions(ctx.history, plan.basedThroughSessionId);
    const limit = Number.isFinite(plan.expiresAfterSessions) ? plan.expiresAfterSessions : DEFAULT_EXPIRES;
    if (post.length > limit)
      return { status: 'superseded', reason: SUPERSEDED, postCount: post.length, unknownExerciseIds: unknown };
    if (post.some(adverse))
      return { status: 'superseded', reason: SUPERSEDED, postCount: post.length, unknownExerciseIds: unknown };
    return { status: 'usable', reason: '', postCount: post.length, unknownExerciseIds: unknown };
  }

  // ---- Local deterministic coach (always available, zero network) ----
  function rampIndex(completedCount, dayCount) {
    if (!dayCount) return 0;
    return ((num(completedCount) % dayCount) + dayCount) % dayCount;
  }
  function stepDownNeeded(lastSession) { return adverse(lastSession); }
  function applyStepDown(dose) {
    return {
      sets: Math.max(1, num(dose.sets) - 1),               // volume down one set
      reps: dose.reps,
      load: dose.load ? Math.round(num(dose.load) * 0.8 * 10) / 10 : dose.load // ~20% off
    };
  }

  // Build the next local ramp session from real data. Pure: caller passes the ramp's days,
  // history, a confirmed-exposure lookup and an id->known check. Only exercises the ramp already
  // names (all from exercises.js); no new exercise claims, nothing "corrective".
  function localSession(history, rampDays, options) {
    const opts = options || {};
    const days = rampDays || [];
    if (!days.length) return null;
    const index = rampIndex((history || []).length, days.length);
    const day = days[index];
    const down = stepDownNeeded((history || [])[0]);
    const confirmedFor = opts.confirmedFor || (() => null);
    const exercises = (day.exerciseIds || []).map(id => {
      const confirmed = confirmedFor(id);
      let dose = { sets: REENTRY_DOSE.sets, reps: REENTRY_DOSE.reps, load: confirmed && confirmed.topWeight ? confirmed.topWeight : null };
      if (down) dose = applyStepDown(dose);
      return {
        exerciseId: id, sets: dose.sets, reps: dose.reps, load: dose.load,
        cue: down ? 'Stepping back to your last tolerated exposure.'
          : (confirmed ? 'At your last confirmed-tolerated load.' : 'Find an easy working load.')
      };
    });
    return { title: day.name, exercises, stepDown: down, index };
  }

  // Map a usable remote plan to the same suggestion shape. Unknown ids are flagged, never crash.
  function nextPlanIndex(plan, history) {
    return rampIndex(postSessions(history, plan.basedThroughSessionId).length, (plan.sessions || []).length);
  }
  function coachSession(plan, history, isKnown) {
    const known = isKnown || (() => true);
    const index = nextPlanIndex(plan, history);
    const day = (plan.sessions || [])[index];
    if (!day) return null;
    // Sanitize untrusted plan fields at the boundary: numbers or null, cue as plain string.
    const exercises = (day.exercises || []).map(exercise => ({
      exerciseId: String(exercise.exerciseId || ''), sets: safeNum(exercise.sets), reps: safeNum(exercise.reps),
      load: safeNum(exercise.load), cue: typeof exercise.cue === 'string' ? exercise.cue : '', unknown: !known(exercise.exerciseId)
    }));
    return { title: day.title || `Session ${index + 1}`, exercises, index };
  }

  return {
    validatePlan, postSessions, capabilityAllowed, doseLine, safeNum,
    rampIndex, stepDownNeeded, applyStepDown, localSession, nextPlanIndex, coachSession,
    DEFAULT_EXPIRES, REENTRY_DOSE
  };
});
