const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const L = ['a', 'b', 'c', 'd', 'e'];
const order = (from, to) => Core.moveExercise(L, from, to).list.join('');
const track = (from, to, tracked) => Core.moveExercise(L, from, to, tracked).tracked;

test('moveExercise splices (never swaps) when dragging down', () => {
  assert.equal(order(0, 3), 'bcdae');
  assert.equal(order(1, 4), 'acdeb');
  assert.equal(order(0, 1), 'bacde'); // adjacent: move and swap agree, which is why the ... menu can share this
});

test('moveExercise splices when dragging up', () => {
  assert.equal(order(3, 0), 'dabce');
  assert.equal(order(4, 2), 'abecd');
  assert.equal(order(2, 1), 'acbde');
});

test('moveExercise leaves the list alone for a no-op or an out-of-range index', () => {
  for (const [from, to] of [[2, 2], [-1, 2], [2, -1], [5, 0], [0, 5], [0.5, 2]]) {
    const out = Core.moveExercise(L, from, to, 3);
    assert.deepEqual(out.list, L, `${from} -> ${to} must not reorder`);
    assert.equal(out.tracked, 3, `${from} -> ${to} must not move the tracked index`);
  }
  assert.deepEqual(Core.moveExercise(undefined, 0, 1).list, []);
});

test('moveExercise returns a copy, never the caller array', () => {
  const source = L.slice();
  const out = Core.moveExercise(source, 0, 2).list;
  assert.notEqual(out, source);
  assert.deepEqual(source, L, 'the input list must be untouched');
});

// The tracked index is the running rest timer's exercise. Every case below is checked against the
// element it names, so a wrong remap (rest-end progressing the wrong row) fails loudly.
test('tracked index follows its own exercise across a downward move', () => {
  assert.equal(track(1, 3, 1), 3, 'the moved exercise itself');
  assert.equal(track(1, 3, 2), 1, 'an exercise the move steps over shifts up');
  assert.equal(track(1, 3, 3), 2, 'the landing exercise shifts up');
  assert.equal(track(1, 3, 0), 0, 'before the move, untouched');
  assert.equal(track(1, 3, 4), 4, 'after the move, untouched');
});

test('tracked index follows its own exercise across an upward move', () => {
  assert.equal(track(3, 1, 3), 1);
  assert.equal(track(3, 1, 2), 3);
  assert.equal(track(3, 1, 1), 2);
  assert.equal(track(3, 1, 0), 0);
  assert.equal(track(3, 1, 4), 4);
});

test('tracked index survives the ends and the no-rest sentinel', () => {
  assert.equal(track(0, 4, 0), 4, 'first to last');
  assert.equal(track(0, 4, 4), 3);
  assert.equal(track(4, 0, 4), 0, 'last to first');
  assert.equal(track(4, 0, 0), 1);
  assert.equal(track(0, 4, -1), -1, 'no tracked index stays no tracked index');
  assert.equal(Core.moveExercise(L, 0, 4).tracked, -1, 'tracked defaults to none');
});

test('tracked index maps the same way the DOM order does, for every from/to pair', () => {
  // Brute force: after the move, the tracked index must point at the SAME element it pointed at before.
  for (let from = 0; from < L.length; from++) {
    for (let to = 0; to < L.length; to++) {
      for (let tracked = 0; tracked < L.length; tracked++) {
        const out = Core.moveExercise(L, from, to, tracked);
        assert.equal(out.list[out.tracked], L[tracked], `from ${from} to ${to} lost track of ${L[tracked]}`);
      }
    }
  }
});
