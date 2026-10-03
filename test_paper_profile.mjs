import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { searchQuestions, searchFiles, catalogFiles, fileQuestions } from './search.mjs';
import { paperPages, paperReady } from './paper-profile.mjs';

const questions = JSON.parse(await readFile(new URL('./data/questions.json', import.meta.url))).items;
const files = catalogFiles(JSON.parse(await readFile(new URL('./data/files.json', import.meta.url))), questions);
for (const [subject, tracks, count] of [['math', ['probability_statistics', 'calculus', 'geometry'], 30],
  ['kor', ['hwajak', 'eonmae'], 45]]) {
  for (const track of tracks) for (const variant of ['odd', 'even']) {
    test(`${subject} ${track} ${variant}: exactly one complete 2026 paper in search and file export`, () => {
      const filters = { group: subject, yearFrom: 2026, yearTo: 2026, month: 11, track, variant };
      const items = searchQuestions(questions, '', filters);
      assert.equal(items.length, count);
      assert.equal(new Set(items.map((item) => item.no)).size, count);
      assert.ok(items.every((item) => item.variant === variant && ['common', track].includes(item.track)));
      const [file] = searchFiles(files, questions, '', filters);
      assert.equal(file.questionCount, count);
      assert.equal(file.matchedCount, count);
      assert.deepEqual(new Set(fileQuestions(questions, file.pdfFile, null, filters).map((item) => item.id)), new Set(items.map((item) => item.id)));
      assert.equal(paperReady(items, filters), true);
      const pages = paperPages(fileQuestions(questions, file.pdfFile), items);
      assert.ok(items.every((item) => pages.includes(item.page)));
      assert.ok(fileQuestions(questions, file.pdfFile).filter((item) => pages.includes(item.page))
        .every((item) => item.variant === variant && ['common', track].includes(item.track)));
    });
  }
}
test('unselected electives show common questions and require a selection for a complete paper', () => {
  const items = searchQuestions(questions, '', { group: 'math', yearFrom: 2026, yearTo: 2026, month: 11 });
  assert.equal(items.length, 22);
  assert.equal(paperReady(items), false);
});
test('all profiles is explicit, and legacy ga/na plus split PDFs keep their original identities', () => {
  assert.equal(searchQuestions(questions, '', { group: 'math', yearFrom: 2026, yearTo: 2026, month: 11, allProfiles: '1' }).length, 92);
  for (const track of ['ga', 'na']) {
    const filters = { group: 'math', yearFrom: 2021, yearTo: 2021, month: 11, track, variant: 'even' };
    const items = searchQuestions(questions, '', filters);
    assert.equal(items.length, 30);
    assert.equal(searchFiles(files, questions, '', filters).length, 1);
    assert.ok(items.every((item) => item.track === track && item.variant === 'even'));
  }
  assert.equal(searchQuestions(questions, '', { group: 'kor', yearFrom: 2021, yearTo: 2021, month: 11, variant: 'odd' }).length, 45);
  const filters = { group: 'math', yearFrom: 2025, yearTo: 2025, month: 11, track: 'geometry', variant: 'even' };
  assert.equal(searchFiles(files, questions, '', filters).length, 1);
  assert.equal(searchQuestions(questions, '', filters).length, 30);
});
test('a search token narrows matches without narrowing the whole paper conversion', () => {
  const filters = { group: 'math', yearFrom: 2026, yearTo: 2026, month: 11, track: 'calculus', variant: 'odd' };
  const [file] = searchFiles(files, questions, '함수', filters);
  assert.ok(file.matchedCount < 30 && file.matchedCount > 0);
  assert.equal(fileQuestions(questions, file.pdfFile, null, filters).length, 30);
});
