(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DuckGymCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const num = value => Number(value) || 0;
  const doneSets = exercise => (exercise?.sets || []).filter(set => set.done);

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

  function validateBackup(data) {
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
      customExercises: JSON.parse(JSON.stringify(data.customExercises || [])),
      activeSession: data.activeSession == null ? null : JSON.parse(JSON.stringify(data.activeSession)),
      exerciseCues: (data.exerciseCues && typeof data.exerciseCues === 'object' && !Array.isArray(data.exerciseCues)) ? JSON.parse(JSON.stringify(data.exerciseCues)) : {},
      preferences
    };
  }

  return { calculateVolume, createSession, previousPerformance, estimatedOneRepMax, detectPRs, summarizeSession, weeklyStats, migrateLegacy, formatDuration, ringProgress, normalizeActivityGoals, activityMessage, setCompletionState, validateBackup, exerciseTrend, exerciseExposures, prFeed, lastConfirmedExposure };
});
