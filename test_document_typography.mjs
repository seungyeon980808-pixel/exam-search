import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCollectionHwpx } from './editable-convert.mjs';
import { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';
import { documentScripts, documentText } from './test-hwpx-content.mjs';
const evidence = '.omo/evidence/typography';
mkdirSync(evidence, { recursive: true });
test('saved body, box, and data table share 10pt text/equations and 8pt source', async () => {
  const paragraphs = [
    [{ kind: 'text', value: '본문 ' }, { kind: 'equation', script: 'x^2' }],
    [{ kind: 'table', table: { rows: [[[ { kind: 'text', value: '자료표 ' }, { kind: 'equation', script: '{1} over {2}' } ]]] } }],
    [{ kind: 'text', value: '<보기>' }],
    [{ kind: 'text', value: 'ㄱ. 보기 ' }, { kind: 'equation', script: 'x_1' }],
    ...[...'①②③④⑤'].map((label) => [{ kind: 'text', value: label + ' 선택지' }]),
  ];
  const bytes = await createCollectionHwpx([{ questionId: 'typography', sourceLabel: '출처', question: { no: 1, subject: 'p1' }, paragraphs }]);
  const doc = new HwpDocument(bytes);
  try {
    const runs = [], equations = [];
    for (let page = 0; page < doc.pageCount(); page++) {
      runs.push(...JSON.parse(doc.getPageTextLayout(page)).runs.filter((r) => r.text.trim()));
      equations.push(...JSON.parse(doc.getPageControlLayout(page)).controls.filter((c) => c.type === 'equation'));
    }
    for (const word of ['본문', '자료표', '보기', '선택지']) {
      const matching = runs.filter((r) => r.text.includes(word));
      assert.ok(matching.length, word);
      matching.forEach((r) => assert.ok(Math.abs(r.fontSize - 1000 / 75) < .05, JSON.stringify(r)));
    }
    assert.ok(runs.some((r) => r.text.includes('출처') && Math.abs(r.fontSize - 800 / 75) < .05));
    assert.equal(equations.length, 3);
    for (const eq of equations) {
      const props = JSON.parse(doc.getEquationProperties(eq.secIdx, eq.paraIdx, eq.controlIdx, eq.cellIdx ?? -1, eq.cellParaIdx ?? -1));
      assert.equal(props.fontSize, 1000);
    }
    const again = doc.exportHwpx();
    assert.deepEqual(documentScripts(again), documentScripts(bytes));
    assert.equal(documentText(again), documentText(bytes));
    writeFileSync(`${evidence}/profile.hwpx`, again);
    writeFileSync(`${evidence}/profile.svg`, doc.renderPageSvg(0));
    writeFileSync(`${evidence}/profile.json`, JSON.stringify({ runs, equations }, null, 2));
  } finally { doc.free(); }
});

test('equations that cannot fit at 8pt report explicit overflow instead of unreadable shrinking', async () => {
  const paragraphs = [[{ kind: 'text', value: '계산 ' }, { kind: 'equation', script: Array(120).fill('x').join('+') }],
    ...[...'①②③④⑤'].map((label) => [{ kind: 'text', value: label + ' 선택지' }])];
  await assert.rejects(createCollectionHwpx([{ questionId: 'overflow', sourceLabel: '출처', question: { no: 1, subject: 'p1' }, paragraphs }]),
    /최소 8pt 크기로도/u);
  writeFileSync(`${evidence}/overflow.json`, JSON.stringify({ equationTerms: 120, minimumPointSize: 8, explicitOverflowRejected: true }));
});

test('one-column science list cells align left while their heading remains centered', async () => {
  const { createPreparedHwpx } = await import('./editable-convert.mjs');
  const bytes = await createPreparedHwpx({ schema: 'exam-editable-v1', status: 'needs_review', subject: 'b1', number: 20,
    blocks: [{ role: 'stem', runs: [{kind:'text',value:'다음 특징을 비교한다.'}] },
      {kind:'table',role:'stem',rows:[[[{kind:'text',value:'특징'}]],[[{kind:'text',value:'·세균이 관여한다.\n·대기 중의 질소 기체가 전환된다.'}]]]}] });
  const doc = new HwpDocument(bytes);
  try {
    const table = JSON.parse(doc.getPageControlLayout(0)).controls.find(c=>c.type==='table');
    const heading=JSON.parse(doc.getCellParaPropertiesAt(0,table.paraIdx,table.controlIdx,0,0));
    const item=JSON.parse(doc.getCellParaPropertiesAt(0,table.paraIdx,table.controlIdx,1,0));
    assert.equal(heading.alignment.toLowerCase(),'center');
    assert.equal(item.alignment.toLowerCase(),'left');
    assert.match(documentText(bytes),/세균이 관여한다/u);
    assert.match(documentText(bytes),/대기 중의 질소/u);
    writeFileSync(`${evidence}/science-list.hwpx`,bytes);
    writeFileSync(`${evidence}/science-list.svg`,doc.renderPageSvg(0));
  } finally {doc.free();}
});
