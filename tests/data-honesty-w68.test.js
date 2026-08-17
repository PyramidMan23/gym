// w68 data-correctness gates (cross-review with Codex 5.6, 2026-08-17). Each test pins a rule that
// was WRONG in the wild: 0-rep sets minting weight PRs, warm-ups minting e1RM records, duplicate
// exercise rows hiding the heavier set, PRs judged against the future after a history edit, a
// backup that validated shallow and bricked rendering, DST-length weeks breaking streaks, and a
// sync snapshot that could not reproduce the session it claimed to carry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core.js');
const Sync = require('../sync.js');
const Coach = require('../coach.js');
const Profiles = require('../profiles.js');

const set = (weight, reps, extra = {}) => ({ weight: String(weight), reps: String(reps), done: true, ...extra });
const session = (id, started, exercises) => ({ id, started, finished: started + 3600000, exercises });

test.beforeEach(() => Core.setTimedExercises([]));

// ---- doneSets: no reps, no evidence ----
test('a done set with no reps is not a completed set anywhere', () => {
  const ex = { exerciseId: 'lg1', sets: [set(60, ''), set(60, 0), set(100, -5), set('', 10), set(60, 8)] };
  const done = Core.doneSets(ex);
  assert.equal(done.length, 2, 'only the bodyweight 10 and the 60x8 count');
  assert.equal(Core.summarizeSession({ started: 0, finished: 60000, exercises: [ex] }).completedSets, 2);
  assert.equal(Core.calculateVolume({ exercises: [ex] }), 480, 'negative reps can no longer mint negative volume');
});

test('a weight-only done set mints no PR and no exposure', () => {
  const corrupt = [{ exerciseId: 'lg1', sets: [set(60, '')] }];
  assert.deepEqual(Core.detectPRs([], { exercises: corrupt }), [], 'the Ty screenshot class: 60 kg x nothing is not a record');
  assert.deepEqual(Core.exerciseExposures([session('s1', 1000, corrupt)]), {}, 'and not an exposure');
});

// ---- warm-ups are work, never evidence ----
test('warm-up rungs cannot mint PRs, trend points, or rep records', () => {
  const history = [session('h1', 1000, [{ exerciseId: 'lg1', sets: [set(100, 5)] }])];
  const today = { exercises: [{ exerciseId: 'lg1', sets: [set(60, 30, { warmup: true }), set(100, 5)] }] };
  assert.deepEqual(Core.detectPRs(history, today), [], 'a 60x30 warm-up e1RM must not beat the 100x5 working best');
  const trendHist = [session('h2', 2000, [{ exerciseId: 'lg1', sets: [set(60, 30, { warmup: true }), set(100, 5)] }])];
  assert.equal(Core.exerciseTrend(trendHist, 'lg1')[0].e1rm, Math.round(100 * (1 + 5 / 30) * 10) / 10);
  assert.deepEqual(Core.repRecords(trendHist, 'lg1'), [{ reps: 5, weight: 100 }]);
  assert.equal(Core.exerciseBest(trendHist, 'lg1').weight, 100);
});

// ---- duplicate exercise rows ----
test('a second row of the same exercise is real history, not invisible', () => {
  const history = [session('h1', 1000, [
    { exerciseId: 'ch1', sets: [set(50, 5)] },
    { exerciseId: 'ch1', sets: [set(100, 5)] } // the heavier duplicate .find() used to hide
  ])];
  assert.equal(Core.exerciseBest(history, 'ch1').weight, 100);
  assert.deepEqual(Core.detectPRs(history, { exercises: [{ exerciseId: 'ch1', sets: [set(75, 5)] }] }), [],
    '75 kg does not beat the hidden 100 kg row');
  assert.equal(Core.previousPerformance(history, 'ch1').length, 2, 'both rows feed "last time"');
  assert.equal(Core.exerciseTrend(history, 'ch1')[0].topWeight, 100);
});

test('duplicate rows in the session being judged produce ONE record, from all their sets', () => {
  const today = { exercises: [
    { exerciseId: 'ch1', sets: [set(50, 5)] },
    { exerciseId: 'ch1', sets: [set(100, 5)] }
  ] };
  const prs = Core.detectPRs([], today);
  assert.equal(prs.length, 1);
  assert.equal(prs[0].weight, 100);
});

// ---- timed PR pairing: the record is a real set ----
test('a timed PR records one real set, never a stitched weight+seconds pair', () => {
  Core.setTimedExercises(['co1']);
  const today = { exercises: [{ exerciseId: 'co1', sets: [set(20, 5), set('', 60)] }] };
  const prs = Core.detectPRs([], today);
  assert.equal(prs.length, 1);
  assert.equal(prs[0].seconds, 60);
  assert.equal(prs[0].weight, 20, 'weight PR is real (20 kg held) - but the seconds belong to the bodyweight set');
  // The pair {weight:20, seconds:60} was the OLD stitched lie only when weight did NOT beat prior.
  const prior = [session('h1', 1000, [{ exerciseId: 'co1', sets: [set(25, 5)] }])];
  const prs2 = Core.detectPRs(prior, today);
  assert.equal(prs2.length, 1);
  assert.equal(prs2[0].seconds, 60);
  assert.equal(prs2[0].weight, 0, 'seconds-only PR carries the best-hold set weight (bodyweight), not another set 20 kg');
});

// ---- rebuildPRs: chronology after an edit ----
test('rebuildPRs judges every session only against the sessions before it', () => {
  const jan = session('jan', 1000, [{ exerciseId: 'ch1', sets: [set(80, 5)] }]);
  const feb = session('feb', 2000, [{ exerciseId: 'ch1', sets: [set(90, 5)] }]);
  // App order is newest-first.
  let history = Core.rebuildPRs([feb, jan]);
  assert.equal(history.find(s => s.id === 'jan').prs.length, 1, 'first exposure sets the record');
  assert.equal(history.find(s => s.id === 'feb').prs.length, 1, '90 beats 80');
  // Edit January up to 100: February's 90 is no longer a record; January still is.
  const edited = history.map(s => s.id === 'jan' ? { ...s, exercises: [{ exerciseId: 'ch1', sets: [set(100, 5)] }] } : s);
  history = Core.rebuildPRs(edited);
  assert.equal(history.find(s => s.id === 'jan').prs.length, 1);
  assert.equal(history.find(s => s.id === 'feb').prs.length, 0, 'the edit invalidated February\'s PR');
});

// ---- empty sessions are records, not workouts ----
test('a session with zero completed sets counts toward nothing', () => {
  const now = new Date(2026, 6, 23, 9, 0, 0).getTime();
  const empty = { id: 'e1', routineId: 'rX', started: now - 3600000, exercises: [{ exerciseId: 'lg1', sets: [{ weight: '', reps: '', done: false }] }] };
  assert.equal(Core.routinesDoneThisWeek([empty], now).size, 0);
  assert.equal(Core.weeklyStats([empty], now).workouts, 0);
  assert.equal(Core.weekStreak([empty], 1, now), 0);
});

// ---- DST-safe week walking ----
test('weekStreak survives daylight-saving weeks (calendar walk, not 168-hour blocks)', () => {
  // Eight sessions, each 15 minutes after local Monday midnight, walking back across any DST
  // change in range (in AU the first Sunday of April 2026 falls inside this window).
  const anchor = new Date(2026, 3, 15); // Wed 15 Apr 2026 local
  const monday = new Date(anchor); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); monday.setHours(0, 15, 0, 0);
  const history = [];
  for (let w = 0; w < 8; w++) {
    const d = new Date(monday); d.setDate(d.getDate() - 7 * w);
    history.push(session('w' + w, d.getTime(), [{ exerciseId: 'lg1', sets: [set(60, 5)] }]));
  }
  assert.equal(Core.weekStreak(history, 1, anchor.getTime()), 8,
    'a session in the first hour of a post-DST Monday must not break the streak');
});

// ---- validateBackup rejects nested corruption ----
test('validateBackup rejects history whose sessions cannot render', () => {
  const base = { version: 2, routines: [], history: [], customExercises: [], activeSession: null };
  assert.throws(() => Core.validateBackup({ ...base, history: [{ started: 1, exercises: { bad: true } }] }, []));
  assert.throws(() => Core.validateBackup({ ...base, history: [{ started: 1, exercises: [{ sets: 'nope' }] }] }, []));
  assert.throws(() => Core.validateBackup({ ...base, activeSession: { exercises: [{ sets: null }] } }, []));
  const ok = Core.validateBackup({ ...base, history: [{ started: 1, exercises: [{ exerciseId: 'lg1', sets: [] }] }] }, []);
  assert.equal(ok.history.length, 1);
});

// ---- sync payload fidelity ----
test('sessionToPayload carries the fields needed to reproduce the session', () => {
  const payload = Sync.sessionToPayload({
    id: 's1', name: 'n', started: 1, finished: 2, routineId: 'r9', bodyweightKg: 80.5, pausedMs: 60000,
    exercises: [{ exerciseId: 'lg1', rir: 2, sets: [
      { weight: '60', reps: '5', done: true, warmup: true },
      { weight: '48', reps: '8', done: true, drop: true },
      { weight: '60', reps: '8', done: true }
    ] }]
  });
  assert.equal(payload.routineId, 'r9');
  assert.equal(payload.bodyweightKg, 80.5);
  assert.equal(payload.pausedMs, 60000);
  assert.equal(payload.exercises[0].rir, 2);
  assert.equal(payload.exercises[0].sets[0].warmup, true);
  assert.equal(payload.exercises[0].sets[1].drop, true);
  assert.equal(payload.exercises[0].sets[2].warmup, undefined, 'flags only travel when set');
  assert.equal(Sync.sessionToPayload({ id: 'x' }).rir, undefined);
});

// ---- flush dequeues only the exact uploaded snapshot (wiring pin on real code) ----
test('flush removes the uploaded snapshot by identity, not by session id alone', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sync.js'), 'utf8');
  assert.match(source, /JSON\.stringify\(item\) === JSON\.stringify\(payload\)/,
    'the in-flight-correction race guard must compare snapshots, not ids');
});

// ---- coach doses can never go negative ----
test('coach safeNum refuses negative doses', () => {
  assert.equal(Coach.safeNum(-5), null);
  assert.equal(Coach.safeNum(-0.1), null);
  assert.equal(Coach.safeNum(0), 0);
  assert.equal(Coach.safeNum(8), 8);
});

// ---- a junk profile NAME must not orphan its history ----
test('parseRegistry salvages a profile whose name is malformed', () => {
  const reg = Profiles.parseRegistry(JSON.stringify({
    activeId: 'p_aa11', profiles: [
      { id: 'p_aa11', name: 'Mark' },
      { id: 'p_bb22', name: null } // pre-fix this row was silently DROPPED, orphaning its state
    ]
  }));
  assert.equal(reg.profiles.length, 2);
  assert.equal(reg.profiles[1].name, '');
});

// ---- app.js input sanitation, lifted and run ----
test('cleanSetValue rejects negatives and junk, keeps blanks and decimals', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const m = source.match(/function cleanSetValue\(value\)\{[^\n]*\}/);
  assert.ok(m, 'cleanSetValue must exist');
  const cleanSetValue = new Function('value', m[0].replace(/^function cleanSetValue\(value\)\{/, '').replace(/\}$/, ''));
  assert.equal(cleanSetValue('-10'), '');
  assert.equal(cleanSetValue('abc'), '');
  assert.equal(cleanSetValue(''), '');
  assert.equal(cleanSetValue('  '), '');
  assert.equal(cleanSetValue('82.5'), '82.5');
  assert.equal(cleanSetValue('0'), '0');
  assert.match(source, /function updateSet\([^)]*\)\{[^\n]*cleanSetValue\(value\)/, 'updateSet must sanitize');
  assert.match(source, /function editHistorySet\([\s\S]{0,200}?cleanSetValue\(value\)/, 'editHistorySet must sanitize');
});

// ---- Ty's request: the catalogue carries a Dumbbell Pullover ----
test('Dumbbell Pullover is in the catalogue and findable', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'exercises.js'), 'utf8');
  assert.match(src, /name:'Dumbbell Pullover'/);
});
