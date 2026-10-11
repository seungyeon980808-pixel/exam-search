import test from 'node:test';
import assert from 'node:assert/strict';
import { ruledTextFractions } from './ruled-text-fractions.mjs';
import { createCollectionHwpx, equationScript, groupFractions } from './editable-convert.mjs';
import { documentScripts } from './test-hwpx-content.mjs';
import { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';
const text = (value, x, y, width, height = 11.5) => ({ value, raw: value, x, y, width, height, math: false });
const rule = { type: 'line', orient: 'h', width: .36, dash: false, box: [449.10, 609.60, 528.72, 609.60] };
// Actual source coordinates: e1_2027_06_20, page 4. PDF y increases upward.
const rows = [text('자원소 함량', 462.1253, 1191 - 606.4249, 53.5817),
  text('방사성 원소 함량 ', 450.6650, 1191 - 620.7654, 79.3150)];
test('a verified printed rule joins word numerator/denominator exactly once, keeping adjacent prose', () => {
  const adjacent = text('을 시기별로 나타낸 것이다', 529.98, 1191 - 613.6209, 121.176);
  const output = ruledTextFractions([...rows, adjacent], [rule, { ...rule }], 1191);
  assert.equal(output.length, 2);
  assert.equal(output[0], adjacent);
  assert.equal(output[1].value, String.raw`\frac{\text{자원소 함량}}{\text{방사성 원소 함량}}`);
  assert.equal(output[1].math, true);
});
test('text rows, underlines, dashed rules and table grid borders do not become inferred fractions', () => {
  const grid = { type: 'line', orient: 'v', box: [449.1, 598, 449.1, 635] };
  for (const primitives of [[], [{ ...rule, dash: true }], [rule, grid]])
    assert.deepEqual(ruledTextFractions(rows, primitives, 1191), rows);
  const prose = [rows[0], { ...rows[1], y: rows[0].y - 18 }];
  assert.deepEqual(ruledTextFractions(prose, [rule], 1191), prose);
});
test('Korean word fraction remains a native equation with its rule after HWPX save/reopen', async () => {
  const fraction = ruledTextFractions(rows, [rule], 1191)[0];
  const bytes = await createCollectionHwpx([{ questionId: 'word-fraction', sourceLabel: '원본 비율', question: { responseType: 'short_answer' },
    paragraphs: [[{ kind: 'text', value: '비율 ' }, { kind: 'equation', script: fraction.value }, { kind: 'text', value: '을 구하시오.' }]] }]);
  assert.deepEqual(documentScripts(bytes), [groupFractions(equationScript(fraction.value))]);
  const doc = new HwpDocument(bytes);
  try {
    const equations = JSON.parse(doc.getPageControlLayout(0)).controls.filter(control => control.type === 'equation');
    assert.equal(equations.length, 1);
    const control = equations[0], props = JSON.parse(doc.getEquationProperties(control.secIdx, control.paraIdx, control.controlIdx, -1, -1));
    assert.equal(props.script, groupFractions(equationScript(fraction.value)));
    const svg = doc.renderEquationPreview(props.script, props.fontSize, 0);
    assert(svg.includes('자원소 함량') && svg.includes('방사성 원소 함량'));
    assert.match(svg, /<(?:line|rect)\b/u);
  } finally { doc.free(); }
});

test('overflowing prose after a wide word ratio moves together instead of becoming singleton paragraphs', async () => {
  const suffix = '는? (단, 실린더 속 기체의 온도와 압력은 일정하다.)';
  const bytes = await createCollectionHwpx([{ questionId: 'wide-word-ratio', question: { responseType: 'short_answer' },
    paragraphs: [[{ kind: 'equation', script: String.raw`b\times\frac{\text{Ⅱ에서 반응 후 전체 기체의 부피(L)}}{\text{Ⅲ에서 반응 후 전체 기체의 부피(L)}}` },
      { kind: 'text', value: suffix }]] }]);
  const doc = new HwpDocument(bytes);
  try {
    const paragraphs = Array.from({ length: doc.getParagraphCount(0) }, (_, p) => doc.getTextRange(0, p, 0, 1000));
    assert(paragraphs.some(text => text.includes(suffix)), JSON.stringify(paragraphs));
    assert.equal(documentScripts(bytes).length, 1);
  } finally { doc.free(); }
});
