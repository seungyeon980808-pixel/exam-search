import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLiveStructure } from './live-convert.mjs';
import { columnLines, continuationRegion, indexOpening, joinRegions, NOTES, ownRegion, PLACEHOLDER,
  recoverQuestionRegion, SPLIT_FAILURE } from './question-region.mjs';

// Minimal pdf.js-like pages: text items carry str/transform/width/height/fontName. Fixture rows are
// given as [x, top, text] in top-left points; transforms use the bottom-left origin like pdf.js.
const H = 1000;
const W = 800;
const item = (x, top, str) => ({ str, transform: [11, 0, 0, 11, x, H - top], width: str.length * 6, height: 11, fontName: 'f1' });
const page = (rows, extra = {}) => ({ content: { items: rows.map(([x, top, str]) => item(x, top, str)) },
  fonts: { f1: { name: 'ABCDEF+HYSinMyeongJo' } }, glyphs: [], pageHeight: H, pageWidth: W, ...extra });
const deps = (pages = {}) => ({ build: buildLiveStructure, glyphMap: async () => new Map(),
  readPage: async (number) => { if (!pages[number]) throw new Error('no page'); return pages[number]; } });
const primary = (question, pdf) => async () => buildLiveStructure(question, pdf, new Map());
const text = (structure) => structure.blocks.map((block) => (block.label ? block.label + ' ' : '')
  + block.runs.map((run) => run.value ?? run.script).join('')).join('\n');
const choiceTexts = (structure) => structure.blocks.filter((block) => block.role === 'choice')
  .map((block) => block.runs.map((run) => run.value ?? run.script).join('').trim());

test('a question at the left column bottom continues at the top of the right column', async () => {
  const pdf = page([
    [40, 700, '5. 윗글의 내용과 일치하는 것은?'],
    [50, 730, '① 첫째 선지이다.'],
    [50, 760, '② 둘째 선지이다.'],
    [300, 980, '이 문제지에 관한 저작권은 한국교육과정평가원에 있습니다.'],
    [440, 100, '③ 셋째 선지이다.'],
    [440, 130, '④ 넷째 선지이다.'],
    [440, 160, '⑤ 다섯째 선지이다.'],
    [430, 220, '6. 다음 문항의 내용이다.'],
    [440, 250, '① 다른 문항의 선지'],
  ]);
  const question = { id: 'q5', no: 5, page: 1, box: [30, 690, 400, 900], responseType: 'multiple_choice',
    text: '5. 윗글의 내용과 일치하는 것은?\n① 첫째 선지이다.' };
  await assert.rejects(primary(question, pdf)(), { message: SPLIT_FAILURE });
  const structure = await recoverQuestionRegion(question, pdf, primary(question, pdf), deps());
  assert.deepEqual(choiceTexts(structure), ['첫째 선지이다.', '둘째 선지이다.', '셋째 선지이다.', '넷째 선지이다.', '다섯째 선지이다.']);
  assert.ok(structure.notes.includes(NOTES.continued));
  assert.doesNotMatch(text(structure), /다른 문항|6\.|저작권/u);
});

test('a question at the right column bottom continues on the next page, below the running head', async () => {
  const first = page([
    [440, 800, '12. 윗글에 대한 이해로 적절한 것은?'],
    [450, 830, '① 하나'],
    [450, 860, '② 둘'],
  ]);
  const next = page([
    [380, 40, '3'],
    [100, 45, '국어 영역'],
    [50, 100, '③ 셋'],
    [50, 130, '④ 넷'],
    [50, 160, '⑤ 다섯'],
    [40, 200, '[13～15] 다음 글을 읽고 물음에 답하시오.'],
    [50, 230, '① 다음 지문의 표시'],
  ]);
  next.content.items[1].height = 25;
  const question = { id: 'q12', no: 12, page: 4, box: [421, 790, 800, 900], responseType: 'multiple_choice',
    text: '12. 윗글에 대한 이해로 적절한 것은?' };
  const structure = await recoverQuestionRegion(question, first, primary(question, first), deps({ 5: next }));
  assert.deepEqual(choiceTexts(structure), ['하나', '둘', '셋', '넷', '다섯']);
  assert.doesNotMatch(text(structure), /국어 영역|13～15|다음 지문/u);
});

test('continuation stops at a set header and never borrows another question', async () => {
  const pdf = page([
    [40, 800, '7. 다음 설명으로 옳은 것은?'],
    [50, 830, '① 가'],
    [430, 100, '[8～10] 다음을 읽고 물음에 답하시오.'],
    [440, 130, '② 다른 지문'],
    [440, 160, '③ 다른 지문'],
    [440, 190, '④ 다른 지문'],
    [440, 220, '⑤ 다른 지문'],
  ]);
  const question = { id: 'q7', no: 7, page: 1, box: [30, 790, 400, 900], responseType: 'multiple_choice', text: '7. 다음 설명으로 옳은 것은?' };
  await assert.rejects(recoverQuestionRegion(question, pdf, primary(question, pdf), deps()), { message: SPLIT_FAILURE });
});

test('an index box that stops before the choices is extended to the next printed number', async () => {
  const pdf = page([
    [430, 100, '15. 이에 대한 설명으로 옳은 것만을 고른 것은?'],
    [440, 130, '그림 설명 문장이다.'],
    [440, 200, 'ㄱ. 가 이다.'],
    [440, 230, 'ㄴ. 나 이다.'],
    [440, 260, '① ㄱ ② ㄴ ③ ㄷ ④ ㄱ, ㄴ ⑤ ㄴ, ㄷ'],
    [430, 320, '16. 다음 문항이다.'],
    [440, 350, '① 다음 문항 선지'],
  ]);
  const question = { id: 'q15', no: 15, page: 3, box: [421, 90, 800, 150], responseType: 'multiple_choice',
    text: '15. 이에 대한 설명으로 옳은 것만을 고른 것은?' };
  const structure = await recoverQuestionRegion(question, pdf, primary(question, pdf), deps());
  assert.deepEqual(choiceTexts(structure), ['ㄱ', 'ㄴ', 'ㄷ', 'ㄱ, ㄴ', 'ㄴ, ㄷ']);
  assert.ok(structure.notes.includes(NOTES.extended));
  assert.doesNotMatch(text(structure), /다음 문항/u);
});

// A raster image drawn over the question area, as KICE prints listening pictures and memo cards.
const withPicture = (pdf, [x0, top0, x1, top1]) => ({ ...pdf, OPS: { save: 10, restore: 11, transform: 12, paintImageXObject: 85 },
  operations: { fnArray: [10, 12, 85, 11], argsArray: [null, [x1 - x0, 0, 0, top1 - top0, x0, H - top1], ['img'], null] } });

test('choices printed only inside a picture become five placeholders after the stem', async () => {
  const pdf = withPicture(page([
    [40, 700, '4. 대화를 듣고, 그림에서 대화의 내용과 일치하지 않는 것을 고르시오.'],
    [40, 950, '5. 다음 문항이다.'],
  ]), [60, 720, 380, 930]);
  const question = { id: 'q4', no: 4, page: 1, box: [30, 690, 400, 940], responseType: 'unknown',
    text: '4. 대화를 듣고, 그림에서 대화의 내용과 일치하지 않는 것을 고르시오.' };
  const structure = await recoverQuestionRegion(question, pdf, primary(question, pdf), deps());
  assert.deepEqual(choiceTexts(structure), Array(5).fill(PLACEHOLDER));
  assert.equal(structure.blocks[0].role, 'stem');
  assert.ok(structure.notes.includes(NOTES.picture));
});

test('no placeholders without a picture, or when the index text has choice markers', async () => {
  const bare = page([
    [40, 700, '4. 대화를 듣고, 그림에서 대화의 내용과 일치하지 않는 것을 고르시오.'],
    [40, 950, '5. 다음 문항이다.'],
  ]);
  const question = { id: 'q4', no: 4, page: 1, box: [30, 690, 400, 940], responseType: 'unknown',
    text: '4. 대화를 듣고, 그림에서 대화의 내용과 일치하지 않는 것을 고르시오.' };
  await assert.rejects(recoverQuestionRegion(question, bare, primary(question, bare), deps()), { message: SPLIT_FAILURE });
  const pictured = withPicture(bare, [60, 720, 380, 930]);
  const listed = { ...question, text: question.text + '\n① 가 ② 나' };
  await assert.rejects(recoverQuestionRegion(listed, pictured, primary(listed, pictured), deps()), { message: SPLIT_FAILURE });
  // A stem whose Hangul was lost in the text layer (only Latin letters and brackets left) is refused.
  const unreadable = withPicture(page([
    [40, 700, '4. ( ) v 0 h A B V 0. ( ) V A B L. A B m, k. (ㄱ), (ㄴ)? (, g, , A, B.)'],
    [40, 950, '5. 다음 문항이다.'],
  ]), [60, 720, 380, 930]);
  // The index holds the same unreadable text, so only the Hangul rule can refuse it.
  const lost = { ...question, text: '4. ( ) v 0 h A B V 0. ( ) V A B L.' };
  await assert.rejects(recoverQuestionRegion(lost, unreadable, primary(lost, unreadable), deps()), { message: SPLIT_FAILURE });
});

test('the recovered stem must open with the words the index records for the question', async () => {
  const pdf = page([
    [430, 100, '15. 이에 대한 설명으로 옳은 것만을 고른 것은?'],
    [440, 260, '① ㄱ ② ㄴ ③ ㄷ ④ ㄱ, ㄴ ⑤ ㄴ, ㄷ'],
    [430, 320, '16. 다음 문항이다.'],
  ]);
  const question = { id: 'q15', no: 15, page: 3, box: [421, 90, 800, 150], responseType: 'multiple_choice',
    text: '15. 전혀 다른 문항의 발문이다.' };
  await assert.rejects(recoverQuestionRegion(question, pdf, primary(question, pdf), deps()), { message: SPLIT_FAILURE });
  // The shared passage before the number is skipped; the first six letters of the question are kept.
  assert.equal(indexOpening({ no: 9, text: '[8～10] 공유 지문\n9. 다음은 [A]를 보완하기 위해' }), '다음은A를보');
});

test('complete results and unrelated errors pass through untouched', async () => {
  const pdf = page([[40, 100, '1. 가']]);
  const done = { blocks: [{ role: 'stem', runs: [{ kind: 'text', value: '가' }] }], notes: [] };
  assert.equal(await recoverQuestionRegion({ no: 1 }, pdf, async () => done, deps()), done);
  await assert.rejects(recoverQuestionRegion({ no: 1 }, pdf, async () => { throw new Error('수식 구조를 확인할 수 없습니다.'); }, deps()),
    { message: '수식 구조를 확인할 수 없습니다.' });
});

test('regions are read per column and joined in reading order', () => {
  const pdf = page([[40, 900, '3. 앞'], [440, 100, '뒤']]);
  assert.deepEqual(columnLines(pdf, [0, 400]).map((line) => line.text), ['3. 앞']);
  const own = ownRegion({ no: 3, box: [30, 890, 400, 960] }, pdf);
  assert.equal(own.lines.length, 1);
  const joined = joinRegions(pdf, own.box, pdf, [421, 90, 800, 110], -400);
  const tops = joined.pdf.content.items.map((entry) => H - entry.transform[5]);
  assert.ok(tops[1] > tops[0], 'the continuation sits below the first region');
  assert.ok(joined.pdf.content.items.every((entry) => entry.transform[4] < 400));
});

test('continuationRegion returns null when the next column opens a new question', async () => {
  const pdf = page([[40, 900, '3. 앞'], [430, 100, '4. 다음 문항']]);
  assert.equal(await continuationRegion({ page: 1 }, pdf, [0, 400], async () => null), null);
});
