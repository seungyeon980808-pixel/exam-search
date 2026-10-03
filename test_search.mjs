import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { catalogFiles, parseTokens, prepareQuestions, searchFiles, searchQuestions, fileQuestions } from './search.mjs';

const [index, fileMeta, synonyms] = await Promise.all(['questions', 'files', 'synonyms']
  .map(async (name) => JSON.parse(await readFile(new URL(`./data/${name}.json`, import.meta.url), 'utf8'))));
const questions = prepareQuestions(index.items, synonyms.map || {});
const files = catalogFiles(fileMeta.map((file) => file.pdfFile), questions);

test('file conversion includes every indexed question beyond search pagination', () => {
  const name = '수학_2026_11_영역통합_74e7e4a61455.pdf';
  const items = fileQuestions(questions, name);
  assert.equal(items.length, 92);
  assert.equal(new Set(items.map((item) => item.id)).size, 92);
  assert.ok(items.every((item) => item.pdfFile === name));
  assert.deepEqual(fileQuestions(questions, name, 1), items.filter((item) => item.page === 1));
  assert.deepEqual(fileQuestions(questions, name, 999), []);
  assert.deepEqual(fileQuestions(questions, 'missing.pdf'), []);
});

test('file conversion preserves science page and question order without mutation', () => {
  const input = [...questions].reverse();
  const before = input.map((item) => item.id);
  const items = fileQuestions(input, 'p1_2027_06.pdf');
  assert.equal(items.length, 20);
  assert.deepEqual(items.map((item) => item.no), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(fileQuestions(input, 'p1_2027_06.pdf', 1).length, 6);
  assert.deepEqual(input.map((item) => item.id), before);
});

test('three words must occur in the same question', () => {
  const hits = searchQuestions(questions, '빛 간섭 경로차');
  assert.equal(hits.length, 6);
  assert.ok(hits.every((item) => ['빛', '간섭', '경로차']
    .every((word) => item._hay.includes(word) || item._hayNs.includes(word))));
});

test('file mode groups matching questions into exam papers', () => {
  const hits = searchFiles(files, questions, '빛 간섭 경로차');
  assert.equal(hits.length, 6);
  assert.ok(hits.every((item) => item.matchedCount > 0 && item.firstMatchPage > 0));
});

test('more than three words is rejected', () => {
  assert.throws(() => parseTokens('하나 둘 셋 넷'), RangeError);
});
