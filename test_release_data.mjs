import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { driveLink } from './drive-source.mjs';
import { prepareQuestions, searchQuestions, subjectGroup } from './search.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`./data/${name}.json`, import.meta.url), 'utf8'));

test('published index covers five groups without exposing candidate answers', () => {
  const index = read('questions');
  const files = read('files');
  const answers = read('answers');
  const synonyms = read('synonyms');
  assert.equal(index.questionCount, 19760);
  assert.equal(index.pdfCount, 822);
  assert.equal(index.items.length, index.questionCount);
  assert.equal(files.length, index.pdfCount);
  assert.equal(new Set(index.items.map((item) => item.id)).size, index.questionCount);
  assert.equal(answers.items.length, 0);

  const counts = Object.fromEntries(Object.entries(Object.groupBy(index.items,
    (item) => subjectGroup(item.subject).value)).map(([group, items]) => [group, items.length]));
  assert.deepEqual(counts, { science: 8420, kor: 2020, eng: 1800, math: 2120, social: 5400 });
  const newer = index.items.slice(8420);
  assert.equal(newer.filter((item) => !item.text).length, 734);
  assert(newer.every((item) => item.needsReview && item.answer === null));
  assert(newer.every((item) => !item.curriculum || item.curriculum.reviewStatus === 'verified'));
  assert.equal(newer.filter((item) => item.curriculum).length, 456);
  assert.deepEqual(index.incomplete.filter((issue) => issue.reason === 'new_candidates_unverified'),
    [{ reason: 'new_candidates_unverified', questionCount: 11340, unreadableQuestionCount: 734 }]);
  assert.equal(files.filter((file) => file.publicPath.startsWith('기출문제/기출확장_국영수사탐/')).length, 401);
  assert(files.every((file) => driveLink(file.publicPath).startsWith('https://')));
  const prepared = prepareQuestions(index.items, synonyms.map || {});
  assert(searchQuestions(prepared, '동형이의어 문맥 의미', { subject: 'kor' }).length > 0);
  assert.equal(searchQuestions(prepared, '빛 간섭 경로차', { subject: 'p2' }).length, 6);
});
