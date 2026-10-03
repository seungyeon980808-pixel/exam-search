import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import init, { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';
import { findMathChoiceGroups, insertChoiceLayout } from './math-choice-layout.mjs';
import { sectionXml, documentScripts, documentText } from './test-hwpx-content.mjs';
await init({ module_or_path: readFileSync(new URL('./vendor/rhwp-studio/assets/rhwp_bg-PUGAA2uC.wasm', import.meta.url)) });
const evidence = process.env.MATH_CHOICE_EVIDENCE || '.omo/evidence/math-choice-layout';
mkdirSync(evidence, { recursive: true });
const labels = ['①', '②', '③', '④', '⑤'];
const choices = labels.map((label, i) => [{ kind: 'text', value: label + ' ' }, { kind: 'equation', script: `{${i + 1}} over {2}` }]);
function blank() { const doc = HwpDocument.createEmpty(); doc.createBlankDocument(); doc.insertParagraph(0, 1); return doc; }
for (const [name, width, columns] of [['five', 25000, 5], ['three-two', 11000, 3]]) {
  test(`${name}: native fractions, ordered labels, no borders, row and column fit after reload`, () => {
    const document = blank();
    let reloaded;
    try {
      const result = insertChoiceLayout(document, 1, choices, width);
      assert.equal(result.columns, columns);
      const bytes = document.exportHwpx();
      writeFileSync(`${evidence}/${name}.hwpx`, bytes);
      reloaded = new HwpDocument(bytes);
      assert.deepEqual(documentScripts(bytes), choices.map((runs) => runs[1].script));
      assert.equal(documentText(bytes).replace(/\s/gu, ''), labels.join(''));
      assert.equal((sectionXml(bytes).match(/<hp:equation\b/gu) || []).length, 5);
      const properties = Array.from({ length: result.rows * columns }, (_, cell) => JSON.parse(reloaded.getCellProperties(0, 1, result.controlIdx, cell)));
      for (const cell of properties) for (const side of ['Left', 'Right', 'Top', 'Bottom']) assert.equal(cell[`border${side}`].type, 0);
      const controls = JSON.parse(reloaded.getPageControlLayout(0)).controls;
      const table = controls.find((control) => control.type === 'table');
      const equations = controls.filter((control) => control.type === 'equation');
      assert.equal(equations.length, 5);
      assert.ok(table.w <= width / 75 + 1);
      equations.forEach((equation, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const cell = properties[index];
        const cellLeft = table.x + col * cell.width / 75;
        const cellTop = table.y + (row ? properties[0].height / 75 : 0);
        assert.ok(equation.x >= cellLeft);
        assert.ok(equation.x + equation.w <= cellLeft + cell.width / 75 + 1);
        assert.ok(equation.y + equation.h <= cellTop + cell.height / 75 + 1, JSON.stringify({ equation, cellTop, cell }));
      });
      writeFileSync(`${evidence}/${name}.svg`, reloaded.renderPageSvg(0));
      writeFileSync(`${evidence}/${name}.json`, JSON.stringify({ result, properties, controls }, null, 2));
    } finally { reloaded?.free(); document.free(); }
  });
}
test('long prose remains vertical without modifying the document; grouping preserves identity and order', () => {
  const document = blank();
  try {
    const long = labels.map((label) => [{ kind: 'text', value: label + ' ' + '이것은 긴 문장형 보기입니다. '.repeat(8) }]);
    const before = sectionXml(document.exportHwpx());
    assert.equal(insertChoiceLayout(document, 1, long, 25000), null);
    assert.equal(sectionXml(document.exportHwpx()), before);
    assert.equal(findMathChoiceGroups(choices)[0][0], choices[0]);
    assert.equal(findMathChoiceGroups([...choices].reverse()).length, 0);
    assert.equal(findMathChoiceGroups(labels.map((label) => [{ kind: 'text', value: label + '문장' }])).length, 0);
    writeFileSync(`${evidence}/vertical.json`, JSON.stringify({ returnedNull: true, documentUnchanged: true, identityPreserved: true, wrongOrderRejected: true }));
  } finally { document.free(); }
});

test('mixed-height choice labels share a real SVG baseline after save and reopen', () => {
  const doc = blank();
  let saved;
  try {
    const scripts = ['x', '{1} over {2}', 'x^2', '{{1} over {2}} over {3}', 'sqrt {x}'];
    const mixed = labels.map((label, i) => [{ kind: 'text', value: label + ' ' }, { kind: 'equation', script: scripts[i] }]);
    const result = insertChoiceLayout(doc, 1, mixed, 28000);
    assert.equal(result.columns, 5);
    const bytes = doc.exportHwpx();
    saved = new HwpDocument(bytes);
    const svg = saved.renderPageSvg(0);
    const baselines = [...svg.matchAll(/<text\b([^>]*)>([①②③④⑤])\s*<\/text>/gu)]
      .map((match) => ({ label: match[2], y: Number(/\by="([^"]+)"/u.exec(match[1])[1]) }));
    assert.equal(baselines.length, 5);
    assert.ok(Math.max(...baselines.map((b) => b.y)) - Math.min(...baselines.map((b) => b.y)) <= .05, JSON.stringify(baselines));
    assert.deepEqual(documentScripts(bytes), scripts);
    assert.equal(documentText(bytes).replace(/\s/gu, ''), labels.join(''));
    writeFileSync(`${evidence}/mixed-height.hwpx`, bytes);
    writeFileSync(`${evidence}/mixed-height.svg`, svg);
    writeFileSync(`${evidence}/mixed-height.json`, JSON.stringify({ result, baselines }, null, 2));
  } finally { saved?.free(); doc.free(); }
});

test('science short choices use adaptive native cells while long Korean choices stay paragraphs', async () => {
  const { createPreparedHwpx } = await import('./editable-convert.mjs');
  for (const long of [false, true]) {
    const question = { schema: 'exam-editable-v1', status: 'needs_review', number: 20, subject: 'b1',
      blocks: [{ role: 'stem', runs: [{ kind: 'text', value: '다음 설명으로 옳은 것은?' }] },
        ...labels.map((label, index) => ({ role: 'choice', label,
          runs: [{ kind: 'text', value: long ? '이 선지는 긴 설명을 포함하므로 강제로 작게 줄이지 않습니다. '.repeat(3) : ['ㄱ', 'ㄷ', 'ㄱ, ㄴ', 'ㄴ, ㄷ', 'ㄱ, ㄴ, ㄷ'][index] }] }))] };
    const bytes = await createPreparedHwpx(question), doc = new HwpDocument(bytes);
    try {
      const controls = Array.from({ length: doc.pageCount() }, (_, p) => JSON.parse(doc.getPageControlLayout(p)).controls).flat();
      const tables = controls.filter(c => c.type === 'table');
      assert.equal(tables.length, long ? 0 : 1);
      const runs = Array.from({ length: doc.pageCount() }, (_, p) => JSON.parse(doc.getPageTextLayout(p)).runs).flat().filter(r=>r.text.trim());
      assert.ok(runs.every(r => Math.abs(r.fontSize - 1000 / 75) < .05));
      for (const label of labels) assert.equal(documentText(bytes).split(label).length - 1, 1);
      writeFileSync(`${evidence}/science-${long ? 'long' : 'short'}.hwpx`, bytes);
      writeFileSync(`${evidence}/science-${long ? 'long' : 'short'}.svg`, doc.renderPageSvg(0));
    } finally { doc.free(); }
  }
});
