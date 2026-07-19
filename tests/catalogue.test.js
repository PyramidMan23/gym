// Referential integrity for the equipment catalogue + templates + plans.
// exercises.js is plain global consts (loaded via <script> in the browser),
// so eval it in a sandboxed function scope and pull the three arrays out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'exercises.js'), 'utf8');
const { DUCK_EXERCISES, GYM_TEMPLATES, GYM_PLANS } =
  new Function(`${src}; return { DUCK_EXERCISES, GYM_TEMPLATES, GYM_PLANS };`)();
const ids = new Set(DUCK_EXERCISES.map(e => e.id));

test('exercise ids are unique', () => {
  assert.equal(ids.size, DUCK_EXERCISES.length);
});

test('every exercise has id, name, muscle, equipment', () => {
  for (const e of DUCK_EXERCISES)
    for (const key of ['id', 'name', 'muscle', 'equipment'])
      assert.ok(e[key] && typeof e[key] === 'string', `${e.id || '?'} missing ${key}`);
});

// ---- Multi-tag data model (council 2026-07-19) ----
const MUSCLE_VOCAB = new Set(['Chest', 'Back', 'Shoulders', 'Arms', 'Grip', 'Legs', 'Core', 'Full Body', 'Cardio', 'Mobility', 'Calisthenics', 'Stretches']);
const PATTERN_VOCAB = new Set(['Horizontal Push', 'Vertical Push', 'Horizontal Pull', 'Vertical Pull', 'Squat', 'Hinge', 'Lunge', 'Carry', 'Anti-Rotation', 'Rotation', 'Isolation', 'Olympic', 'Conditioning', 'Mobility']);
const EQUIP_VOCAB = new Set(['Barbell', 'EZ Bar', 'Trap Bar', 'Dumbbell', 'Kettlebell', 'Cable', 'Smith', 'Machine', 'Pull-Up Bar', 'Bench', 'Bodyweight', 'Band', 'BOSU', 'Slant Board', 'Tib Bar', 'Hang Board', 'Wrist Axe', 'Rope', 'Plate']);

test('muscle === muscles[0] for every exercise (backward-compat)', () => {
  for (const e of DUCK_EXERCISES)
    assert.equal(e.muscle, e.muscles?.[0], `${e.id} muscle "${e.muscle}" !== muscles[0] "${e.muscles?.[0]}"`);
});

test('every exercise has non-empty muscles[], patterns[], family, equip[]', () => {
  for (const e of DUCK_EXERCISES) {
    assert.ok(Array.isArray(e.muscles) && e.muscles.length, `${e.id} muscles[] empty`);
    assert.ok(Array.isArray(e.patterns) && e.patterns.length, `${e.id} patterns[] empty`);
    assert.ok(typeof e.family === 'string' && e.family.trim(), `${e.id} family empty`);
    assert.ok(Array.isArray(e.equip) && e.equip.length, `${e.id} equip[] empty`);
  }
});

test('every muscles / patterns / equip value is in the fixed vocab', () => {
  for (const e of DUCK_EXERCISES) {
    for (const m of e.muscles) assert.ok(MUSCLE_VOCAB.has(m), `${e.id} bad muscle "${m}"`);
    for (const p of e.patterns) assert.ok(PATTERN_VOCAB.has(p), `${e.id} bad pattern "${p}"`);
    for (const q of e.equip) assert.ok(EQUIP_VOCAB.has(q), `${e.id} bad equip "${q}"`);
  }
});

test('every template references real exercises', () => {
  for (const t of GYM_TEMPLATES) {
    assert.ok(t.exerciseIds.length, `${t.id} has no exercises`);
    for (const x of t.exerciseIds) assert.ok(ids.has(x), `template ${t.id} references missing ${x}`);
  }
});

test('every plan day references real exercises', () => {
  for (const p of GYM_PLANS) {
    assert.ok(p.days.length, `${p.id} has no days`);
    for (const d of p.days) {
      assert.ok(d.exerciseIds.length, `${p.id}/${d.name} empty`);
      for (const x of d.exerciseIds) assert.ok(ids.has(x), `plan ${p.id} day "${d.name}" references missing ${x}`);
    }
  }
});

// ---- Picker pure logic (council 2026-07-19): filter/match, ranking, quick picks, favourites round-trip ----
const bench = DUCK_EXERCISES.find(e => e.id === 'ch1'); // Barbell Bench Press: Chest/Shoulders/Arms, Horizontal Push, Bench Press, Barbell+Bench

test('matchesExercise AND-combines muscle + pattern + equip + family + query', () => {
  assert.ok(bench, 'ch1 must exist');
  assert.ok(Core.matchesExercise(bench, { muscle: 'Chest' }));
  assert.ok(Core.matchesExercise(bench, { muscle: 'Shoulders' }), 'secondary muscle matches');
  assert.ok(!Core.matchesExercise(bench, { muscle: 'Back' }));
  assert.ok(Core.matchesExercise(bench, { patterns: ['Horizontal Push'] }));
  assert.ok(!Core.matchesExercise(bench, { patterns: ['Hinge'] }));
  assert.ok(Core.matchesExercise(bench, { equip: ['Bench'] }));
  assert.ok(!Core.matchesExercise(bench, { equip: ['Cable'] }));
  assert.ok(Core.matchesExercise(bench, { families: ['Bench Press'] }));
  assert.ok(!Core.matchesExercise(bench, { families: ['Row'] }));
  assert.ok(Core.matchesExercise(bench, { query: 'bench' }));
  assert.ok(!Core.matchesExercise(bench, { query: 'zzz' }));
  // all facets + query together must all pass
  assert.ok(Core.matchesExercise(bench, { muscle: 'Chest', patterns: ['Horizontal Push'], equip: ['Barbell'], families: ['Bench Press'], query: 'barbell' }));
  // a single mismatched facet fails the AND
  assert.ok(!Core.matchesExercise(bench, { muscle: 'Chest', equip: ['Kettlebell'] }));
});

test('within a facet the selection is OR (any value hits)', () => {
  assert.ok(Core.matchesExercise(bench, { patterns: ['Hinge', 'Horizontal Push'] }));
  assert.ok(Core.matchesExercise(bench, { equip: ['Cable', 'Barbell'] }));
});

test('filterExercises: muscle chip refines to that muscle; empty query = alphabetical; All = everything', () => {
  const chest = Core.filterExercises(DUCK_EXERCISES, { muscle: 'Chest' });
  assert.ok(chest.length > 0);
  assert.ok(chest.every(e => e.muscles.includes('Chest')));
  const names = chest.map(e => e.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'no-query browse is deterministic alphabetical');
  assert.equal(Core.filterExercises(DUCK_EXERCISES, { muscle: 'All' }).length, DUCK_EXERCISES.length);
  assert.equal(Core.filterExercises(DUCK_EXERCISES, {}).length, DUCK_EXERCISES.length);
});

test('searchScore + ranking: name-prefix > name-substring > tag-only', () => {
  const prefix = { name: 'Row Machine', muscles: ['Back'], patterns: [], equip: [], family: '' };
  const sub = { name: 'Barbell Row', muscles: ['Back'], patterns: [], equip: [], family: '' };
  const tag = { name: 'Deadlift', muscles: ['Back'], patterns: [], equip: [], family: 'Row' };
  assert.equal(Core.searchScore(prefix, 'row'), 3);
  assert.equal(Core.searchScore(sub, 'row'), 2);
  assert.equal(Core.searchScore(tag, 'row'), 1);
  assert.equal(Core.searchScore(prefix, ''), 0);
  const ordered = Core.filterExercises([tag, sub, prefix], { query: 'row' }).map(e => e.name);
  assert.deepEqual(ordered, ['Row Machine', 'Barbell Row', 'Deadlift']);
});

test('custom exercises (no tags) match All + muscle + search, and never crash a facet filter', () => {
  const custom = { id: 'c1', name: 'Landmine Press', muscle: 'Shoulders', equipment: 'Landmine', custom: true };
  assert.ok(Core.matchesExercise(custom, { muscle: 'All' }));
  assert.ok(Core.matchesExercise(custom, { muscle: 'Shoulders' }));
  assert.ok(!Core.matchesExercise(custom, { muscle: 'Legs' }));
  assert.ok(Core.matchesExercise(custom, { query: 'landmine' }), 'query matches equipment string');
  assert.ok(Core.matchesExercise(custom, { query: 'shoulders' }), 'query matches muscle');
  assert.doesNotThrow(() => Core.matchesExercise(custom, { patterns: ['Hinge'], equip: ['Cable'], families: ['Row'] }));
  assert.equal(Core.matchesExercise(custom, { patterns: ['Hinge'] }), false, 'untagged custom simply drops out of a pattern filter');
  const list = Core.filterExercises([...DUCK_EXERCISES, custom], { muscle: 'All', query: 'landmine' });
  assert.deepEqual(list.map(e => e.id), ['c1']);
});

test('quickPicks: favourites first, then distinct recents, deduped, capped, known-only', () => {
  const history = [
    { exercises: [{ exerciseId: 'ba1' }, { exerciseId: 'ch1' }] }, // most recent session first
    { exercises: [{ exerciseId: 'ch1' }, { exerciseId: 'ba2' }] }
  ];
  const favs = ['ch3', 'ba1'];
  const isKnown = id => id !== 'ghost';
  assert.deepEqual(Core.quickPicks(favs, history, isKnown, 8), ['ch3', 'ba1', 'ch1', 'ba2']);
  assert.deepEqual(Core.quickPicks(favs, history, isKnown, 2), ['ch3', 'ba1'], 'cap trims to N');
  assert.ok(!Core.quickPicks(['ghost'], history, isKnown, 8).includes('ghost'), 'unknown ids dropped');
  assert.deepEqual(Core.quickPicks([], [], isKnown, 8), [], 'empty inputs hide the strip');
});

test('favourites survive a validateBackup round-trip', () => {
  const backup = { version: 2, routines: [], history: [], customExercises: [], activeSession: null, favourites: ['ch1', 'ba1'], preferences: {} };
  const restored = Core.validateBackup(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(restored.favourites, ['ch1', 'ba1']);
  const noFav = Core.validateBackup({ version: 2, routines: [], history: [], customExercises: [], activeSession: null, preferences: {} });
  assert.deepEqual(noFav.favourites, [], 'older backups without favourites default to empty');
  const dirty = Core.validateBackup({ version: 2, routines: [], history: [], customExercises: [], activeSession: null, favourites: ['ch1', 5, null, 'ba2'], preferences: {} });
  assert.deepEqual(dirty.favourites, ['ch1', 'ba2'], 'non-string entries are dropped');
});
