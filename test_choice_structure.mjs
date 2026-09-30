import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLiveStructure } from './live-convert.mjs';
import { preparedParagraphs, resolveEditableContent } from './editable-source.mjs';
import { createCollectionHwpx, validateQuestionParagraphs } from './editable-convert.mjs';
import { hasEmptyChoice, recoverQuestionRegion } from './question-region.mjs';
import { inlineContent } from './test-hwpx-content.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const text = (structure) => structure.blocks.map((block) => (block.label || '') + block.runs.map((run) => run.value || run.script).join('')).join('\n');
function convert(rows, extra = {}) {
  const question = { id: 'choice-fixture', no: 1, page: 1, box: [0, 0, 400, 800], responseType: 'multiple_choice',
    text: rows.map((row) => row[2]).join('\n'), ...extra };
  const pdf = { pageHeight: 800, pageWidth: 800, fonts: { f: { name: 'HYSinMyeongJo' } }, glyphs: [],
    content: { items: rows.map(([x, top, str]) => ({ str, transform: [11, 0, 0, 11, x, 800 - top], width: str.length * 5, height: 11, fontName: 'f' })) } };
  return buildLiveStructure(question, pdf, new Map());
}
const choices = [[20, 40, '① 첫 문장이다.'], [20, 60, '② 둘 문장이다.'], [20, 80, '③ 셋 문장이다.'], [20, 100, '④ 넷 문장이다.'], [20, 120, '⑤ 마지막 문장은']];

test('keeps the fifth choice continuation present in the index', () => {
  const rows = [[10, 20, '1. 적절한 것은?'], ...choices, [32, 138, '다음 줄까지 이어진다.']];
  const result = convert(rows);
  assert.equal(result.blocks.at(-1).runs.map((run) => run.value).join(''), ' 마지막 문장은 다음 줄까지 이어진다.');
});

test('rejects unrelated nearby text after the fifth choice', () => {
  const rows = [[10, 20, '1. 적절한 것은?'], ...choices, [32, 138, '다른 그림의 설명이다.'], [10, 160, '2. 다른 문제이다.']];
  const result = convert(rows, { text: rows.slice(0, 6).map((row) => row[2]).join('\n') });
  assert.doesNotMatch(text(result), /다른 그림|다른 문제/u);
});

test('does not append a printed paper footer even when the index includes it', () => {
  const result = convert([[10, 20, '1. 적절한 것은?'], ...choices, [32, 138, '2권 중 2권']]);
  assert.doesNotMatch(text(result), /2권/u);
});

test('retains inline English markers and all following passage text', () => {
  const rows = [[10, 20, '1. 적절하지 않은 것은?'], [20, 40, 'A sentence before ①the first marker'], [20, 60, 'continues with ②another word.'],
    [20, 80, 'Then comes ③one more marker'], [20, 100, 'and the sentence ④continues'], [20, 120, 'until we reach ⑤the final marker'], [20, 140, 'The passage still continues after it.']];
  const result = convert(rows, { subject: 'eng' });
  assert.equal(result.inlineChoices, true);
  assert.deepEqual(text(result).match(/[①②③④⑤]/gu), [...'①②③④⑤']);
  assert.ok(text(result).endsWith('The passage still continues after it.'));
});

test('PDF storage order does not turn ordinary English choices into inline markers', () => {
  const rows = [[10, 20, '1. 대화의 응답으로 적절한 것은?']];
  for (const [i, label] of [...'①②③④⑤'].entries()) {
    rows.push([35, 50 + i * 25, `A complete answer sentence ${i + 1}.`], [20, 50 + i * 25, label]);
  }
  const result = convert(rows, { subject: 'eng' });
  assert.notEqual(result.inlineChoices, true);
  assert.deepEqual(result.blocks.filter((block) => block.role === 'choice').map((block) => block.label), [...'①②③④⑤']);
});

test('allocates both lines to a vertically centered table choice', () => {
  const rows = [[10, 20, '1. 알맞은 예를 고르시오.']];
  for (const [i, label] of [...'①②③④⑤'].entries()) rows.push([42, 50 + i * 38, `${i + 1}번 위 문장이다.`], [20, 58 + i * 38, label], [42, 66 + i * 38, `${i + 1}번 아래 문장이다.`]);
  const result = convert(rows, { subject: 'kor' });
  assert.deepEqual(result.blocks.filter((block) => block.role === 'choice').map((block) => block.runs.map((run) => run.value).join('').trim()),
    Array.from({ length: 5 }, (_, i) => `${i + 1}번 위 문장이다. ${i + 1}번 아래 문장이다.`));
});

test('keeps numbered lists and range headers inside a stem', () => {
  const result = convert([[10, 5, '1. 다음 내용을 읽고 답하시오.'], [10, 15, '2. 두 번째 목록 항목이다.'],
    [10, 25, '[2～3] 이 범위도 본문에 속한다.'], ...choices]);
  assert.match(text(result), /2\. 두 번째 목록 항목이다\./u);
  assert.match(text(result), /\[2～3\] 이 범위도 본문에 속한다\./u);
});

test('a numbered passage line after inline marker five is not another question', () => {
  const result = convert([[10, 20, '1. 적절하지 않은 것은?'], [10, 40, 'A sentence with ①one and ②two,'],
    [10, 60, 'followed by ③three and ④four,'], [10, 80, 'and finally ⑤five.'],
    [10, 100, '2. A numbered list inside the same passage.']], { subject: 'eng' });
  assert.match(text(result), /2\. A numbered list inside the same passage\./u);
});

test('inline choices survive prepared validation, region recovery and collection export', async () => {
  const rows = [[10, 20, '1. 적절하지 않은 것은?'], [20, 40, 'A sentence with ①one and ②two,'],
    [20, 60, 'followed by ③three and ④four,'], [20, 80, 'and finally ⑤five.'], [20, 100, 'The final sentence must remain.']];
  const prepared = convert(rows, { subject: 'eng', pdfFile: 'fixture.pdf' });
  const question = { id: 'choice-fixture', no: 1, page: 1, pdfFile: 'fixture.pdf', subject: 'eng' };
  const paragraphs = preparedParagraphs(question, prepared);
  assert.doesNotThrow(() => validateQuestionParagraphs(paragraphs, { inlineChoices: true }));
  const primary = await recoverQuestionRegion(question, {}, async () => prepared, { build() { assert.fail('valid inline choices must not be retried'); } });
  assert.equal(primary, prepared);
  for (const provenance of ['pdf', 'prepared']) {
    const resolved = await resolveEditableContent(question, { entries: async () => provenance === 'prepared'
      ? { [question.id]: { status: 'needs_review', source: 'fixture.json' } } : {},
    convert: async () => prepared, readPrepared: async () => prepared });
    assert.equal(resolved.question.inlineChoices, true);
    const bytes = await createCollectionHwpx([resolved]);
    const saved = inlineContent(bytes);
    assert.deepEqual(saved.match(/[①②③④⑤]/gu), [...'①②③④⑤']);
    assert.ok(saved.includes('The final sentence must remain.'));
    const evidence = process.env.EVIDENCE_DIR || '.omo/evidence/choice-structure';
    await mkdir(evidence, { recursive: true });
    await writeFile(`${evidence}/inline-${provenance}-collection.hwpx`, bytes);
    await writeFile(`${evidence}/inline-${provenance}-collection.txt`, saved);
  }
});

test('inline validation refuses missing, duplicate and out-of-order markers', () => {
  for (const value of ['①②③④', '①②③④⑤⑤', '①③②④⑤']) {
    assert.throws(() => validateQuestionParagraphs([[{ kind: 'text', value: `A sentence with ${value} choices.` }]], { inlineChoices: true }), /선지/u);
    assert.equal(hasEmptyChoice({ inlineChoices: true, blocks: [{ role: 'stem', runs: [{ kind: 'text', value }] }] }), true);
  }
});

test('inline passage rejoins glossary baselines only when the index confirms their order', () => {
  const rows = [[10, 20, '1. 적절하지 않은 것은?'], [20, 40, 'A sentence with ①one and ②two,'],
    [20, 60, 'followed by ③three and ④four,'], [20, 80, 'and finally ⑤five.'],
    [100, 100, 'word:뜻'], [90, 103, '* '], [10, 130, '2. 다음 문제이다.']];
  const result = convert(rows, { subject: 'eng', text: '1. 적절하지 않은 것은? A sentence with ①one and ②two, followed by ③three and ④four, and finally ⑤five. * word:뜻' });
  assert.match(text(result), /\* word:뜻$/u);
  assert.doesNotMatch(text(result), /다음 문제/u);
});

test('a shared passage may contain its own markers before inline question markers', async () => {
  const questionText = '1. Choose the answer. A passage with ①one ②two ③three ④four ⑤five. Final words.';
  const sharedText = 'Shared text mentions ①another marker.';
  const q = { id: 'shared-inline', no: 1, page: 1, pdfFile: 'shared.pdf', subject: 'eng', box: [0, 0, 180, 400],
    passageRegions: [{ page: 1, box: [200, 0, 400, 400] }], questionText, text: `${sharedText}\n${questionText}` };
  const prepared = { schema: 'exam-editable-v1', status: 'needs_review', questionId: q.id, number: q.no,
    sourcePdf: q.pdfFile, page: q.page, inlineChoices: true,
    blocks: [{ role: 'stem', runs: [{ kind: 'text', value: questionText.replace(/^1\. /u, '') }] }] };
  const resolved = await resolveEditableContent(q, { entries: async () => ({}), convert: async () => prepared,
    readQuestionPdf: async () => ({ content: { items: [] } }), glyphMap: async () => new Map(),
    build: () => ({ blocks: [{ role: 'stem', runs: [{ kind: 'text', value: sharedText }] }] }) });
  assert.ok(resolved.paragraphs[0][0].value.includes(sharedText));
  const bytes = await createCollectionHwpx([resolved]);
  const saved = inlineContent(bytes);
  assert.ok(saved.includes(sharedText));
  assert.ok(saved.includes('Final words.'));
  assert.equal((saved.match(/①/gu) || []).length, 2);
});

test('region recovery extends a nonempty fifth choice cut by the indexed box', async () => {
  const rows = [[10, 20, '1. 다음 중 적절한 것은?'], ...choices, [32, 138, '다음 줄까지 이어진다.'], [10, 175, '2. 다음 문제이다.']];
  const question = { id: 'q1', no: 1, page: 1, box: [0, 0, 400, 126], subject: 'kor',
    questionText: rows.slice(0, -1).map((row) => row[2]).join('\n') };
  const pdf = { pageHeight: 800, pageWidth: 800, fonts: { f: { name: 'HYSinMyeongJo' } }, glyphs: [],
    content: { items: rows.map(([x, top, str]) => ({ str, transform: [11, 0, 0, 11, x, 800 - top], width: str.length * 5, height: 11, fontName: 'f' })) } };
  const result = await recoverQuestionRegion(question, pdf, async () => buildLiveStructure(question, pdf, new Map()),
    { build: buildLiveStructure, glyphMap: async () => new Map() });
  assert.ok(text(result).endsWith('다음 줄까지 이어진다.'));
  assert.doesNotMatch(text(result), /다음 문제/u);
});
