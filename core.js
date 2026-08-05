(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DuckGymCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const num = value => Number(value) || 0;
  // A completed set with NO numbers is not training evidence (blank done-ticks must not mint
  // volume, exposures, or tolerated baselines) - Codex adversarial finding, council data-honesty rule.
  const doneSets = exercise => (exercise?.sets || []).filter(set => set.done && !(String(set.weight ?? '') === '' && String(set.reps ?? '') === ''));

  // Hold-type exercises (catalogue flag `timed:true`) store SECONDS in the `reps` field. The app
  // registers those ids once at boot from the catalogue - the single source of truth - so every
  // formula below agrees. A registry rather than a threaded predicate means no future caller can
  // silently forget it. Empty default = every exercise is rep-based, i.e. the behaviour before
  // holds existed (audit 2026-07-22: seconds were being maths'd as reps everywhere).
  let TIMED_IDS = new Set();
  const setTimedExercises = ids => { TIMED_IDS = new Set(Array.isArray(ids) ? ids : []); };
  const isTimed = exerciseId => TIMED_IDS.has(exerciseId);
  const bestSecondsOf = sets => sets.reduce((best, set) => Math.max(best, num(set.reps)), 0);

  // kg × seconds is not volume. A hold's work is time under tension, carried on its own axis, so
  // timed exercises add zero to the kg ledger rather than a fabricated number.
  function calculateVolume(session) {
    return (session?.exercises || []).reduce((total, exercise) =>
      total + (isTimed(exercise?.exerciseId) ? 0
        : doneSets(exercise).reduce((sum, set) => sum + num(set.weight) * num(set.reps), 0)), 0);
  }

  // A curated workout arrives as a SCHEME - [{id,sets,reps,rest}] - so the session opens with the
  // planned number of blank set rows and carries the rep RANGE and rest as facts. Loads are never
  // invented: weight stays blank and fills from the lifter's own history like any other session.
  // routine.exerciseIds (routines, plans, quick workouts) is untouched.
  function createSession(routine, now = Date.now()) {
    const scheme = Array.isArray(routine?.exercises) ? routine.exercises : null;
    const blank = () => ({ weight: '', reps: '', done: false });
    return {
      id: `s${now}`,
      routineId: routine?.id || null,
      name: routine?.name || 'Quick workout',
      started: now,
      exercises: scheme
        ? scheme.map(item => ({
            exerciseId: item.id,
            notes: '',
            targetReps: item.reps,
            restSeconds: num(item.rest) || null,
            // planned: a deliberately blank scheme row is INTENDED work - without the flag every
            // blank-set consumer (rail denominator, RIR gate, sets-left) reads it as the
            // auto-appended tail and a 4-set exercise says "complete" after one set (Codex P1).
            sets: Array.from({ length: Math.max(1, num(item.sets)) }, () => ({ ...blank(), planned: true }))
          }))
        : (routine?.exerciseIds || []).map(exerciseId => ({
            exerciseId,
            notes: '',
            sets: [blank()]
          }))
    };
  }

  // Volume variants are COMPUTED from the Base scheme, never stored: reduced drops one set from
  // every movement carrying 3+ (2s are already the floor); expanded adds one set to the first TWO
  // movements that are real training - mobility and stretch work is dosed by quality, not padding.
  // getMuscle(id) returns the catalogue muscle string. The workout data is never mutated.
  function workoutScheme(workout, variant, getMuscle) {
    const list = (workout?.exercises || []).map(e => ({ id: e.id, sets: num(e.sets), reps: e.reps, rest: num(e.rest) }));
    if (variant === 'reduced') for (const e of list) if (e.sets >= 3) e.sets -= 1;
    if (variant === 'expanded') {
      let added = 0;
      for (const e of list) {
        if (added >= 2) break;
        const muscle = getMuscle ? getMuscle(e.id) : '';
        if (muscle === 'Mobility' || muscle === 'Stretches') continue;
        e.sets += 1; added++;
      }
    }
    return list;
  }

  function previousPerformance(history, exerciseId) {
    const ordered = [...(history || [])].sort((a, b) => num(b.started) - num(a.started));
    for (const session of ordered) {
      const exercise = (session.exercises || []).find(item => item.exerciseId === exerciseId);
      const sets = exercise ? doneSets(exercise).map(set => ({ weight: num(set.weight), reps: num(set.reps) })) : [];
      if (sets.length) return sets;
    }
    return [];
  }

  function estimatedOneRepMax(weight, reps) {
    const w = num(weight), r = num(reps);
    return w > 0 && r > 0 ? w * (1 + r / 30) : 0;
  }

  // e1RM is meaningless for a hold (a 60-second hang is not a 3× bodyweight single), so timed
  // exercises carry a `seconds` best instead and leave e1rm at 0.
  function exerciseBest(history, exerciseId) {
    const timed = isTimed(exerciseId);
    let weight = 0, e1rm = 0, seconds = 0;
    for (const session of history || []) {
      const exercise = (session.exercises || []).find(item => item.exerciseId === exerciseId);
      for (const set of exercise ? doneSets(exercise) : []) {
        weight = Math.max(weight, num(set.weight));
        if (timed) seconds = Math.max(seconds, num(set.reps));
        else e1rm = Math.max(e1rm, estimatedOneRepMax(set.weight, set.reps));
      }
    }
    return { weight, e1rm, seconds };
  }

  function detectPRs(history, session) {
    const records = [];
    for (const exercise of session?.exercises || []) {
      const completed = doneSets(exercise);
      if (!completed.length) continue;
      const prior = exerciseBest(history, exercise.exerciseId);
      const bestWeight = Math.max(...completed.map(set => num(set.weight)), 0);
      // A hold's record is TIME (or a heavier hold for the same style) - without this a bodyweight
      // hang could never PR at all, since its weight and e1RM are permanently 0.
      if (isTimed(exercise.exerciseId)) {
        const bestSeconds = bestSecondsOf(completed);
        if (bestSeconds > prior.seconds || bestWeight > prior.weight) {
          records.push({ exerciseId: exercise.exerciseId, weight: bestWeight, seconds: bestSeconds });
        }
        continue;
      }
      const bestE1rm = Math.max(...completed.map(set => estimatedOneRepMax(set.weight, set.reps)), 0);
      if (bestWeight > prior.weight || bestE1rm > prior.e1rm) {
        records.push({ exerciseId: exercise.exerciseId, weight: bestWeight, estimated1RM: Math.round(bestE1rm * 10) / 10 });
      }
    }
    return records;
  }

  // Strength trend: one point per session containing completed sets of the exercise,
  // oldest first - value is the best estimated 1RM that day.
  function exerciseTrend(history, exerciseId) {
    const points = [];
    for (const session of history || []) {
      const exercise = (session.exercises || []).find(item => item.exerciseId === exerciseId);
      const sets = exercise ? doneSets(exercise) : [];
      if (!sets.length) continue;
      points.push({
        started: num(session.started),
        // Timed exercises trend on best hold seconds; e1rm stays 0 so no caller plots a phantom 1RM.
        e1rm: isTimed(exerciseId) ? 0 : Math.round(Math.max(...sets.map(set => estimatedOneRepMax(set.weight, set.reps))) * 10) / 10,
        seconds: isTimed(exerciseId) ? bestSecondsOf(sets) : 0,
        topWeight: Math.max(...sets.map(set => num(set.weight)))
      });
    }
    return points.sort((a, b) => a.started - b.started);
  }

  // Sessions-per-exercise exposure count, for evidence-gating chart unlocks.
  function exerciseExposures(history) {
    const counts = {};
    for (const session of history || []) {
      for (const exercise of session.exercises || []) {
        if (doneSets(exercise).length) counts[exercise.exerciseId] = (counts[exercise.exerciseId] || 0) + 1;
      }
    }
    return counts;
  }

  // Last confirmed-tolerated exposure (council 2026-07-18): a session only counts once
  // post-session response wasn't 'worse' AND the next-session flare check came back 'no'.
  // Sessions without that double confirmation stay 'unresolved' and never become the baseline.
  // opts.requireConfirmation=false drops the flare half of the gate, exactly as confirmedBasis does.
  // The app only ASKS the flare question in injury mode, so demanding its answer outside injury
  // mode left the Local Ramp permanently saying "find an easy working load" for a lifter whose
  // targets were already progressing (audit 2026-07-28: the same mismatch existed in three places).
  function lastConfirmedExposure(history, exerciseId, opts) {
    const requireConfirmation = !(opts && opts.requireConfirmation === false);
    const ordered = [...(history || [])].sort((a, b) => num(b.started) - num(a.started));
    for (const session of ordered) {
      const exercise = (session.exercises || []).find(item => item.exerciseId === exerciseId);
      const sets = exercise ? doneSets(exercise) : [];
      if (!sets.length) continue;
      const checkin = session.checkin;
      if (requireConfirmation && (!checkin || checkin.post === 'worse' || checkin.flare !== false)) continue;
      // Off the injury gate a session marked "worse" is still never a tolerated baseline.
      if (!requireConfirmation && checkin && checkin.post === 'worse') continue;
      return {
        started: num(session.started),
        setCount: sets.length,
        topWeight: Math.max(...sets.map(set => num(set.weight))),
        topReps: Math.max(...sets.map(set => num(set.reps)))
      };
    }
    return null;
  }

  function prFeed(history, limit = 8) {
    const feed = [];
    for (const session of history || []) {
      for (const pr of Array.isArray(session.prs) ? session.prs : []) {
        feed.push({ ...pr, started: num(session.started), sessionId: session.id });
      }
    }
    return feed.sort((a, b) => b.started - a.started).slice(0, limit);
  }

  // Pause-aware elapsed time - the single source for every clock read. `pausedMs` accumulates closed
  // pauses; `pausedAt`, when set, marks a pause still open and freezes the clock at that instant.
  // History sessions carry neither field, so they read as plain wall time (num() → 0).
  function sessionElapsedMs(session, now = Date.now()) {
    if (!session) return 0;
    const end = num(session.pausedAt) || num(session.finished) || now;
    return Math.max(0, end - num(session.started) - num(session.pausedMs));
  }

  function summarizeSession(session) {
    // Duration goes through sessionMinutes so a session left open overnight can never report itself
    // as 1618 minutes of training. `durationMinutes` stays a number for every caller that sums or
    // prints it; `durationCapped` says that number is a floor, not a measurement.
    const read = sessionMinutes(session);
    return {
      durationMinutes: read.minutes == null ? Math.round(MAX_PLAUSIBLE_SESSION_MS / 60000) : read.minutes,
      durationCapped: read.capped,
      durationEstimated: read.estimated,
      completedSets: (session?.exercises || []).reduce((sum, exercise) => sum + doneSets(exercise).length, 0),
      volume: Math.round(calculateVolume(session))
    };
  }

  // Which routines are already done in the CURRENT local week, as a Set of routine ids.
  // createSession has always stamped routineId, but nothing ever read it - this is what turns that
  // dead field into "Push done, Legs done, Pull to go". One pass, so a long history stays cheap.
  function routinesDoneThisWeek(history, now = Date.now()) {
    const start = startOfLocalWeek(now);
    const done = new Set();
    for (const session of history || [])
      if (session?.routineId && num(session.started) >= start) done.add(session.routineId);
    return done;
  }

  function startOfLocalWeek(timestamp) {
    const date = new Date(timestamp);
    const day = (date.getDay() + 6) % 7;
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - day);
    return date.getTime();
  }

  function weeklyStats(history, now = Date.now()) {
    const start = startOfLocalWeek(now);
    const sessions = (history || []).filter(session => num(session.started) >= start && num(session.started) <= now);
    return {
      workouts: sessions.length,
      volume: Math.round(sessions.reduce((sum, session) => sum + calculateVolume(session), 0)),
      completedSets: sessions.reduce((sum, session) => sum + summarizeSession(session).completedSets, 0)
    };
  }

  // Weekly per-muscle set ledgers (council 2026-07-20): a completed set counts 1 DIRECT set
  // for the exercise's primary muscle and 1 ASSISTING exposure for each secondary muscle.
  // The two ledgers are never summed - a blended total would imply false physiological precision.
  function muscleVolume(history, getMuscles, now = Date.now()) {
    const start = startOfLocalWeek(now);
    const out = {};
    const bump = (muscle, key, id, n) => {
      if (!muscle) return;
      const slot = out[muscle] || (out[muscle] = { direct: 0, assisting: 0, by: {} });
      slot[key] += n;
      const at = slot.by[id] || (slot.by[id] = { direct: 0, assisting: 0 });
      at[key] += n;
    };
    for (const session of history || []) {
      const t = num(session.started);
      if (t < start || t > now) continue;
      for (const ex of session.exercises || []) {
        const done = doneSets(ex).length; // blank done-ticks are not evidence - same rule everywhere (Codex P1)
        if (!done) continue;
        const m = getMuscles(ex.exerciseId);
        if (!m || !m.primary) continue;
        bump(m.primary, 'direct', ex.exerciseId, done);
        for (const sec of m.all || []) if (sec !== m.primary) bump(sec, 'assisting', ex.exerciseId, done);
      }
    }
    return out;
  }
  // Planned weekly ledgers for a plan's days at a default set count - labelled "planned", same model.
  function planVolume(days, getMuscles, setsPerExercise = 3) {
    const out = {};
    for (const day of days || []) for (const id of day.exerciseIds || []) {
      const m = getMuscles(id);
      if (!m || !m.primary) continue;
      (out[m.primary] = out[m.primary] || { direct: 0, assisting: 0 }).direct += setsPerExercise;
      for (const sec of m.all || []) if (sec !== m.primary) (out[sec] = out[sec] || { direct: 0, assisting: 0 }).assisting += setsPerExercise;
    }
    return out;
  }

  // Per-side plate breakdown, greedy from the heaviest plate (exact for standard plate sets).
  function plateBreakdown(target, bar = 20, plates = [25, 20, 15, 10, 5, 2.5, 1.25]) {
    const t = num(target);
    if (!(t > bar)) return { perSide: [], remainder: 0, exact: t === bar };
    let side = (t - bar) / 2;
    const perSide = [];
    for (const p of [...plates].sort((a, b) => b - a)) {
      while (side >= p - 1e-9) { perSide.push(p); side -= p; }
    }
    return { perSide, remainder: Math.round(side * 2 * 100) / 100, exact: side < 1e-9 };
  }
  // Per-muscle ledgers for each of the trailing N local weeks, oldest → newest (index N-1 = current).
  // Walks week boundaries backwards via startOfLocalWeek so DST shifts can't skew the windows.
  function muscleVolumeWeeks(history, getMuscles, weeks = 8, now = Date.now()) {
    const out = [];
    let end = now;
    for (let i = 0; i < weeks; i++) {
      out.unshift(muscleVolume(history, getMuscles, end));
      end = startOfLocalWeek(end) - 1;
    }
    return out;
  }

  function safeParse(value, fallback) {
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
  }

  function migrateLegacy(storage) {
    const routines = safeParse(storage?.dg_workouts, []);
    const history = safeParse(storage?.dg_history, []);
    const customExercises = safeParse(storage?.dg_custom, []).map(exercise => ({
      ...exercise,
      equipment: exercise.equipment || 'Custom equipment',
      custom: true
    }));
    return { version: 2, routines, history, customExercises, activeSession: null, preferences: { restSeconds: 90, weeklyWorkoutGoal: 4, weeklySetGoal: 48, weeklyVolumeGoal: 10000 } };
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(num(totalSeconds)));
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return h ? `${h}:${mmss}` : mmss;
  }

  function ringProgress(value, goal) {
    const actual = Math.max(0, num(value));
    const target = Math.max(0, num(goal));
    return { value: actual, goal: target, ratio: target ? Math.min(1, actual / target) : 0 };
  }

  function normalizeActivityGoals(preferences) {
    const source = preferences || {};
    const positive = (value, fallback) => {
      const parsed = num(value);
      return parsed > 0 ? parsed : fallback;
    };
    return {
      weeklyWorkoutGoal: positive(source.weeklyWorkoutGoal, 4),
      weeklySetGoal: positive(source.weeklySetGoal, 48),
      weeklyVolumeGoal: positive(source.weeklyVolumeGoal, 10000)
    };
  }

  function activityMessage(ratio) {
    const progress = Math.max(0, num(ratio));
    if (progress >= 1) return { title: 'Week completed.', detail: 'Goals hit. Anything else is bonus work.' };
    if (progress >= 0.66) return { title: 'Nearly closed.', detail: 'One strong session could do it.' };
    if (progress > 0) return { title: 'Momentum started.', detail: 'Keep the next session simple.' };
    return { title: 'Start your week.', detail: 'One completed set starts the rings.' };
  }

  function setCompletionState(done, setNumber) {
    const completed = Boolean(done);
    return {
      className: completed ? 'completed' : '',
      status: completed ? 'Completed' : 'Pending',
      actionLabel: `Mark set ${setNumber} ${completed ? 'incomplete' : 'complete'}`
    };
  }

  // ---- Catalogue picker (council 2026-07-19): flat, search/filter-first over the multi-tag model. ----
  // Facet readers tolerate custom exercises (name/muscle/equipment only, no muscles[]/patterns[]/equip[]/family).
  const exMuscles = e => (Array.isArray(e?.muscles) && e.muscles.length) ? e.muscles : (e?.muscle ? [e.muscle] : []);
  const exPatterns = e => Array.isArray(e?.patterns) ? e.patterns : [];
  const exEquip = e => Array.isArray(e?.equip) ? e.equip : [];
  // Everything a search query can hit: name + muscle(s) + equipment string + family + pattern/equip tags.
  const searchText = e => [e?.name, ...exMuscles(e), e?.equipment, e?.family, ...exPatterns(e), ...exEquip(e)]
    .filter(Boolean).join(' ').toLowerCase();
  // Search is punctuation-insensitive. The catalogue spells things "Pull-Up", but people type
  // "pull up" or "pullup" - and a raw substring match returned NOTHING for the three most common
  // searches in the app (found 2026-07-22, after a friend of Mark's couldn't find an exercise).
  // `loose` collapses punctuation to spaces; `tight` removes separators entirely.
  const loose = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const tight = s => loose(s).replace(/ /g, '');
  const queryHits = (exercise, query) => {
    const lq = loose(query);
    if (!lq) return true;
    const hay = searchText(exercise);
    return loose(hay).includes(lq) || tight(hay).includes(tight(query));
  };

  // One exercise vs one criteria set - muscle (single) + patterns/equip/families (multi) + query, all AND-combined.
  function matchesExercise(exercise, criteria) {
    const c = criteria || {};
    if (c.muscle && c.muscle !== 'All' && !exMuscles(exercise).includes(c.muscle)) return false;
    const pats = c.patterns || [];
    if (pats.length) { const ep = exPatterns(exercise); if (!pats.some(p => ep.includes(p))) return false; }
    const eqs = c.equip || [];
    if (eqs.length) { const ee = exEquip(exercise); if (!eqs.some(q => ee.includes(q))) return false; }
    const fams = c.families || [];
    if (fams.length && (!exercise.family || !fams.includes(exercise.family))) return false;
    if ((c.query || '').trim() && !queryHits(exercise, c.query)) return false;
    return true;
  }

  // Relevance for query-time ranking: name-prefix > name-substring > any-tag match. Ranking uses the
  // same punctuation-insensitive forms as matching, so "pull up" ranks Pull-Up like "pull-up" does.
  function searchScore(exercise, query) {
    const lq = loose(query);
    if (!lq) return 0;
    const name = loose(exercise?.name);
    if (name.startsWith(lq) || tight(exercise?.name).startsWith(tight(query))) return 3;
    if (name.includes(lq)) return 2;
    if (tight(exercise?.name).includes(tight(query))) return 2;
    return queryHits(exercise, query) ? 1 : 0;
  }

  // Filter + order the catalogue: relevance-ranked while a query is present, otherwise deterministic alphabetical.
  function filterExercises(list, criteria) {
    const c = criteria || {};
    const matched = (list || []).filter(e => matchesExercise(e, c));
    const q = (c.query || '').trim().toLowerCase();
    if (q) {
      return matched
        .map(e => ({ e, s: searchScore(e, q) }))
        .sort((a, b) => b.s - a.s || (a.e.name || '').localeCompare(b.e.name || ''))
        .map(x => x.e);
    }
    return matched.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  // Quick Picks accelerator: favourites first (in order), then distinct recents from history, deduped, capped.
  // ponytail: personal history is small, so a plain scan beats any index. Cap keeps the strip fixed-height.
  function quickPicks(favourites, history, isKnown, cap = 8) {
    const known = id => (typeof isKnown === 'function' ? isKnown(id) : true);
    const seen = new Set(), out = [];
    const push = id => { if (id && !seen.has(id) && known(id)) { seen.add(id); out.push(id); } };
    for (const id of favourites || []) push(id);
    for (const session of history || []) for (const ex of session.exercises || []) push(ex.exerciseId);
    return out.slice(0, cap);
  }

  // Custom-exercise ids reach inline DOM attributes and become the logging key, so a hostile backup must not smuggle
  // quotes/scripts or a numeric/duplicate id through. Coerce to String, keep only safe chars, drop collisions.
  function sanitizeCustomExercises(list, reservedIds) {
    const idOk = /^[A-Za-z0-9_-]+$/;
    const seen = new Set(Array.isArray(reservedIds) ? reservedIds.map(String) : []);
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const id = String(raw.id == null ? '' : raw.id);
      if (!idOk.test(id) || seen.has(id)) continue; // injconnectable, numeric-collision, or duplicate id -> dropped
      seen.add(id);
      out.push({ ...JSON.parse(JSON.stringify(raw)), id });
    }
    return out;
  }

  function validateBackup(data, reservedIds) {
    const validObject = data && typeof data === 'object' && !Array.isArray(data);
    // An activeSession without an exercises ARRAY passes every later `.exercises[i]` deref straight
    // into a TypeError - and importBackup persists before it renders, so a malformed one would brick
    // the next boot. Shape-check it here, where the import can still be rejected cleanly.
    const validSession = data?.activeSession == null || (typeof data.activeSession === 'object' && !Array.isArray(data.activeSession) && Array.isArray(data.activeSession.exercises));
    if (!validObject || data.version !== 2 || !Array.isArray(data.routines) || !Array.isArray(data.history) || (data.customExercises != null && !Array.isArray(data.customExercises)) || !validSession) {
      throw new Error('Invalid Duck Gym backup');
    }
    const preferences = {
      restSeconds: num(data.preferences?.restSeconds) || 90,
      ...normalizeActivityGoals(data.preferences)
    };
    // The chosen workout-volume variant survives the round-trip (Codex P3): silently falling back
    // to the default changes how many sets a one-tap start generates.
    if (['reduced', 'base', 'expanded'].includes(data.preferences?.workoutVolume)) preferences.workoutVolume = data.preferences.workoutVolume;
    return {
      version: 2,
      routines: JSON.parse(JSON.stringify(data.routines)),
      history: JSON.parse(JSON.stringify(data.history)),
      customExercises: sanitizeCustomExercises(data.customExercises, reservedIds),
      activeSession: data.activeSession == null ? null : JSON.parse(JSON.stringify(data.activeSession)),
      exerciseCues: (data.exerciseCues && typeof data.exerciseCues === 'object' && !Array.isArray(data.exerciseCues)) ? JSON.parse(JSON.stringify(data.exerciseCues)) : {},
      // Favourites survive a backup round-trip; unknown/older backups without them default to empty.
      favourites: Array.isArray(data.favourites) ? data.favourites.filter(id => typeof id === 'string') : [],
      // Bodyweight log (Wave 3) survives the round-trip; only well-formed {t,kg} points are kept.
      bodyweight: Array.isArray(data.bodyweight) ? data.bodyweight.filter(e => e && typeof e === 'object' && !Array.isArray(e) && Number.isFinite(Number(e.t)) && Number.isFinite(Number(e.kg))).map(e => ({ t: Number(e.t), kg: Number(e.kg) })) : [],
      preferences
    };
  }

  // Coach-card scoping (council 2026-07-19): a profile earns the Local Ramp / Coach's Block card only
  // once it has skin in the game - some history, a saved routine, or sync configured. Brand-new profiles
  // get a neutral empty state instead, so Mark's re-entry programming is never pushed at housemates.
  function coachEligible(state, syncConfigured) {
    const s = state || {};
    return (Array.isArray(s.history) && s.history.length > 0)
      || (Array.isArray(s.routines) && s.routines.length > 0)
      || !!syncConfigured;
  }

  // ---- Current-session carry-forward (council 2026-07-19, Codex design). ----
  // Prefill for a set comes ONLY from the nearest preceding COMPLETED set IN THIS SESSION -
  // never from history (empty = "not entered", never "assume last time"). Set 1 (index 0) never
  // prefills. Because it reads the completed set's ACTUAL stored numbers, any edit a lifter made to
  // a prefilled set is exactly what carries forward next. Returns {weight, reps} or null.
  function carryForward(exercise, setIndex) {
    if (!exercise) return null;
    const sets = exercise.sets || [];
    // Destination must be a real, existing set after the first (Codex: all-complete has no destination).
    if (setIndex <= 0 || setIndex >= sets.length) return null;
    for (let i = setIndex - 1; i >= 0; i--) {
      const s = sets[i];
      if (!s || !s.done) continue;
      // A blank completed set is not training evidence and must never seed a prefill (Codex).
      if (String(s.weight ?? '') === '' && String(s.reps ?? '') === '') continue;
      return { weight: s.weight, reps: s.reps };
    }
    return null;
  }

  // Explicit set-1 adoption action ("Use last: 40 kg × 8") is offered ONLY while set 1 is still
  // untouched - incomplete AND both fields empty - and there is a last-session source to adopt.
  // The done-tick never auto-adopts; this is the sole path from history into a logged set.
  function showAdoptAction(set, setIndex, hasHistory) {
    return setIndex === 0 && !!hasHistory && !set?.done && set?.weight === '' && set?.reps === '';
  }

  // Numeric-pad −/+ step: clamp at zero, round away binary-float dust (2.5-kg steps otherwise drift).
  function stepValue(current, step, dir) {
    const base = Math.max(0, num(current) + num(step) * (dir < 0 ? -1 : 1));
    return Math.round(base * 100) / 100;
  }

  // Haptics gate: fire only when the device exposes vibrate AND the profile hasn't turned it off
  // (default ON - undefined reads as enabled). iOS has no navigator.vibrate, so hasVibrate is false.
  function shouldBuzz(preferences, hasVibrate) {
    return !!hasVibrate && (preferences?.haptics !== false);
  }

  // ---- Progression loop (Wave 1, council 2026-07-20). All pure, all evidence-gated. ----
  const roundToStep = (v, step) => { const s = num(step) || 2.5; return Math.round((num(v) / s)) * s; };
  // Rounds float dust that 2.5-kg steps leave behind (e.g. 82.50000001).
  const clean = v => Math.round(num(v) * 100) / 100;

  // The basis for progression: the most recent CONFIRMED-TOLERATED session's TOP completed set for
  // this exercise (same double-confirmation gate as lastConfirmedExposure - post !== 'worse' AND the
  // next-session flare check came back 'no'). Returns {weight, reps, rir} or null. rir is that session
  // exercise's stored last-set RIR (number, 'skip', or undefined when never captured).
  // opts.requireConfirmation=false (a lifter not training around an injury) drops the flare/post gate:
  // with no injury to confirm tolerance against, any completed session is valid evidence. The gate is
  // unchanged - and still the default - for anyone in injury mode.
  function confirmedBasis(history, exerciseId, opts) {
    const requireConfirmation = !(opts && opts.requireConfirmation === false);
    const ordered = [...(history || [])].sort((a, b) => num(b.started) - num(a.started));
    for (const session of ordered) {
      const exercise = (session.exercises || []).find(item => item.exerciseId === exerciseId);
      const sets = exercise ? doneSets(exercise) : [];
      if (!sets.length) continue;
      const checkin = session.checkin;
      if (requireConfirmation && (!checkin || checkin.post === 'worse' || checkin.flare !== false)) continue;
      // Even off the injury gate, a session the lifter marked "worse" is never a progression basis.
      if (!requireConfirmation && checkin && checkin.post === 'worse') continue;
      // Drop sets are deliberate back-off work - never the progression basis, and RIR evidence only
      // earns progression when it belongs to the basis (top NON-DROP) set (Codex P1: a drop's RIR 3
      // must not progress the heavy set). RIR is captured on the last non-drop set (app side), so on
      // an all-drop exercise the stored rir has no working-set referent → treat as absent.
      const working = sets.filter(s => !s.drop);
      const pool = working.length ? working : sets;
      let top = pool[0];
      for (const s of pool) {
        if (num(s.weight) > num(top.weight) || (num(s.weight) === num(top.weight) && num(s.reps) > num(top.reps))) top = s;
      }
      return { weight: num(top.weight), reps: num(top.reps), rir: working.length ? exercise.rir : undefined };
    }
    return null;
  }

  // Conservative double progression. Never progresses without RIR evidence (council non-negotiable #3).
  // opts: {repRange:[lo,hi]=[8,12], step=2.5, secondsStep=5, stepDown, block, lastRir,
  // requireConfirmation}. Returns {weight,reps,rule,timed} - or null when there is no prior confirmed
  // data to build a target from. For a timed exercise `reps` is SECONDS and progression runs on that
  // axis: telling someone to hang 8 seconds with +2.5 kg because 60 > 12 is not progression.
  function nextTarget(history, exerciseId, opts) {
    const o = opts || {};
    const range = Array.isArray(o.repRange) && o.repRange.length === 2 ? o.repRange : [8, 12];
    const [lo, hi] = [num(range[0]) || 8, num(range[1]) || 12];
    const step = num(o.step) || 2.5;
    if (o.block) return { weight: null, reps: null, rule: 'blocked' };
    const basis = confirmedBasis(history, exerciseId, o);
    if (!basis) return null;
    const timed = isTimed(exerciseId);
    const rir = o.lastRir !== undefined ? o.lastRir : basis.rir;
    if (timed) {
      const secondsStep = num(o.secondsStep) || 5;
      // Step-down on a hold shortens the hold - scaling a bodyweight hang's load by 0.9 is 0 × 0.9.
      if (o.stepDown) return { weight: basis.weight, reps: Math.max(1, Math.round(basis.reps * 0.9)), rule: 'step-down', timed: true };
      if (rir == null || rir === 'skip') return { weight: basis.weight, reps: basis.reps, rule: 'repeat-no-rir', timed: true };
      if (num(rir) <= 1) return { weight: basis.weight, reps: basis.reps, rule: 'hold', timed: true };
      return { weight: basis.weight, reps: basis.reps + secondsStep, rule: 'add-time', timed: true };
    }
    if (o.stepDown) return { weight: clean(roundToStep(basis.weight * 0.9, step)), reps: basis.reps, rule: 'step-down' };
    // No RIR evidence (never captured or explicitly skipped) → repeat last, never progress.
    if (rir == null || rir === 'skip') return { weight: basis.weight, reps: basis.reps, rule: 'repeat-no-rir' };
    if (num(rir) <= 1) return { weight: basis.weight, reps: basis.reps, rule: 'hold' };
    // rir >= 2: eligible to progress. Fill reps to the top of the range first, then add a load step.
    if (basis.reps < hi) return { weight: basis.weight, reps: basis.reps + 1, rule: 'add-rep' };
    return { weight: clean(basis.weight + step), reps: lo, rule: 'add-load' };
  }

  // Pain controller for the workout logger (council non-negotiable #2). Reads pre-session pain, not charts.
  const PAIN_BLOCK_COPY = 'Pain 7+/10 - train around it today; pain-free alternative only. If severe or persistent, get it assessed.';
  function painGate(history, currentPre) {
    if (currentPre != null && num(currentPre) >= 7) return { block: true, stepDown: false, reason: PAIN_BLOCK_COPY };
    // Rising pain across the last 3 sessions' check-ins (today included when entered), strictly
    // increasing and all non-null → forced step-down.
    const pres = [];
    if (currentPre != null) pres.push(num(currentPre));
    for (const session of [...(history || [])].sort((a, b) => num(b.started) - num(a.started))) {
      const pre = session.checkin ? session.checkin.pre : null;
      if (pre != null) pres.push(num(pre));
    }
    const last3 = pres.slice(0, 3).reverse(); // oldest → newest
    if (last3.length === 3 && last3[0] < last3[1] && last3[1] < last3[2]) {
      return { block: false, stepDown: true, reason: 'Pain has risen three sessions running - stepping the load back today.' };
    }
    // Sustained pain never "rises", so the strictly-increasing test alone left a steady 6,6,6 with no
    // protection at all - chronic mid-range pain is exactly when loading should back off (audit 2026-07-22).
    if (last3.length === 3 && last3.every(p => p >= 5)) {
      return { block: false, stepDown: true, reason: 'Pain has stayed at 5+ for three sessions - stepping the load back today.' };
    }
    return { block: false, stepDown: false, reason: '' };
  }

  // L/R imbalance (Wave 2). Per exerciseId with any side-tagged completed set: {left,right,gapPct,gapSessions}.
  // gapPct = signed top-weight gap (positive = left heavier) relative to the heavier side; null unless both
  // sides have a top weight. gapSessions = sessions where both sides logged and the gap exceeded 10%.
  function sideBalance(history) {
    const acc = {};
    const perSession = {};
    for (const session of history || []) {
      for (const exercise of session.exercises || []) {
        const sided = doneSets(exercise).filter(s => s.side === 'L' || s.side === 'R');
        if (!sided.length) continue;
        const id = exercise.exerciseId;
        const slot = acc[id] || (acc[id] = { left: { topWeight: 0, volume: 0, sets: 0 }, right: { topWeight: 0, volume: 0, sets: 0 } });
        const sess = perSession[id] || (perSession[id] = []);
        const sTop = { L: 0, R: 0 };
        for (const set of sided) {
          const side = set.side === 'L' ? 'left' : 'right';
          slot[side].topWeight = Math.max(slot[side].topWeight, num(set.weight));
          slot[side].volume += num(set.weight) * num(set.reps);
          slot[side].sets += 1;
          sTop[set.side] = Math.max(sTop[set.side], num(set.weight));
        }
        sess.push(sTop);
      }
    }
    const out = {};
    for (const [id, slot] of Object.entries(acc)) {
      const l = slot.left.topWeight, r = slot.right.topWeight;
      const gapPct = (l > 0 && r > 0) ? Math.round((l - r) / Math.max(l, r) * 100) : null;
      const gapSessions = (perSession[id] || []).filter(s => s.L > 0 && s.R > 0 && Math.abs(s.L - s.R) / Math.max(s.L, s.R) > 0.1).length;
      out[id] = { ...slot, gapPct, gapSessions };
    }
    return out;
  }

  // Weekly recap (Wave 2): this local week vs last, with per-muscle direct-set deltas + pain delta.
  function weeklyRecap(history, getMuscles, now = Date.now()) {
    const thisStart = startOfLocalWeek(now);
    const lastEnd = thisStart - 1, lastStart = startOfLocalWeek(lastEnd);
    const inWindow = (start, end) => (history || []).filter(s => num(s.started) >= start && num(s.started) <= end);
    const measure = sessions => {
      let sets = 0, volume = 0, prs = 0, preSum = 0, preCount = 0;
      for (const s of sessions) {
        sets += summarizeSession(s).completedSets;
        volume += calculateVolume(s);
        prs += Array.isArray(s.prs) ? s.prs.length : num(s.prs);
        const pre = s.checkin ? s.checkin.pre : null;
        if (pre != null) { preSum += num(pre); preCount += 1; }
      }
      return { sets, volume: Math.round(volume), workouts: sessions.length, prs, preAvg: preCount ? preSum / preCount : null };
    };
    const cur = measure(inWindow(thisStart, now)), prev = measure(inWindow(lastStart, lastEnd));
    const curMv = muscleVolume(history, getMuscles, now), lastMv = muscleVolume(history, getMuscles, lastEnd);
    const muscles = new Set([...Object.keys(curMv), ...Object.keys(lastMv)]);
    const deltas = [...muscles].map(m => ({ muscle: m, delta: (curMv[m]?.direct || 0) - (lastMv[m]?.direct || 0) }))
      .filter(d => d.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2);
    const painDelta = (cur.preAvg != null && prev.preAvg != null) ? Math.round((cur.preAvg - prev.preAvg) * 10) / 10 : null;
    return {
      sets: cur.sets, setsDelta: cur.sets - prev.sets,
      volume: cur.volume, volumeDelta: cur.volume - prev.volume,
      workouts: cur.workouts, workoutsDelta: cur.workouts - prev.workouts,
      prs: cur.prs, prsDelta: cur.prs - prev.prs,
      topMuscleDeltas: deltas, painDelta
    };
  }

  // Honest, number-only recap sentences. balanceEntry (optional) = {name, side:'left'|'right', gapPct}.
  function recapInsights(recap, balanceEntry) {
    const out = [];
    const r = recap || {};
    const top = (r.topMuscleDeltas || [])[0];
    if (top && top.delta) out.push(`${top.muscle} direct sets ${top.delta > 0 ? 'up' : 'down'} ${Math.abs(top.delta)} vs last week.`);
    if (balanceEntry && balanceEntry.gapPct != null && Math.abs(balanceEntry.gapPct) > 10) {
      const strong = balanceEntry.gapPct > 0 ? 'left' : 'right';
      out.push(`${strong === 'left' ? 'Left' : 'Right'} leads ${strong === 'left' ? 'right' : 'left'} by ${Math.abs(balanceEntry.gapPct)}% on ${balanceEntry.name}.`);
    }
    return out.slice(0, 2);
  }

  // Rep records: heaviest completed weight at each rep count 1..10 across history (Wave 2). Only rows that exist.
  function repRecords(history, exerciseId) {
    if (isTimed(exerciseId)) return []; // "heaviest at 8 reps" is not a thing for a hold - seconds aren't reps
    const best = {};
    for (const session of history || []) {
      const exercise = (session.exercises || []).find(item => item.exerciseId === exerciseId);
      for (const set of exercise ? doneSets(exercise) : []) {
        const reps = num(set.reps), w = num(set.weight);
        if (reps >= 1 && reps <= 10 && w > 0 && w > (best[reps] || 0)) best[reps] = w;
      }
    }
    return Object.keys(best).map(Number).sort((a, b) => a - b).map(reps => ({ reps, weight: best[reps] }));
  }

  // Last N sessions' completed sets for an exercise (Wave 2 detail sheet), newest first.
  function recentSessionsFor(history, exerciseId, limit = 3) {
    const ordered = [...(history || [])].sort((a, b) => num(b.started) - num(a.started));
    const out = [];
    for (const session of ordered) {
      const exercise = (session.exercises || []).find(item => item.exerciseId === exerciseId);
      const sets = exercise ? doneSets(exercise) : [];
      if (!sets.length) continue;
      out.push({ started: num(session.started), sets: sets.map(s => ({ weight: num(s.weight), reps: num(s.reps) })) });
      if (out.length >= limit) break;
    }
    return out;
  }

  // Bodyweight trend, last N days, oldest → newest (Wave 3).
  // ---- Declared goals (2026-07-22). The app measured process and emergent PRs but nothing the
  // lifter actually DECLARED, so it could never say "you are 60% of the way to the thing you came
  // for". A goal is {id, type, target, created, startValue, exerciseId?, achievedAt?}.
  // Progress is measured from startValue - the distance the lifter has actually travelled - never
  // from zero, which would credit work done before the goal existed.
  const GOAL_TYPES = ['strength', 'bodyweight', 'consistency'];
  // Consecutive weeks meeting a per-week session target. The CURRENT week only counts once it is
  // already met - an unfinished week must never read as a broken streak.
  function weekStreak(history, perWeek, now = Date.now()) {
    const target = Math.max(1, num(perWeek));
    const thisStart = startOfLocalWeek(now), WEEK = 7 * 86400000;
    const sessionsIn = (start, end) => (history || []).filter(s => num(s.started) >= start && num(s.started) < end).length;
    let streak = 0;
    if (sessionsIn(thisStart, thisStart + WEEK) >= target) streak++;
    for (let i = 1; i <= 104; i++) {
      const start = thisStart - i * WEEK;
      if (sessionsIn(start, start + WEEK) >= target) streak++; else break;
    }
    return streak;
  }
  // Latest logged bodyweight (null when nothing logged).
  function latestBodyweight(entries) {
    const sorted = (entries || []).filter(e => e && num(e.kg) > 0).sort((a, b) => num(a.t) - num(b.t));
    return sorted.length ? num(sorted[sorted.length - 1].kg) : null;
  }
  // Current value for a goal, in its own unit. null = no evidence yet.
  function goalCurrent(goal, ctx) {
    const c = ctx || {};
    if (!goal) return null;
    if (goal.type === 'strength') {
      const best = exerciseBest(c.history, goal.exerciseId);
      const value = isTimed(goal.exerciseId) ? best.seconds : best.weight;
      return value > 0 ? value : null;
    }
    if (goal.type === 'bodyweight') return latestBodyweight(c.bodyweight);
    if (goal.type === 'consistency') {
      const start = startOfLocalWeek(c.now || Date.now());
      return (c.history || []).filter(s => num(s.started) >= start).length;
    }
    return null;
  }
  function goalProgress(goal, ctx) {
    const c = ctx || {}, now = c.now || Date.now();
    if (!goal || !GOAL_TYPES.includes(goal.type)) return null;
    const target = num(goal.target);
    const current = goalCurrent(goal, { ...c, now });
    const unit = goal.type === 'consistency' ? 'per week' : (goal.type === 'strength' && isTimed(goal.exerciseId)) ? 's' : 'kg';
    if (goal.type === 'consistency') {
      const done = current >= target && target > 0;
      return { type: goal.type, current, target, unit, pct: target ? Math.min(1, current / target) : 0,
        done, remaining: Math.max(0, target - current), streak: weekStreak(c.history, target, now) };
    }
    if (current == null) return { type: goal.type, current: null, target, unit, pct: 0, done: false, remaining: target, noEvidence: true };
    // A bodyweight goal can run in either direction; a strength goal only ever runs up.
    const start = goal.startValue == null ? current : num(goal.startValue);
    const losing = goal.type === 'bodyweight' && target < start;
    const done = losing ? current <= target : current >= target;
    const span = Math.abs(target - start);
    const moved = losing ? start - current : current - start;
    const pct = done ? 1 : span > 0 ? Math.max(0, Math.min(1, moved / span)) : (done ? 1 : 0);
    return { type: goal.type, current, target, unit, pct, done, start,
      remaining: Math.max(0, Math.round((losing ? current - target : target - current) * 10) / 10) };
  }
  // Defensive read of stored goals - the same fail-closed posture as validateBackup. Anything
  // malformed is dropped rather than allowed to throw inside a render.
  function normalizeGoals(list) {
    return (Array.isArray(list) ? list : []).filter(g => g && typeof g === 'object'
      && GOAL_TYPES.includes(g.type) && num(g.target) > 0
      && (g.type !== 'strength' || (typeof g.exerciseId === 'string' && g.exerciseId)))
      .map(g => ({
        id: String(g.id || `g${num(g.created) || 0}`),
        type: g.type,
        exerciseId: g.type === 'strength' ? String(g.exerciseId) : null,
        target: num(g.target),
        startValue: g.startValue == null ? null : num(g.startValue),
        created: num(g.created) || 0,
        achievedAt: g.achievedAt == null ? null : num(g.achievedAt)
      }));
  }
  // Goals newly met this moment - the app stamps achievedAt and celebrates once.
  function newlyAchieved(goals, ctx) {
    return (goals || []).filter(g => !g.achievedAt).filter(g => { const p = goalProgress(g, ctx); return p && p.done; });
  }

  // ---- Session bookends (2026-07-28): warm-up + cool-down from the day's own movement patterns. ----
  // The catalogue already held 31 mobility/stretch entries that nothing ever sequenced. `map` is the
  // curated pattern → drill-ids table that ships with the catalogue (data lives with the data); this
  // is a pure ordered set-union so the same session always proposes the same drills. Deliberately a
  // lookup rather than a scoring function: mobility entries are all tagged pattern 'Mobility', so any
  // overlap score would be fake precision dressed up as intelligence.
  function sessionPatterns(exerciseIds, getPatterns) {
    const seen = new Set();
    for (const id of exerciseIds || []) for (const p of (getPatterns(id) || [])) seen.add(p);
    return [...seen];
  }
  function prepFor(patternList, map, cap = 4) {
    const out = [], seen = new Set();
    for (const pattern of patternList || []) {
      for (const id of (map && map[pattern]) || []) if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
    return out.slice(0, Math.max(0, num(cap)));
  }

  // ---- Deload awareness (2026-07-28) ----
  // Trailing weekly volume, oldest → newest, walking week boundaries backwards so a DST shift can't
  // skew a window (same idiom as muscleVolumeWeeks).
  function weeklyVolumes(history, weeks = 4, now = Date.now()) {
    const out = [];
    let end = now;
    for (let i = 0; i < weeks; i++) {
      const start = startOfLocalWeek(end);
      let volume = 0, workouts = 0;
      for (const session of history || []) {
        const t = num(session.started);
        if (t >= start && t <= end) { volume += calculateVolume(session); workouts += 1; }
      }
      out.unshift({ start, volume: Math.round(volume), workouts });
      end = start - 1;
    }
    return out;
  }
  // Volume that climbs every week with no step-back is how a return to training becomes an injury -
  // exactly the failure mode this app exists to prevent, and nothing modelled it. Measures only
  // COMPLETE weeks: the current week is still being written and would always read as a false drop.
  // Exact figures, deliberately not compacted: 6,260 and 6,340 both round to "6.3k", and a card
  // claiming volume "climbed" between two identical-looking numbers reads broken (council 2026-07-28).
  const exactKg = v => Math.round(num(v)).toLocaleString('en-AU');
  function deloadCheck(history, now = Date.now(), weeks = 3) {
    const span = Math.max(2, num(weeks) || 3);
    const windows = weeklyVolumes(history, span + 1, now);
    const complete = windows.slice(0, span); // drop the in-progress current week
    const none = { due: false, weeks: 0, volumes: [], reason: '' };
    if (complete.length < span || complete.some(w => w.workouts === 0)) return none;
    const rising = complete.every((w, i) => i === 0 || w.volume > complete[i - 1].volume);
    if (!rising) return none;
    return {
      due: true, weeks: span, volumes: complete.map(w => w.volume),
      reason: `Volume has climbed ${span} weeks running (${complete.map(w => exactKg(w.volume)).join(' → ')} kg). Take an easy week: same movements, about half the sets.`
    };
  }

  // ---- Session verdict (council 2026-07-28). The receipt reported totals but never DELTAS: it
  // could not say whether today moved anything. Verdict is computed per lift against the last
  // exposure in history (evidence, never narration): advanced = a heavier top set, more reps at the
  // same load, or a longer hold. Lifts with no prior exposure are baselines, not failures.
  // Returns {verdict:'advanced'|'held'|'backed-off'|'baseline'|'none', advanced, considered,
  // baseline, highlight:{exerciseId,kind:'load'|'reps'|'time',delta}|null}.
  function sessionVerdict(history, session) {
    let advanced = 0, below = 0, considered = 0, baseline = 0, highlight = null;
    const better = (kind, delta, exerciseId) => {
      // Keep the single most impressive advance: load beats reps beats time, then size of the step.
      const rank = { load: 3, reps: 2, time: 1 };
      if (!highlight || rank[kind] > rank[highlight.kind]
        || (rank[kind] === rank[highlight.kind] && delta > highlight.delta)) {
        highlight = { exerciseId, kind, delta };
      }
    };
    for (const exercise of session?.exercises || []) {
      const sets = doneSets(exercise).filter(s => !s.drop); // back-off work never judges the day
      if (!sets.length) continue;
      const prior = previousPerformance(history, exercise.exerciseId);
      if (!prior.length) { baseline++; continue; }
      considered++;
      const timed = isTimed(exercise.exerciseId);
      if (timed) {
        const now_ = bestSecondsOf(sets), was = bestSecondsOf(prior);
        if (now_ > was) { advanced++; better('time', now_ - was, exercise.exerciseId); }
        else if (now_ < was) below++;
        continue;
      }
      const top = list => list.reduce((a, b) =>
        (num(b.weight) > num(a.weight) || (num(b.weight) === num(a.weight) && num(b.reps) > num(a.reps))) ? b : a);
      const t = top(sets), p = top(prior);
      if (num(t.weight) > num(p.weight)) { advanced++; better('load', clean(num(t.weight) - num(p.weight)), exercise.exerciseId); }
      else if (num(t.weight) === num(p.weight) && num(t.reps) > num(p.reps)) { advanced++; better('reps', num(t.reps) - num(p.reps), exercise.exerciseId); }
      else if (estimatedOneRepMax(t.weight, t.reps) < estimatedOneRepMax(p.weight, p.reps)) below++;
    }
    const verdict =
      (considered === 0 && baseline === 0) ? 'none'
        : considered === 0 ? 'baseline'
          : advanced >= Math.ceil(considered / 2) ? 'advanced'
            : below > advanced ? 'backed-off' : 'held';
    return { verdict, advanced, considered, baseline, highlight };
  }

  // ---- Calisthenics ledger (v2 Progress > Trends) ----------------------------------------------
  // Bodyweight strength does not progress in kilos, so it needs its own read. This is PURELY a read
  // over sets that already exist - no schema change, nothing invented:
  //   * a REP movement's score is the best single-set rep count; the vest is that set's logged weight
  //   * a HOLD (isTimed) scores the best seconds, which the app already stores in the reps field
  // "Block" is the last `blockDays`; everything older is the previous best, so a gained rep is shown
  // as a real delta rather than asserted. An exercise with no logged sets is omitted entirely.
  //
  // The unlock rule is NOT a new invention: it is the same double progression nextTarget() already
  // runs - fill the rep range at the current load, then add one load step (secondsStep for holds).
  // `ids` is supplied by the caller so core stays catalogue-agnostic.
  function caliProgress(history, ids, opts) {
    const o = opts || {};
    const now = num(o.now) || Date.now();
    const blockDays = num(o.blockDays) || 28;
    const repTarget = num(o.repTarget) || 12;
    const step = num(o.step) || 2.5;
    const secondsStep = num(o.secondsStep) || 5;
    const cutoff = now - blockDays * 86400000;
    const want = new Set(Array.isArray(ids) ? ids : []);
    const seen = new Map(); // id -> {blockSets:[], priorSets:[]}
    for (const session of history || []) {
      const started = num(session.started);
      for (const exercise of session.exercises || []) {
        if (!want.has(exercise.exerciseId)) continue;
        const sets = doneSets(exercise);
        if (!sets.length) continue;
        if (!seen.has(exercise.exerciseId)) seen.set(exercise.exerciseId, { blockSets: [], priorSets: [] });
        const bucket = seen.get(exercise.exerciseId);
        (started >= cutoff ? bucket.blockSets : bucket.priorSets).push(...sets);
      }
    }
    // Best = the single set with the most reps (or seconds); ties break on the heavier vest.
    const bestOf = sets => sets.reduce((best, set) => {
      if (!best) return set;
      const r = num(set.reps), br = num(best.reps);
      if (r > br || (r === br && num(set.weight) > num(best.weight))) return set;
      return best;
    }, null);
    const reps = [], holds = [];
    for (const [id, bucket] of seen) {
      const block = bestOf(bucket.blockSets), prior = bestOf(bucket.priorSets);
      const current = block || prior;              // no work this block -> the standing best still shows
      if (!current) continue;
      const previous = block ? prior : null;       // a prior-only entry has nothing to compare against
      const value = num(current.reps);
      const previousValue = previous ? num(previous.reps) : null;
      const entry = {
        exerciseId: id,
        value,
        previousValue,
        delta: previousValue == null ? 0 : value - previousValue,
        load: num(current.weight),
        loggedThisBlock: !!block
      };
      if (isTimed(id)) holds.push({ ...entry, nextTier: value + secondsStep });
      else reps.push(entry);
    }
    const bySize = (a, b) => b.value - a.value;
    reps.sort(bySize); holds.sort(bySize);
    // Reps and seconds are DIFFERENT UNITS and are never summed into one scalar: "+16" from
    // 5 reps and 11 seconds is a number that means nothing. gained stays the rep figure.
    const gainedReps = reps.reduce((sum, e) => sum + Math.max(0, e.delta), 0);
    const gainedSeconds = holds.reduce((sum, e) => sum + Math.max(0, e.delta), 0);
    const gained = gainedReps;
    // The unlock that fires NEXT: the rep movement closest to the top of its range, else the hold
    // closest to its next tier. Stated as the rule, never as a promise.
    let nextUnlock = null;
    const climbing = reps.filter(e => e.value < repTarget).sort((a, b) => (repTarget - a.value) - (repTarget - b.value));
    const atTop = reps.filter(e => e.value >= repTarget).sort(bySize);
    if (atTop.length) {
      nextUnlock = { exerciseId: atTop[0].exerciseId, kind: 'load', repsToGo: 0,
        fromLoad: atTop[0].load, toLoad: clean(atTop[0].load + step) };
    } else if (climbing.length) {
      nextUnlock = { exerciseId: climbing[0].exerciseId, kind: 'reps', repsToGo: repTarget - climbing[0].value,
        fromLoad: climbing[0].load, toLoad: clean(climbing[0].load + step) };
    } else if (holds.length) {
      nextUnlock = { exerciseId: holds[0].exerciseId, kind: 'seconds', secondsToGo: secondsStep,
        fromLoad: holds[0].load, toLoad: holds[0].load };
    }
    return { reps, holds, gained, gainedReps, gainedSeconds, repTarget, nextUnlock };
  }

  function bodyweightTrend(entries, days = 90, now = Date.now()) {
    const cutoff = now - days * 86400000;
    return (entries || []).filter(e => num(e.t) >= cutoff).map(e => ({ t: num(e.t), kg: num(e.kg) })).sort((a, b) => a.t - b.t);
  }

  // Reorder = splice MOVE, never a swap: dragging exercise 1 to the end must leave 2,3,4 in their own
  // order, which a swap does not. `tracked` is one index held against the OLD array (the running rest
  // timer is anchored by exercise INDEX, so it has to follow its exercise across the move). Pure so
  // the remap is testable without a DOM: a wrong remap points rest-end progression at the wrong row.
  function moveExercise(list, from, to, tracked = -1) {
    const out = (list || []).slice();
    const ok = Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= 0 && from < out.length && to < out.length;
    if (!ok || from === to) return { list: out, tracked };
    out.splice(to, 0, out.splice(from, 1)[0]);
    const next = tracked === from ? to
      : (from < tracked && tracked <= to) ? tracked - 1
        : (to <= tracked && tracked < from) ? tracked + 1
          : tracked;
    return { list: out, tracked: next };
  }

  // ---- Load honesty (2026-08-05) --------------------------------------------------------------
  // Ty's identical Legs session read 4.4k kg one week and a very different number the next. It was
  // never a maths bug: kg volume is sum(weight x reps), so ANY lift ticked off without a weight
  // contributes exactly zero and vanishes from the headline. Whether two identical sessions match
  // therefore depends on whether a number got typed, not on what was lifted. These three reads make
  // that visible instead of mysterious - none of them invent a load.

  // How many exercises with completed sets actually carried a load. `loaded` is what the kg total
  // measures; `total` is what was trained. Timed holds are excluded from both - they are not on the
  // kg axis at all (see calculateVolume), so counting them as "missing" would be a lie.
  function volumeCoverage(session) {
    let loaded = 0, total = 0;
    for (const exercise of session?.exercises || []) {
      if (isTimed(exercise?.exerciseId)) continue;
      const sets = doneSets(exercise);
      if (!sets.length) continue;
      total += 1;
      if (sets.some(set => num(set.weight) > 0)) loaded += 1;
    }
    return { loaded, total, complete: loaded === total };
  }

  // Lifts logged BARE this session that this lifter has loaded before. Pure evidence, no equipment
  // table: if you put 60 kg on the leg curl last week and none this week, that is the inconsistency
  // itself, and it is the only case where "you forgot the weight" can be asserted rather than
  // guessed. A movement never once loaded (a hanging leg raise) is correctly silent forever.
  function loadGaps(history, session) {
    const out = [];
    for (const exercise of session?.exercises || []) {
      const id = exercise?.exerciseId;
      if (!id || isTimed(id)) continue;
      const sets = doneSets(exercise);
      if (!sets.length || sets.some(set => num(set.weight) > 0)) continue;
      // previousPerformance skips the session under inspection only when it is not yet in history;
      // filter by id so a finished session can be checked against its own past safely.
      const past = previousPerformance((history || []).filter(s => s?.id !== session?.id), id);
      const lastWeight = past.reduce((best, set) => Math.max(best, num(set.weight)), 0);
      if (lastWeight > 0) out.push({ exerciseId: id, lastWeight });
    }
    return out;
  }

  // The opening load for each lift in a session about to start: the lifter's OWN last logged top
  // weight for it. Nothing is invented - a lift never loaded returns nothing, and the caller marks
  // what it writes as `prefilled` so it renders unconfirmed until the lifter agrees with it.
  function openingLoads(history, exerciseIds) {
    const out = {};
    for (const id of new Set(exerciseIds || [])) {
      if (isTimed(id)) continue;
      const top = previousPerformance(history, id).reduce((best, set) => Math.max(best, num(set.weight)), 0);
      if (top > 0) out[id] = top;
    }
    return out;
  }

  // A session left open overnight reads as 1618 MINUTES, which is what Ty's receipt showed. Wall
  // time is only training time while the app is actually being used, so a span past this cap is
  // reported as unknown rather than as a number that is certainly wrong. Sessions logged from here
  // on carry per-set completion stamps (`at`) and use the real first-to-last training span instead.
  const MAX_PLAUSIBLE_SESSION_MS = 4 * 60 * 60 * 1000;
  function trainingSpanMs(session) {
    const stamps = [];
    for (const exercise of session?.exercises || [])
      for (const set of exercise?.sets || [])
        if (set?.done && num(set.at) > 0) stamps.push(num(set.at));
    if (stamps.length < 2) return null;
    return Math.max(...stamps) - Math.min(...stamps);
  }
  // Minutes to report for a finished session, and whether that figure is trustworthy.
  // `estimated` = derived from set stamps rather than the clock; `capped` = wall time was implausible
  // and no stamps exist, so there is no honest number to show.
  function sessionMinutes(session) {
    const wall = sessionElapsedMs(session, num(session?.finished));
    if (wall <= MAX_PLAUSIBLE_SESSION_MS) return { minutes: Math.max(1, Math.round(wall / 60000)), capped: false, estimated: false };
    const span = trainingSpanMs(session);
    // A stamped span is real training time even when the session sat open for a day afterwards.
    if (span != null && span <= MAX_PLAUSIBLE_SESSION_MS) return { minutes: Math.max(1, Math.round(span / 60000)), capped: false, estimated: true };
    return { minutes: null, capped: true, estimated: false };
  }

  return { volumeCoverage, loadGaps, openingLoads, trainingSpanMs, sessionMinutes, MAX_PLAUSIBLE_SESSION_MS,
    goalProgress, goalCurrent, normalizeGoals, newlyAchieved, weekStreak, latestBodyweight, moveExercise,
    setTimedExercises, isTimed, doneSets, calculateVolume, createSession, workoutScheme, previousPerformance, estimatedOneRepMax, detectPRs, sessionElapsedMs, summarizeSession, routinesDoneThisWeek, weeklyStats, migrateLegacy, formatDuration, ringProgress, normalizeActivityGoals, activityMessage, setCompletionState, validateBackup, exerciseTrend, exerciseExposures, prFeed, lastConfirmedExposure, matchesExercise, searchScore, filterExercises, quickPicks, coachEligible, carryForward, showAdoptAction, stepValue, shouldBuzz, muscleVolume, planVolume, plateBreakdown, muscleVolumeWeeks, confirmedBasis, nextTarget, painGate, sideBalance, weeklyRecap, recapInsights, repRecords, recentSessionsFor, bodyweightTrend, caliProgress, sessionPatterns, prepFor, weeklyVolumes, deloadCheck, sessionVerdict };
});
