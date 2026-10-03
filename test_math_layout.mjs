import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createPreparedHwpx, createCollectionHwpx, paragraphsForPrepared, readQuestionTargets, equationScript, groupFractions } from './editable-convert.mjs';
import { equationLineCollisions } from './equation-spacing.mjs';
import { buildLiveStructure } from './live-convert.mjs';
import { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';
import { documentScripts, documentText } from './test-hwpx-content.mjs';

const { fixtures } = JSON.parse(readFileSync(new URL('./test-fixtures/math-layout-2021.json', import.meta.url)));
mkdirSync('.omo/evidence/1003-math-layout', { recursive: true });
const normalized = (script) => groupFractions(equationScript(script));
const sourceScripts = (prepared) => prepared.blocks.flatMap((b) => b.runs).filter((r) => r.kind === 'equation').map((r) => normalized(r.script));

function assertSavedLayout(document) {
  assert.deepEqual(equationLineCollisions(document), []);
  const tables = [];
  for (let page = 0; page < document.pageCount(); page += 1) {
    const info = JSON.parse(document.getPageInfo(page));
    const controls = JSON.parse(document.getPageControlLayout(page)).controls;
    const right = info.columns[0].x + info.columns[0].width;
    for (const control of controls) {
      assert.ok(control.x + control.w <= right + 1, JSON.stringify(control));
      assert.ok(control.y + control.h <= info.footerArea.y + 1, JSON.stringify(control));
    }
    for (const table of controls.filter((c) => c.type === 'table')) {
      tables.push(table);
      for (const equation of controls.filter((c) => c.type === 'equation' && c.paraIdx === table.paraIdx && c.cellIdx !== undefined)) {
        const cell = table.cells.find((c) => c.cellIdx === equation.cellIdx);
        assert.ok(equation.x >= cell.x && equation.x + equation.w <= cell.x + cell.w + 1);
        assert.ok(equation.y >= cell.y && equation.y + equation.h <= cell.y + cell.h + 1, JSON.stringify({ equation, cell }));
      }
      for (const cell of table.cells) {
        const props = JSON.parse(document.getCellProperties(0, table.paraIdx, table.controlIdx, cell.cellIdx));
        for (const side of ['Left', 'Right', 'Top', 'Bottom']) assert.equal(props[`border${side}`].type, 0);
      }
    }
  }
  return tables;
}

test('actual 2021 ga questions retain all editable math, compact ordered choices, and safe saved bounds', async () => {
  const items = fixtures.map(({ question, pdf, glyphMap, structure }) => {
    const { contentRegions = [], ...rebuilt } = buildLiveStructure(question, pdf, new Map(glyphMap));
    assert.deepEqual(contentRegions, []); // these text/math fixtures contain no figure regions
    assert.deepEqual(rebuilt, structure);
    return { question, questionId: question.id, sourceLabel: question.id, paragraphs: paragraphsForPrepared(structure) };
  });
  for (const pagePerQuestion of [false, true]) {
    const bytes = await createCollectionHwpx(items, { pagePerQuestion });
    assert.deepEqual(documentScripts(bytes), fixtures.flatMap((f) => sourceScripts(f.structure)));
    assert.equal(documentText(bytes).match(/[①②③④⑤]/gu).join(''), '①②③④⑤①②③④⑤');
    const doc = new HwpDocument(bytes);
    try {
      const tables = assertSavedLayout(doc);
      assert.deepEqual(tables.map((t) => [t.rowCount, t.colCount]), [[2, 3], [1, 5]]);
      const targets = await readQuestionTargets(bytes);
      assert.deepEqual(Object.keys(targets), items.map((i) => i.questionId));
      if (pagePerQuestion) {
        const pages = Object.values(targets).map((t) => JSON.parse(doc.getCursorRect(t.section, t.paragraph, 0)).pageIndex);
        assert.ok(pages[1] > pages[0]);
      }
      if (!pagePerQuestion) {
        writeFileSync('.omo/evidence/1003-math-layout/actual-math.hwpx', bytes);
        writeFileSync('.omo/evidence/1003-math-layout/actual-math.svg', doc.renderPageSvg(0));
      }
      // A saved choice remains a native editable cell, not a picture.
      const table = tables[0];
      assert.equal(JSON.parse(doc.insertTextInCell(0, table.paraIdx, table.controlIdx, 0, 0, 0, '편집 확인 ')).ok, true);
      const savedAgain = doc.exportHwpx();
      assert.match(documentText(savedAgain), /편집 확인/u);
      assert.deepEqual(documentScripts(savedAgain), documentScripts(bytes));
    } finally { doc.free(); }
  }
});

test('prepared math and science use horizontal choices while long prose stays vertical', async () => {
  const make = (subject, long = false) => ({ schema: 'exam-editable-v1', status: 'needs_review', subject, number: 1,
    blocks: [{ role: 'stem', runs: [{ kind: 'text', value: '다음 값은? ' }, { kind: 'equation', script: '\\frac{1}{2}' }] },
      ...[...'①②③④⑤'].map((label, index) => ({ role: 'choice', label, runs: long
        ? [{ kind: 'text', value: '조건에 대해 설명하는 긴 문장입니다. '.repeat(8) }]
        : [{ kind: 'equation', script: `\\frac{${index + 1}}{2}` }] }))] });
  for (const [subject, long, expectedTables] of [['math', false, 1], ['math', true, 0], ['p1', false, 1]]) {
    const prepared = make(subject, long);
    const bytes = await createPreparedHwpx(prepared);
    assert.deepEqual(documentScripts(bytes), sourceScripts(prepared));
    assert.equal(documentText(bytes).match(/[①②③④⑤]/gu).join(''), '①②③④⑤');
    const doc = new HwpDocument(bytes);
    try { assert.equal(assertSavedLayout(doc).length, expectedTables); } finally { doc.free(); }
  }
});
