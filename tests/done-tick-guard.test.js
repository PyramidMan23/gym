// Done-tick guard (Ty, 2026-08-17). His leg day saved as "60 kg × 0" on six exercises: the reps
// cell's grey placeholder (last session's reps) reads as a filled value, the ✓ accepted the empty
// field, and carry-forward copied the empty reps down every following set. These gates pin the rule
// that a completing tick with no reps is intercepted, and that the wiring in app.js consults it
// BEFORE the done flag flips.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core.js');

const set = (weight = '', reps = '', done = false) => ({ weight, reps, done });

test('a completing tick with no reps is blocked, whatever the weight says', () => {
  assert.equal(Core.blockDoneTick(set('60', '')), true, 'weight typed, reps empty - the Ty case');
  assert.equal(Core.blockDoneTick(set('60', '0')), true, 'an explicit zero still adds nothing');
  assert.equal(Core.blockDoneTick(set('', '')), true, 'blank-blank tick was silently meaningless before');
  assert.equal(Core.blockDoneTick(set('', '12')), false, 'bodyweight reps complete normally');
  assert.equal(Core.blockDoneTick(set('60', '8')), false, 'a fully logged set completes normally');
});

test('un-completing is never blocked - the guard only gates the done direction', () => {
  assert.equal(Core.blockDoneTick(set('60', '', true)), false);
  assert.equal(Core.blockDoneTick(set('', '', true)), false);
});

test('carry-forward can no longer be fed an empty-reps done set through the tick', () => {
  // The propagation half of the bug: one bad tick seeded every following set. With the guard, a
  // done set always carries reps > 0, so the prefill it seeds does too.
  const blocked = set('60', '');
  if (!Core.blockDoneTick(blocked)) blocked.done = true; // the app's exact decision
  const exercise = { sets: [blocked, set()] };
  assert.equal(Core.carryForward(exercise, 1), null, 'an unticked set must not seed the next one');
});

test('app.js consults the guard before the done flag flips', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const body = source.match(/function toggleSet\(exerciseIndex,setIndex\)\{[\s\S]*?\n\}/)[0];
  const guardAt = body.indexOf('Core.blockDoneTick(set)');
  const flipAt = body.indexOf('set.done=!set.done');
  assert.ok(guardAt > -1, 'toggleSet must call Core.blockDoneTick');
  assert.ok(flipAt > guardAt, 'the guard must run BEFORE set.done flips');
  assert.match(body.slice(guardAt, flipAt), /openPad\(exerciseIndex,setIndex,'reps'\)[\s\S]*?return;/,
    'a blocked tick must open the reps pad and bail out');
});
