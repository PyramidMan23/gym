(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DuckGymCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const num = value => Number(value) || 0;
  // A completed set with NO numbers is not training evidence (blank done-ticks must not mint
  // volume, exposures, or tolerated baselines) — Codex adversarial finding, council data-honesty rule.
  const doneSets = exercise => (exercise?.sets || []).filter(set => set.done && !(String(set.weight ?? '') === '' && String(set.reps ?? '') === ''));

  function calculateVolume(session) {
    return (session?.exercises || []).reduce((total, exercise) =>
      total + doneSets(exercise).reduce((sum, set) => sum + num(set.weight) * num(set.reps), 0), 0);
  }

  function createSession(routine, now = Date.now()) {
    return {
      id: `s${now}`,
      routineId: routine?.id || null,
      name: routine?.name || 'Quick workout',
      started: now,
      exercises: (routine?.exerciseIds || []).map(exerciseId => ({
        exerciseId,
        notes: '',
        sets: [{ weight: '', reps: '', done: false }]
      }))
    };
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

  function exerciseBest(history, exerciseId) {
    let weight = 0, e1rm = 0;
    for (const session of history || []) {
      const exercise = (session.exercises || []).find(item => item.exerciseId === exerciseId);
      for (const set of exercise ? doneSets(exercise) : []) {
        weight = Math.max(weight, num(set.weight));
        e1rm = Math.max(e1rm, estimatedOneRepMax(set.weight, set.reps));
      }
    }
    return { weight, e1rm };
  }

  function detectPRs(history, session) {
    const records = [];
    for (const exercise of session?.exercises || []) {
      const completed = doneSets(exercise);
      if (!completed.length) continue;
      const prior = exerciseBest(history, exercise.exerciseId);
      const bestWeight = Math.max(...completed.map(set => num(set.weight)), 0);
      const bestE1rm = Math.max(...completed.map(set => estimatedOneRepMax(set.weight, set.reps)), 0);
      if (bestWeight > prior.weight || bestE1rm > prior.e1rm) {
        records.push({ exerciseId: exercise.exerciseId, weight: bestWeight, estimated1RM: Math.round(bestE1rm * 10) / 10 });
      }
    }
    return records;
  }

  // Strength trend: one point per session containing completed sets of the exercise,
  // oldest first — value is the best estimated 1RM that day.
  function exerciseTrend(history, exerciseId) {
    const points = [];
    for (const session of history || []) {
      const exercise = (session.exercises || []).find(item => item.exerciseId === exerciseId);
      const sets = exercise ? doneSets(exercise) : [];
      if (!sets.length) continue;
      points.push({
        started: num(session.started),
        e1rm: Math.round(Math.max(...sets.map(set => estimatedOneRepMax(set.weight, set.reps))) * 10) / 10,
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
  function lastConfirmedExposure(history, exerciseId) {
    const ordered = [...(history || [])].sort((a, b) => num(b.started) - num(a.started));
    for (const session of ordered) {
      const exercise = (session.exercises || []).find(item => item.exerciseId === exerciseId);
      const sets = exercise ? doneSets(exercise) : [];
      if (!sets.length) continue;
      const checkin = session.checkin;
      if (!checkin || checkin.post === 'worse' || checkin.flare !== false) continue;
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

  function summarizeSession(session) {
    const duration = Math.max(0, num(session?.finished) - num(session?.started));
    return {
      durationMinutes: Math.max(1, Math.round(duration / 60000)),
      completedSets: (session?.exercises || []).reduce((sum, exercise) => sum + doneSets(exercise).length, 0),
      volume: Math.round(calculateVolume(session))
    };
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

  // One exercise vs one criteria set — muscle (single) + patterns/equip/families (multi) + query, all AND-combined.
  function matchesExercise(exercise, criteria) {
    const c = criteria || {};
    if (c.muscle && c.muscle !== 'All' && !exMuscles(exercise).includes(c.muscle)) return false;
    const pats = c.patterns || [];
    if (pats.length) { const ep = exPatterns(exercise); if (!pats.some(p => ep.includes(p))) return false; }
    const eqs = c.equip || [];
    if (eqs.length) { const ee = exEquip(exercise); if (!eqs.some(q => ee.includes(q))) return false; }
    const fams = c.families || [];
    if (fams.length && (!exercise.family || !fams.includes(exercise.family))) return false;
    const q = (c.query || '').trim().toLowerCase();
    if (q && !searchText(exercise).includes(q)) return false;
    return true;
  }

  // Relevance for query-time ranking: name-prefix > name-substring > any-tag match.
  function searchScore(exercise, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return 0;
    const name = (exercise?.name || '').toLowerCase();
    if (name.startsWith(q)) return 3;
    if (name.includes(q)) return 2;
    if (searchText(exercise).includes(q)) return 1;
    return 0;
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
    const validSession = data?.activeSession == null || (typeof data.activeSession === 'object' && !Array.isArray(data.activeSession));
    if (!validObject || data.version !== 2 || !Array.isArray(data.routines) || !Array.isArray(data.history) || (data.customExercises != null && !Array.isArray(data.customExercises)) || !validSession) {
      throw new Error('Invalid Duck Gym backup');
    }
    const preferences = {
      restSeconds: num(data.preferences?.restSeconds) || 90,
      ...normalizeActivityGoals(data.preferences)
    };
    return {
      version: 2,
      routines: JSON.parse(JSON.stringify(data.routines)),
      history: JSON.parse(JSON.stringify(data.history)),
      customExercises: sanitizeCustomExercises(data.customExercises, reservedIds),
      activeSession: data.activeSession == null ? null : JSON.parse(JSON.stringify(data.activeSession)),
      exerciseCues: (data.exerciseCues && typeof data.exerciseCues === 'object' && !Array.isArray(data.exerciseCues)) ? JSON.parse(JSON.stringify(data.exerciseCues)) : {},
      // Favourites survive a backup round-trip; unknown/older backups without them default to empty.
      favourites: Array.isArray(data.favourites) ? data.favourites.filter(id => typeof id === 'string') : [],
      preferences
    };
  }

  // Coach-card scoping (council 2026-07-19): a profile earns the Local Ramp / Coach's Block card only
  // once it has skin in the game — some history, a saved routine, or sync configured. Brand-new profiles
  // get a neutral empty state instead, so Mark's re-entry programming is never pushed at housemates.
  function coachEligible(state, syncConfigured) {
    const s = state || {};
    return (Array.isArray(s.history) && s.history.length > 0)
      || (Array.isArray(s.routines) && s.routines.length > 0)
      || !!syncConfigured;
  }

  // ---- Current-session carry-forward (council 2026-07-19, Codex design). ----
  // Prefill for a set comes ONLY from the nearest preceding COMPLETED set IN THIS SESSION —
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
  // untouched — incomplete AND both fields empty — and there is a last-session source to adopt.
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
  // (default ON — undefined reads as enabled). iOS has no navigator.vibrate, so hasVibrate is false.
  function shouldBuzz(preferences, hasVibrate) {
    return !!hasVibrate && (preferences?.haptics !== false);
  }

  return { calculateVolume, createSession, previousPerformance, estimatedOneRepMax, detectPRs, summarizeSession, weeklyStats, migrateLegacy, formatDuration, ringProgress, normalizeActivityGoals, activityMessage, setCompletionState, validateBackup, exerciseTrend, exerciseExposures, prFeed, lastConfirmedExposure, matchesExercise, searchScore, filterExercises, quickPicks, coachEligible, carryForward, showAdoptAction, stepValue, shouldBuzz };
});
