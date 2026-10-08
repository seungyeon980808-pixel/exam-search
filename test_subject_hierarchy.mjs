import {createCatalogMetadata} from './catalog-metadata.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogFiles, prepareQuestions, searchFiles, searchQuestions, subjectGroup } from './search.mjs';

const questions = prepareQuestions([
  ['p1', '물리학Ⅰ'], ['c1', '화학Ⅰ'], ['kor', '국어'], ['eng', '영어'], ['math', '수학'],
  ['life_ethics', '생활과 윤리'], ['world_history', '세계사'],
].map(([subject, subjectLabel], index) => ({
  id: `question-${index}`, subject, subjectLabel, year: 2026, month: 6, no: 1,
  page: 1, pdfFile: `exam-${index}.pdf`, text: '공통 검색어',
})));
const files = catalogFiles(questions.map(({ pdfFile }) => ({ pdfFile })), questions);

test('top-level subject grouping preserves science and social detail subjects', () => {
  assert.deepEqual(questions.map(({ subject }) => subjectGroup(subject).value),
    ['science', 'science', 'kor', 'eng', 'math', 'social', 'social']);
  assert.equal(subjectGroup('future_subject').value, 'other');
  assert.deepEqual(searchQuestions(questions, '공통', { group: 'science' }).map(({ subject }) => subject), ['p1', 'c1']);
  assert.deepEqual(searchQuestions(questions, '공통', { group: 'social', subject: 'world_history' })
    .map(({ subject }) => subject), ['world_history']);
  assert.equal(searchQuestions(questions, '', { group: 'eng' })[0].subject, 'eng');
  assert.equal(searchQuestions(questions, '', { group: 'science', subject: 'life_ethics' }).length, 0);
});

test('file view applies the same two-level filters', () => {
  assert.equal(searchFiles(files, questions, '', { group: 'social' }).length, 2);
  assert.deepEqual(searchFiles(files, questions, '공통', { group: 'science', subject: 'p1' })
    .map(({ subject }) => subject), ['p1']);
  assert.equal(searchFiles(files, questions, '', { group: 'math' })[0].subject, 'math');
});

test('status reports only available top-level groups in a stable order', () => {
  const status = createCatalogMetadata({pdfCount:files.length,questionCount:questions.length,items:questions}).status;
  assert.deepEqual(status.groups.map(({ value }) => value), ['kor', 'eng', 'math', 'science', 'social']);
  assert.deepEqual(status.subjects.filter(({ group }) => group === 'social')
    .map(({ value }) => value).sort(), ['life_ethics', 'world_history']);
  assert.equal(searchQuestions(questions, '', {group:'science',subject:'p1'}).length, 1);
  assert.equal(searchFiles(files, questions, '', {group:'social',subject:'life_ethics'}).length, 1);
});
