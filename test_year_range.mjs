import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readYearRange, writeYearRange, validYearRange, yearRangeLabel, includesYear } from './year-range.mjs';
import { curriculumOptions, listFiles } from './catalog-filters.mjs';

test('range addresses restore legacy links, open bounds and explicit bounds without legacy contamination', () => {
  assert.deepEqual(readYearRange(new URLSearchParams('year=2025')), { from: '2025', to: '2025' });
  assert.deepEqual(readYearRange(new URLSearchParams('yearFrom=2020&yearTo=2025')), { from: '2020', to: '2025' });
  assert.deepEqual(readYearRange(new URLSearchParams('year=2025&yearFrom=2020')), { from: '2020', to: '' });
  assert.deepEqual(readYearRange(new URLSearchParams('yearTo=2024')), { from: '', to: '2024' });
  assert.deepEqual(readYearRange(new URLSearchParams('yearFrom=2025&yearTo=2020')), { from: '2020', to: '2025' });
  assert.deepEqual(readYearRange(new URLSearchParams('yearFrom=invalid&yearTo=2024')), { from: '', to: '2024' });
});

test('committed ranges round-trip without stale single-year parameters, including clearing', () => {
  const params = new URLSearchParams('year=2025&subject=p1');
  const range = { from: '2020', to: '2025' };
  writeYearRange(params, range);
  assert(!params.has('year')); assert.equal(params.get('subject'), 'p1');
  assert.deepEqual(readYearRange(params), range);
  writeYearRange(params, { from: '', to: '' });
  assert.deepEqual([...params.keys()], ['subject']);
});

test('draft validation rejects reversed bounds, and labels and inclusion handle open and single years', () => {
  assert(!validYearRange({ from: '2025', to: '2020' }));
  assert(!validYearRange({ from: 'bad', to: '' }));
  for (const r of [{from:'',to:''}, {from:'2025',to:''}, {from:'',to:'2025'}, {from:'2025',to:'2025'}]) assert(validYearRange(r));
  assert.equal(yearRangeLabel({from:'2020',to:'2025'}), '2020–2025');
  assert.equal(yearRangeLabel({from:'2025',to:'2025'}), '2025학년도');
  assert.equal(yearRangeLabel({from:'',to:''}), '전체 연도');
  assert(includesYear(2025, {from:'2020',to:'2025'})); assert(!includesYear(2026, {from:'2020',to:'2025'}));
});

test('curriculum facets and files use the same inclusive year bounds on actual catalog data', () => {
  const catalog = JSON.parse(readFileSync(new URL('./data/catalog.json', import.meta.url)));
  for (const subject of ['p1', 'c1', 'b1', 'e1', 'math', 'kor']) {
    for (const [from, to] of [[2024, 2025], [2021, 2026], [2025, 2025]]) {
      const filters = {subject, yearFrom:from, yearTo:to};
      const expected = curriculumOptions({...catalog, facets:catalog.facets.filter(f=>f.year>=from&&f.year<=to)}, {subject});
      assert.deepEqual(curriculumOptions(catalog, filters), expected);
      assert(listFiles(catalog, filters).every(f=>f.year>=from&&f.year<=to));
      if (from === to) assert.deepEqual(curriculumOptions(catalog, filters), curriculumOptions(catalog, {subject, year:from}));
    }
  }
});
