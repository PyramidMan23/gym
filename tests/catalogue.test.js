// Referential integrity for the equipment catalogue + templates + plans.
// exercises.js is plain global consts (loaded via <script> in the browser),
// so eval it in a sandboxed function scope and pull the three arrays out.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
const PATTERN_VOCAB = new Set(['Horizontal Push', 'Vertical Push', 'Horizontal Pull', 'Vertical Pull', 'Squat', 'Hinge', 'Lunge', 'Carry', 'Anti-Rotation', 'Isolation', 'Olympic', 'Conditioning', 'Mobility']);
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
