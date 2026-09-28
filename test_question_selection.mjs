import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionSelection } from './question-selection.mjs';

test('selection preserves insertion order and never duplicates IDs', () => {
  const selection = createQuestionSelection(['a', 'a', '', null, 'b']);
  assert.deepEqual(selection.snapshot(), ['a', 'b']);
  assert.equal(selection.toggle('c'), true);
  assert.equal(selection.toggle('a'), false);
  assert.equal(selection.toggle('a'), true);
  assert.deepEqual(selection.snapshot(), ['b', 'c', 'a']);
  assert.equal(selection.has('a'), true);
  assert.equal(selection.toggle(' '), false);
});

test('moving a selected item one step preserves every other item and guards boundaries', () => {
  const selection = createQuestionSelection(['a', 'b', 'c']);
  assert.equal(selection.move('b', -1), true);
  assert.deepEqual(selection.snapshot(), ['b', 'a', 'c']);
  assert.equal(selection.move('a', 1), true);
  assert.deepEqual(selection.snapshot(), ['b', 'c', 'a']);
  for (const [id, direction] of [['b', -1], ['a', 1], ['missing', 1], ['c', 2]]) {
    assert.equal(selection.move(id, direction), false);
    assert.deepEqual(selection.snapshot(), ['b', 'c', 'a']);
  }
});

test('snapshots are independent from future selection changes and caller mutation', () => {
  const initial = ['a', 'b', 'c'];
  const selection = createQuestionSelection(initial);
  initial.push('d');
  const opening = selection.snapshot();
  selection.remove('b');
  selection.move('c', -1);
  assert.deepEqual(opening, ['a', 'b', 'c']);
  opening.push('injected');
  assert.deepEqual(selection.snapshot(), ['c', 'a']);
  selection.remove('missing');
  selection.clear();
  assert.deepEqual(selection.snapshot(), []);
  assert.equal(selection.has('a'), false);
});
