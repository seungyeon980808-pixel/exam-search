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

// 10-25 b2_2025_09_13: 한글 없는 짧은 분수(A/C ＝ 7/5). 원본 좌표(위가 0인 y를 1191에서 뺀 값), 분수 줄 14.6pt.
test('short fractions without Korean (A/C, 7/5) are joined only when the rows sit closer than a prose line', () => {
  const H = 1191, line = (x0, x1, top) => ({ type: 'line', orient: 'h', width: .36, dash: false, box: [x0, top, x1, top] });
  const rows = [text('A', 159, H - 541.9, 8.7), text('C ', 159.5, H - 555.1, 12.5), text('7', 188.5, H - 541.8, 5.5), text('5', 188.5, H - 555.1, 5.5)];
  const out = ruledTextFractions(rows, [line(155.9, 170.5, 544.4), line(183.9, 198.4, 544.4)], H);
  assert.deepEqual(out.map((item) => item.value).sort(), [String.raw`\frac{7}{5}`, String.raw`\frac{\text{A}}{\text{C}}`]);
  // 본문 줄 간격(16.65pt = 글자 높이의 1.45배)으로 떨어진 두 줄은 밑줄이 있어도 분수가 아니다.
  const prose = [text('AB', 159, H - 541.9, 11), text('CD', 159, H - 558.55, 11)];
  assert.deepEqual(ruledTextFractions(prose, [line(158, 171, 544)], H), prose);
  // 영문이라도 길면(13자 넘게) 분수로 보지 않는다.
  const long = [text('ABCDEFGHIJKLMN', 150, H - 541.9, 80), text('ABCDEFGHIJKLMN', 150, H - 555.1, 80)];
  assert.deepEqual(ruledTextFractions(long, [line(149, 231, 544.4)], H), long);
});
test('a small subscript under the numerator or denominator stays in its row as a subscript', () => {
  const H = 1191, rule = { type: 'line', orient: 'h', width: .36, dash: false, box: [100, 544.4, 160, 544.4] };
  const rows = [text('t2일 때', 105, H - 541.9, 50), text('t', 105, H - 555.1, 3), text('1', 108.2, H - 556.2, 2.8, 5.9), text('일 때', 112, H - 555.1, 43)];
  const out = ruledTextFractions(rows, [rule], H);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, String.raw`\frac{\text{t2일 때}}{\text{t}_{1}\text{일 때}}`);
});
