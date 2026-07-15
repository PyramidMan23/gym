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
