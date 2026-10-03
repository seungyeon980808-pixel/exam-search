import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createPreparedHwpx, createCollectionHwpx, readQuestionTargets, paragraphsForPrepared, documentSegments, logicalLines, groupFractions, equationScript } from './editable-convert.mjs';
import { restoreFigures, questionFigures } from './figure-fallback.mjs';
import { buildLiveStructure } from './live-convert.mjs';
import { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';
import { sectionXml, documentScripts, documentText, inlineContent } from './test-hwpx-content.mjs';

function assertLeft(doc) {
  for (let page = 0; page < doc.pageCount(); page += 1) {
    const info = JSON.parse(doc.getPageInfo(page));
    assert.equal(info.columns.length, 2);
    const right = info.columns[0].x + info.columns[0].width;
    for (const control of JSON.parse(doc.getPageControlLayout(page)).controls) {
      assert.ok(control.x + control.w <= right + 1, `page ${page}: ${JSON.stringify(control)}`);
      assert.ok(control.y + control.h <= info.footerArea.y + 1, `page ${page} footer: ${JSON.stringify(control)}`);
    }
  }
  const rightStart = JSON.parse(doc.getPageInfo(0)).columns[1].x;
  for (let para = 0; para < doc.getParagraphCount(0); para += 1) {
    for (const line of logicalLines(doc, para)) {
      const offset = line.charStart === 0 ? 0 : Math.min(line.charStart + 1, line.charEnd);
      assert.ok(JSON.parse(doc.getCursorRect(0, para, offset)).x < rightStart - 1);
    }
  }
}
test('fraction-heavy physics reopens with two columns, a narrow 보기, and preserved native equations', async () => {
  const prepared = JSON.parse(await readFile(new URL('./data/editable/prepared/p1_2027_06_18.json', import.meta.url)));
  const bytes = await createPreparedHwpx(prepared);
  assert.match(sectionXml(bytes), /colCount="2"/u);
  assert.equal(documentScripts(bytes).length, 16);
  const doc = new HwpDocument(bytes);
  try {
    assertLeft(doc);
    const definition = JSON.parse(doc.getPageDef(0));
    assert.equal(definition.marginLeft, 2835);
    assert.equal(definition.marginRight, 2835);
    assert.equal(definition.marginTop, 3402);
    assert.equal(definition.marginBottom, 3402);
    assert.equal(definition.marginHeader + definition.marginFooter, 0);
    const page = JSON.parse(doc.getPageInfo(0));
    assert.ok(Math.abs(page.columns[0].width / 96 * 25.4 - 92) < .1);
    const table = JSON.parse(doc.getControls()).find((item) => item.ctrlId === 'tbl');
    assert.ok(table);
    const geometry = Array.from({ length: doc.pageCount() }, (_, index) => JSON.parse(doc.getPageControlLayout(index)).controls)
      .flat().find((item) => item.type === 'table');
    assert.ok(geometry.w <= page.columns[0].width);
    assert.match(documentText(bytes), /<보기>/u);
  } finally { doc.free(); }
});

test('question bookmarks retain their identity after pagination, insertion and saving', async () => {
  const paragraphs = [[{ kind: 'text', value: '문항 본문입니다. '.repeat(250) }],
    ...[...'①②③④⑤'].map((value) => [{ kind: 'text', value }])];
  const bytes = await createCollectionHwpx(['first', 'second'].map((questionId) => ({ questionId,
    sourceLabel: `출처 ${questionId}`, paragraphs })));
  const before = await readQuestionTargets(bytes);
  assert.ok(before.second.paragraph > before.first.paragraph);
  const doc = new HwpDocument(bytes);
  try {
    assert.equal(JSON.parse(doc.getCharShapeSet(0, before.first.paragraph, 0)).Height, 800);
    assert.equal(JSON.parse(doc.getCharShapeSet(0, before.first.paragraph + 1, 0)).Height, 1000);
    assert.equal(JSON.parse(doc.insertParagraph(0, 2)).ok, true);
    assert.equal(JSON.parse(doc.insertText(0, 2, 0, '사용자가 추가한 문단')).ok, true);
    const after = await readQuestionTargets(doc.exportHwpx());
    assert.equal(after.second.paragraph, before.second.paragraph + 1);
    assert.equal(after.first.paragraph, before.first.paragraph);
    assert.equal(after.second.length, doc.getParagraphLength(0, after.second.paragraph));
    assert.match(doc.getTextRange(0, after.second.paragraph, 0, after.second.length), /출처 second/u);
  } finally { doc.free(); }
});

const pixel = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrXcAAAAASUVORK5CYII=', 'base64'));
test('보기 continuation lines reflow as claims without modifying the prepared source or dropping equations', () => {
  const paragraphs = ['<보기>', 'ㄱ. 에너지가', '증가한다.', 'ㄴ. 속력은', '같다.', 'ㄷ. 주기는', '짧다.', '① ㄱ']
    .map((value) => [{ kind: 'text', value }]);
  paragraphs[4].unshift({ kind: 'equation', script: 'v^{2}' });
  const original = structuredClone(paragraphs);
  const box = documentSegments(paragraphs).find((segment) => segment.kind === 'box');
  assert.equal(box.rows.length, 3);
  assert.equal(box.rows[0].map((run) => run.value || '').join(''), 'ㄱ. 에너지가 증가한다.');
  assert.equal(box.rows.flat().filter((run) => run.kind === 'equation').length, 1);
  assert.deepEqual(paragraphs, original);
});
test('figure-only fallback coexists with editable body, equations, 보기 and choices after HWPX reopening', async () => {
  const prepared = JSON.parse(await readFile(new URL('./data/editable/prepared/p1_2027_06_18.json', import.meta.url)));
  const paragraphs = paragraphsForPrepared(prepared);
  paragraphs.splice(1, 0, [{ kind: 'figure', image: { bytes: pixel, width: 120, height: 80 }, scale: 2 }]);
  const bytes = await createCollectionHwpx([{ questionId: 'hybrid', sourceLabel: '그림만 이미지', paragraphs }]);
  assert.equal(documentScripts(bytes).length, 16);
  assert.match(documentText(bytes), /<보기>/u);
  const doc = new HwpDocument(bytes);
  try {
    assertLeft(doc);
    const controls = JSON.parse(doc.getControls());
    assert.equal(controls.filter((c) => c.ctrlId === 'tbl').length, 2); // 보기 + compact choices
    const images = controls.filter((c) => c.ctrlId === 'gso');
    assert.equal(images.length, 1);
    assert.equal(Array.from({ length: doc.pageCount() }, (_, page) => JSON.parse(doc.getPageControlLayout(page)).controls)
      .flat().filter((control) => control.type === 'image').length, 1);
    const c = images[0];
    const props = JSON.parse(doc.getPictureProperties(c.list, c.para, c.controlIndex));
    assert.equal(props.treatAsChar, true);
    assert.equal(props.width / props.height, 1.5);
    assert.deepEqual(doc.getControlImageData(c.list, c.para, '', c.controlIndex), pixel);
    assert.deepEqual(Object.keys(await readQuestionTargets(bytes)), ['hybrid']);
  } finally { doc.free(); }
});
test('only drawing boxes are cropped; text and choices stay native, with cancellation and full-question rejection', async () => {
  const source = { id: 'one', pdfFile: 'paper.pdf', page: 1, box: [0, 0, 200, 400] };
  const prepared = { blocks: [{ role: 'stem', runs: [{ kind: 'text', value: '본문' }] },
    { role: 'ask', runs: [{ kind: 'text', value: '질문' }] }],
    figureFallbacks: [{ box: [100, 30, 180, 100], afterBlock: 0 }] };
  const calls = [];
  const deps = { renderFigure: async (item) => { calls.push(item.displayBox); return { bytes: pixel, width: 160, height: 140 }; } };
  const hybrid = await restoreFigures(source, prepared, deps);
  assert.deepEqual(calls, [[100, 30, 180, 100]]);
  assert.equal(hybrid.blocks[0].runs[0].value, '본문');
  assert.equal(hybrid.blocks[1].kind, 'figure');
  assert.equal(hybrid.blocks[2].runs[0].value, '질문');
  assert.equal(prepared.blocks.length, 2);
  await assert.rejects(restoreFigures(source, { ...prepared, figureFallbacks: [{ box: source.box }] }, deps), /문항 전체/u);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(restoreFigures(source, prepared, { ...deps, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 1);
  const pdf = { pageHeight: 400, content: { items: [] } };
  assert.equal(questionFigures(source, pdf, [{ box: source.box, ink: source.box, labels: [], labelBoxes: [] }]).length, 0);
});
test('wide sums and adjacent formulas fit a saved column without changing their scripts', async () => {
  const { fixtures } = JSON.parse(await readFile(new URL('./test-fixtures/live-formulas.json', import.meta.url)));
  const selected = fixtures.filter((item) => ['2026_11_math_common_odd_02', '2026_11_math_common_odd_20'].includes(item.question.id));
  assert.equal(selected.length, 2);
  const items = selected.map(({ question, pdf, glyphMap }) => ({ question,
    paragraphs: paragraphsForPrepared(buildLiveStructure(question, pdf, new Map(glyphMap))), sourceLabel: question.id }));
  const bytes = await createCollectionHwpx(items);
  assert.equal(documentScripts(bytes).length, items.flatMap((item) => item.paragraphs.flat()).filter((run) => run.kind === 'equation').length);
  const doc = new HwpDocument(bytes);
  try { assertLeft(doc); } finally { doc.free(); }
});
test('long text and successive questions continue on following left columns after saving', async () => {
  const text = '내용 보존과 다음 쪽 왼쪽 단의 줄바꿈을 확인합니다. '.repeat(180);
  const source = { schema: 'exam-editable-v1', status: 'needs_review', number: 1,
    blocks: [{ role: 'stem', runs: [{ kind: 'text', value: text }] },
      ...[...'①②③④⑤'].map((label) => ({ role: 'choice', label, runs: [{ kind: 'text', value: '선지' }] }))] };
  const paragraphs = paragraphsForPrepared(source);
  const bytes = await createCollectionHwpx([1, 2].map((no) => ({ paragraphs, sourceLabel: `출처 ${no}`, question: {} })));
  const doc = new HwpDocument(bytes);
  try {
    assert.ok(doc.pageCount() > 2);
    assertLeft(doc);
    assert.equal((documentText(bytes).replace(/\s+/gu, '').match(/내용보존과/gu) || []).length, 360);
  } finally { doc.free(); }
});

test('a full physics paper has no stranded middle pages after equation fitting and HWPX reopening', async () => {
  const { items } = JSON.parse(await readFile(new URL('./test-fixtures/pagination-physics.json', import.meta.url)));
  const bytes = await createCollectionHwpx(items);
  const contentRuns = (paragraphs) => paragraphs.flat().flatMap((run) => run.kind === 'table' ? run.table.rows.flat(2) : [run]);
  const runs = items.flatMap((item) => contentRuns(item.paragraphs));
  assert.deepEqual(documentScripts(bytes), runs.filter((run) => run.kind === 'equation')
    .map((run) => groupFractions(equationScript(run.script))));
  const expectedText = items.map((item) => item.sourceLabel + contentRuns(item.paragraphs)
    .filter((run) => run.kind === 'text').map((run) => run.value).join('')).join('');
  assert.equal(documentText(bytes).replace(/\s/gu, ''), expectedText.replace(/\s/gu, ''));
  const expectedInline = items.map((item) => item.sourceLabel + contentRuns(item.paragraphs)
    .map((run) => run.kind === 'text' ? run.value : `[${groupFractions(equationScript(run.script))}]`).join('')).join('');
  assert.equal(inlineContent(bytes).replace(/\s/gu, ''), expectedInline.replace(/\s/gu, ''));
  assert.equal((sectionXml(bytes).match(/<hp:tbl\b/gu) || []).length, 40); // 20 보기 + 20 choice tables
  assert.equal(Object.keys(await readQuestionTargets(bytes)).length, 20);
  const doc = new HwpDocument(bytes);
  try {
    // The regression produced 20 pages, including many with only one sentence.
    assert.ok(doc.pageCount() <= 11, `${doc.pageCount()} pages`);
    assertLeft(doc);
    for (let page = 0; page < doc.pageCount() - 1; page += 1) {
      const rows = new Set(JSON.parse(doc.getPageTextLayout(page)).runs
        .filter((run) => run.parentParaIdx === undefined && run.text.trim())
        .map((run) => `${run.paraIdx}:${run.y}`));
      assert.ok(rows.size >= 5, `page ${page + 1} has only ${rows.size} text rows`);
    }
  } finally { doc.free(); }
});

test('an overlong 보기 falls back to paragraphs without losing its text or equation', async () => {
  const source = { schema: 'exam-editable-v1', status: 'needs_review', number: 1, blocks: [
    { role: 'stem', runs: [{ kind: 'text', value: '긴 보기를 읽으시오.' }] },
    { role: 'bogi', label: 'ㄱ', runs: [{ kind: 'text', value: '모든 내용을 보존합니다. '.repeat(220) }, { kind: 'equation', script: 'x^{2}' }] },
    ...[...'①②③④⑤'].map((label) => ({ role: 'choice', label, runs: [{ kind: 'text', value: '선지' }] })),
  ] };
  const bytes = await createPreparedHwpx(source);
  assert.equal((sectionXml(bytes).match(/<hp:tbl\b/gu) || []).length, 1); // only the compact choice table survives
  assert.equal((documentText(bytes).replace(/\s+/gu, '').match(/모든내용을보존합니다/gu) || []).length, 220);
  assert.deepEqual(documentScripts(bytes), ['x^{2}']);
  const doc = new HwpDocument(bytes);
  try { assertLeft(doc); } finally { doc.free(); }
});

test('a drawing crop excludes prose and keeps adjacent panels together', () => {
  const question = { page: 1, box: [0, 0, 200, 400] };
  const region = (box) => ({ box, ink: box, kind: 'vector', labels: [], labelBoxes: [] });
  const pdf = { pageHeight: 400, content: { items: [] } };
  assert.deepEqual(questionFigures(question, pdf, [region([10, 40, 65, 90]), region([70, 40, 125, 90])])
    .map(f => f.box), [[8, 38, 127, 92]]);
  pdf.content.items.push({ str: '이것은 그림이 아니라 복원되어야 하는 문제의 본문입니다.', width: 80,
    height: 10, transform: [10, 0, 0, 10, 15, 340] });
  assert.deepEqual(questionFigures(question, pdf, [region([10, 40, 125, 90])]), []);
});
test('continued-page figure crops map back to the actual source page and coordinates', () => {
  const question = { page: 1, box: [0, 0, 200, 800] };
  const box = [20, 540, 100, 600];
  const pdf = { pageHeight: 800, content: { items: [] },
    figureSourceRegions: [{ page: 2, flowBox: [0, 500, 200, 750], sourceBox: [10, 0, 210, 250], dx: -10, dy: 500 }] };
  const figures = questionFigures(question, pdf, [{ box, ink: box, kind: 'image', labels: [], labelBoxes: [] }]);
  assert.equal(figures.length, 1);
  assert.equal(figures[0].page, 2);
  assert.deepEqual(figures[0].box, [28, 38, 112, 102]);
  assert.deepEqual(figures[0].flowBox, [18, 538, 102, 602]);
});

test('optional question pages start each caption on a distinct left-column page and preserve content', async () => {
  const prepared = JSON.parse(await readFile(new URL('./data/editable/prepared/p1_2027_06_06.json', import.meta.url)));
  const items = [1, 2, 3].map((n) => ({ questionId: `layout-${n}`, sourceLabel: `문항 ${n}`, question: { no: 6 }, paragraphs: paragraphsForPrepared(prepared) }));
  const continuous = await createCollectionHwpx(items);
  const separated = await createCollectionHwpx(items, { pagePerQuestion: true });
  assert.equal(inlineContent(separated), inlineContent(continuous));
  const doc = new HwpDocument(separated);
  try {
    assertLeft(doc);
    const bookmarks = JSON.parse(doc.getBookmarks()).sort((a, b) => a.para - b.para);
    const pages = bookmarks.map((mark) => JSON.parse(doc.getCursorRect(mark.sec, mark.para, 0)).pageIndex);
    assert.equal(pages.length, 3);
    assert.equal(pages[0], 0);
    assert.ok(pages[1] > pages[0] && pages[2] > pages[1], JSON.stringify(pages));
  } finally { doc.free(); }
});

test('standalone question pages repeat a shared passage while continuous layout deduplicates it', async () => {
  const prepared = JSON.parse(await readFile(new URL('./data/editable/prepared/p1_2027_06_06.json', import.meta.url)));
  const items = [1, 2].map((n) => ({ questionId: `shared-${n}`, question: { no: 6 }, passageKey: 'same', questionParagraphStart: 2,
    paragraphs: [[{ kind: 'text', value: '공통 지문 검증 문장' }], [], ...paragraphsForPrepared(prepared)] }));
  const continuous = documentText(await createCollectionHwpx(items));
  const separate = documentText(await createCollectionHwpx(items, { pagePerQuestion: true }));
  assert.equal(continuous.split('공통 지문 검증 문장').length - 1, 1);
  assert.equal(separate.split('공통 지문 검증 문장').length - 1, 2);
});

test('question page mode allows a long question to continue without losing text before the next question', async () => {
  const text = '긴 문항은 글씨를 줄이지 않고 다음 페이지로 이어집니다. '.repeat(100);
  const source = { schema: 'exam-editable-v1', status: 'needs_review', number: 1,
    blocks: [{ role: 'stem', runs: [{ kind: 'text', value: text }] },
      ...[...'①②③④⑤'].map((label) => ({ role: 'choice', label, runs: [{ kind: 'text', value: '선지' }] }))] };
  const short = { ...source, blocks: [{ role: 'stem', runs: [{ kind: 'text', value: '짧은 다음 문항입니다.' }] }, ...source.blocks.slice(1)] };
  const items = [source, short].map((prepared, n) => ({ questionId: `long-page-${n}`, paragraphs: paragraphsForPrepared(prepared) }));
  const bytes = await createCollectionHwpx(items, { pagePerQuestion: true });
  assert.ok(documentText(bytes).replace(/\s/gu, '').includes(text.replace(/\s/gu, '')));
  const doc = new HwpDocument(bytes);
  try {
    assertLeft(doc);
    const marks = JSON.parse(doc.getBookmarks()).sort((a, b) => a.para - b.para);
    const second = JSON.parse(doc.getCursorRect(marks[1].sec, marks[1].para, 0));
    assert.ok(second.pageIndex >= 2, JSON.stringify(second));
    assert.equal(second.pageIndex, doc.pageCount() - 1);
  } finally { doc.free(); }
});
