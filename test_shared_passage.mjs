import assert from 'node:assert/strict';
import test from 'node:test';
import { passageBlocks, sharedPassageRegions } from './shared-passage.mjs';
import { resolveEditableContent } from './editable-source.mjs';
import { createCollectionHwpx, validateQuestionParagraphs } from './editable-convert.mjs';
import { inlineContent } from './test-hwpx-content.mjs';

const header = '[1～2] 다음 글을 읽고 물음에 답하시오.';
const questionText = '1. 적절한 것은?\n① 가 ② 나 ③ 다 ④ 라 ⑤ 마';
const question = (lines) => ({ id: 'shared', no: 1, page: 1, pdfFile: 'test.pdf',
  box: [200, 0, 400, 400], passageRegions: [{ page: 1, box: [0, 0, 180, 400] }],
  questionText, text: [...lines, questionText].join('\n') });
const pdf = (lines) => ({ pageHeight: 500, fonts: { text: { name: 'Plain' }, math: { name: 'HyhwpEQ' } },
  content: { items: lines.map((str, index) => ({ str, fontName: 'text', height: 12,
    width: 150, transform: [12, 0, 0, 12, 10, 480 - index * 20] })) } });
const deps = (lines) => ({ readQuestionPdf: async () => pdf(lines), glyphMap: async () => new Map(), notes: [] });
const plain = (block) => block.runs.map((run) => run.value || run.script).join('');
const prepared = { schema: 'exam-editable-v1', status: 'needs_review', questionId: 'shared', number: 1,
  sourcePdf: 'test.pdf', page: 1, blocks: [{ role: 'stem', runs: [{ kind: 'text', value: '적절한 것은?' }] },
    ...[...'①②③④⑤'].map((label) => ({ role: 'choice', label, runs: [{ kind: 'text', value: '답' }] }))] };

test('shared regions omit the question itself and duplicate regions', () => {
  const q = question([]);
  q.passageRegions.push(q.passageRegions[0], { page: q.page, box: q.box });
  assert.equal(sharedPassageRegions(q).length, 1);
});
test('passage keeps printed header, numbering and all inline choice markers', async () => {
  const lines = [header, '1. 지문 첫 문장', '① 첫째 ② 둘째 ③ 셋째 ④ 넷째 ⑤ 다섯째', '마지막 문장'];
  const blocks = await passageBlocks(question(lines), deps(lines));
  assert.equal(plain(blocks[0]), header);
  assert.ok(blocks.every((block) => block.role === 'passage' && !/^[①②③④⑤]/u.test(plain(block))));
  assert.equal(blocks.map(plain).join(' '), `${header} 1. 지문 첫 문장 ① 첫째 ② 둘째 ③ 셋째 ④ 넷째 ⑤ 다섯째 마지막 문장`);
});
test('unknown text from another question rejects the entire passage', async () => {
  const options = deps([header, '공통 지문', '다른 문항의 내용']);
  const blocks = await passageBlocks(question([header, '공통 지문']), options);
  assert.deepEqual(blocks, []);
  assert.equal(options.notes.length, 1);
});
test('copyright footer is removed before index comparison', async () => {
  const blocks = await passageBlocks(question([header, '공통 지문']), deps([header, '공통 지문', '이 문제지에 관한 저작권은 한국교육과정평가원에 있습니다.']));
  assert.deepEqual(blocks.map(plain), [header, '공통 지문']);
});
test('multiple passage pages are read in indexed order', async () => {
  const q = question([header, '첫 페이지', '둘째 페이지']);
  q.passageRegions.push({ page: 2, box: [0, 0, 180, 400] });
  const options = deps([]);
  options.readQuestionPdf = async (item) => pdf(item.page === 1 ? [header, '첫 페이지'] : ['둘째 페이지']);
  assert.deepEqual((await passageBlocks(q, options)).map(plain), [header, '첫 페이지', '둘째 페이지']);
});
test('passage preserves native editable equation runs', async () => {
  const options = deps([]);
  options.readQuestionPdf = async () => {
    const data = pdf([header, '값은', '이다']);
    data.content.items[2].transform = [12, 0, 0, 12, 80, 460];
    data.content.items[1].width = 30;
    data.content.items.push({ str: '\uE001', fontName: 'math', height: 12, width: 10,
      transform: [12, 0, 0, 12, 50, 460] });
    return data;
  };
  options.glyphMap = async () => new Map([['math:57345', 'x']]);
  const blocks = await passageBlocks(question([header, '값은\uE001이다']), options);
  assert.equal(blocks.flatMap((block) => block.runs).find((run) => run.kind === 'equation')?.script, 'x');
});
test('resolved document places passage before blank and question without duplicate choices', async () => {
  const lines = [header, '① 첫째 ② 둘째 ③ 셋째 ④ 넷째 ⑤ 다섯째', '마지막 문장'];
  const result = await resolveEditableContent(question(lines), { ...deps(lines), entries: async () => ({}), convert: async () => prepared });
  assert.match(result.paragraphs[0][0].value, /^\[1/u);
  const stem = result.paragraphs.findIndex((runs) => runs[0]?.value === '1. ');
  assert.ok(stem > 1);
  assert.deepEqual(result.paragraphs[stem - 1], []);
  validateQuestionParagraphs(result.paragraphs, question(lines));
});
test('index fallback adds passage only once and retains question choice validation', async () => {
  const lines = [header, '공통 지문'];
  const result = await resolveEditableContent(question(lines), { ...deps(lines), entries: async () => ({}),
    convert: async () => { throw new Error('offline'); } });
  assert.equal(result.provenance, 'index-draft');
  assert.equal(result.paragraphs.flat().filter((run) => run.value === header).length, 1);
  validateQuestionParagraphs(result.paragraphs, question(lines));
});
test('aborted passage extraction propagates cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(passageBlocks(question([header]), { ...deps([header]), signal: controller.signal }), { name: 'AbortError' });
});
test('one [n～m] set extracts its passage once and a collection prints it once', async () => {
  const lines = [header, '공통 지문 첫 문장', '공통 지문 끝 문장'];
  let reads = 0;
  const shared = { ...deps(lines), entries: async () => ({}), readQuestionPdf: async () => { reads += 1; return pdf(lines); } };
  const secondText = '2. 옳은 것은?\n① 가 ② 나 ③ 다 ④ 라 ⑤ 마';
  const second = { ...question(lines), id: 'shared-2', no: 2, questionText: secondText, text: [...lines, secondText].join('\n') };
  const first = await resolveEditableContent(question(lines), { ...shared, convert: async () => prepared });
  const next = await resolveEditableContent(second, { ...shared,
    convert: async () => ({ ...structuredClone(prepared), questionId: 'shared-2', number: 2 }) });
  assert.equal(reads, 1);
  assert.equal(first.passageKey, next.passageKey);
  assert.deepEqual(first.paragraphs.slice(0, first.questionParagraphStart), next.paragraphs.slice(0, next.questionParagraphStart));
  const inline = inlineContent(await createCollectionHwpx([first, next]));
  assert.equal(inline.split('공통 지문 첫 문장').length - 1, 1);
  // Label of the first question, then the passage, then both questions.
  assert.ok(inline.indexOf('test.pdf 1번') < inline.indexOf('공통 지문 첫 문장'));
  assert.ok(inline.indexOf('공통 지문 끝 문장') < inline.indexOf('test.pdf 2번'));
  for (const label of '①②③④⑤') assert.equal(inline.split(label).length - 1, 2);
});
test('a failed passage download is retried by the next question of the set', async () => {
  const lines = [header, '공통 지문'];
  let reads = 0;
  const options = { ...deps(lines), readQuestionPdf: async () => {
    reads += 1;
    if (reads === 1) throw new Error('network');
    return pdf(lines);
  } };
  assert.deepEqual(await passageBlocks(question(lines), { ...options, notes: [] }), []);
  assert.deepEqual((await passageBlocks(question(lines), { ...options, notes: [] })).map(plain), lines);
  assert.equal(reads, 2);
});
