import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryPreferences, normalizeSelection } from './library-preferences.mjs';

const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
test('ordered selection survives a new session, with independent snapshots', () => {
  const storage = memory(), first = createLibraryPreferences(storage);
  const items = [{ id: 'p1_2025_11_02', label: '물리학Ⅰ 2번' }, { id: 'p1_2025_11_01', label: '물리학Ⅰ 1번' }];
  assert(first.saveSelection(items));
  const next = createLibraryPreferences(storage);
  assert.deepEqual(next.selection(), items);
  next.selection().pop();
  assert.deepEqual(next.selection(), items);
  next.saveSelection([]);
  assert.deepEqual(first.selection(), []);
});
test('corrupt, incompatible and unbounded saved state cannot poison the selection', () => {
  assert.deepEqual(normalizeSelection({ version: 2, items: [{ id: 'valid' }] }), []);
  const items = [null, { id: '../../image' }, { id: 'p1_2025_11_01', label: 'x'.repeat(1000) }, { id: 'p1_2025_11_01' }];
  const clean = normalizeSelection({ version: 1, items });
  assert.equal(clean.length, 1); assert.equal(clean[0].label.length, 160);
  assert.equal(normalizeSelection({ version: 1, items: Array.from({ length: 501 }, (_, n) => ({ id: `q${n}` })) }).length, 500);
  const storage = memory(); storage.setItem('exam-library-selection-v1', '{bad json');
  assert.deepEqual(createLibraryPreferences(storage).selection(), []);
});
test('storage denial leaves a usable in-memory workflow and reports failure', () => {
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const prefs = createLibraryPreferences(denied);
  assert.deepEqual(prefs.selection(), []);
  assert.equal(prefs.saveSelection([{ id: 'p1_2025_11_01' }]), false);
  assert.doesNotThrow(() => prefs.rememberSearch('p1', ['전자기파']));
});
test('recent search suggestions stay within the selected subject and avoid duplicates', () => {
  const prefs = createLibraryPreferences(memory());
  prefs.rememberSearch('p1', ['전자기파']); prefs.rememberSearch('b1', ['유전']);
  prefs.rememberSearch('p1', ['파동']); prefs.rememberSearch('p1', ['전자기파']);
  assert.deepEqual(prefs.searches('p1').map(row => row.words), [['전자기파'], ['파동']]);
  assert.deepEqual(prefs.searches('b1').map(row => row.words), [['유전']]);
  prefs.rememberSearch('p1', ['a','b','c','d']);
  assert.equal(prefs.searches('p1').length, 2);
});
