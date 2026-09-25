import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { catalogFiles, parseTokens, prepareQuestions, searchFiles, searchQuestions } from './search.mjs';

const [index, fileMeta, synonyms] = await Promise.all(['questions', 'files', 'synonyms']
  .map(async (name) => JSON.parse(await readFile(new URL(`./data/${name}.json`, import.meta.url), 'utf8'))));
const questions = prepareQuestions(index.items, synonyms.map || {});
const files = catalogFiles(fileMeta.map((file) => file.pdfFile), questions);

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
