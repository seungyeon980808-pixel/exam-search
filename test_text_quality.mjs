import assert from 'node:assert/strict';
import test from 'node:test';
import { attachTextScripts, lineRuns } from './live-convert.mjs';
import { equationScript, groupFractions } from './editable-convert.mjs';

const item = (value, x, math = false, y = 100, height = 11, width = 6, font = '') =>
  ({ value, raw: value, x, y, height, width, math, font });
const runs = (items) => lineRuns({ y: 100, items });

test('visible gaps survive punctuation and every run-kind boundary', () => {
  for (const [left, right] of [[item(',', 0), item('다음', 11)],
    [item('간격은', 0), item('d', 11, true)], [item('d', 0, true), item('이다', 11)],
    [item('x', 0, true), item('y', 12, true)]]) {
    const result = runs([left, right]);
    assert.equal(result.map((run) => run.kind === 'text' ? run.value : `[${run.script}]`).join(''),
      `${left.math ? `[${left.value}]` : left.value} ${right.math ? `[${right.value}]` : right.value}`);
  }
});

test('touching letters and attached legacy scripts never acquire a word space', () => {
  assert.deepEqual(runs([item('가', 0), item('나', 6.5)]), [{ kind: 'text', value: '가나' }]);
  assert.deepEqual(runs([item('H', 0), item('₂', 10)]), [{ kind: 'text', value: 'H₂' }]);
});

test('a Greek command and a neighbouring letter remain distinct equation tokens', () => {
  assert.equal(runs([item('\\Delta', 0, true), item('H', 6, true)])[0].script, '\\Delta H');
  assert.equal(equationScript('2L\\lambda'), '2L lambda');
  assert.equal(equationScript('k\\vec{a}'), 'k vec{a}');
});

test('scripts bind to the complete accent or absolute-value group in Hancom', () => {
  for (const [source, expected] of [
    ['\\bar {FP}^{2}', '{bar {FP}}^{2}'],
    ['\\vec{PA}_{n}', '{vec{PA}}_{n}'],
    ['|\\vec{PA}|^{2}', '{LEFT | vec{PA} RIGHT |}^{2}'],
    ['LEFT | vec{PA} RIGHT |^{2}', '{LEFT | vec{PA} RIGHT |}^{2}'],
    ['\\bar{{FP}}^{2}', '{bar{{FP}}}^{2}'],
    ['\\text{|x|^2}', '"|x|^2"'],
    ['\\text{bar{FP}^2}', '"bar{FP}^2"'],
  ]) {
    assert.equal(equationScript(source), expected);
    assert.equal(equationScript(expected), expected);
  }
});

test('Hancom receives supported font, literal text and comparison constructs', () => {
  assert.equal(equationScript('\\mathrm{C}_{2}\\text{기체 상태}'), '{rm C}_{2} "기체 상태"');
  assert.equal(groupFractions(equationScript('x>=1')), 'x≥1');
  assert.equal(equationScript('\\Delta H+\\Omega t'), 'Delta H+Omega t');
  assert.equal(equationScript('k\\{a\\}'), 'k LEFT {a RIGHT }');
});

test('lowered equation digits bind to upright text-font chemical bases', () => {
  const source = [item('C', 0, false, 100, 11, 6, 'HaansoftBatang'),
    item('2', 6.1, true, 97, 7.5, 4), item('H', 10.1, false, 100, 11, 6, 'HaansoftBatang'),
    item('4', 16.1, true, 97, 7.5, 4), item('(', 21, true, 100, 11, 4),
    item('g', 25, false, 100, 10, 5, 'Batang,It'), item(')', 30, true, 100, 11, 4)];
  assert.deepEqual(runs(attachTextScripts(source)), [{ kind: 'equation', script: '{rm C}_{2}{rm H}_{4}(g)' }]);
});

test('the same digit on the baseline remains a coefficient', () => {
  const source = [item('2', 0, true), item('C', 6, false, 100, 11, 6, 'HaansoftBatang'),
    item('(', 12, true), item('g', 18), item(')', 24, true)];
  assert.deepEqual(runs(attachTextScripts(source)), [{ kind: 'equation', script: '2{rm C}(g)' }]);
});

test('lowered or raised math scripts follow geometry without making variables upright', () => {
  for (const [y, mark] of [[97, '_'], [104, '^']]) {
    const source = [item('a', 0, false, 100, 11, 6, 'Batang,It'), item('n', 6.1, true, y, 7.5)];
    assert.deepEqual(runs(attachTextScripts(source)), [{ kind: 'equation', script: `a${mark}{n}` }]);
  }
});

test('permutation indices on both sides remain lowered while coefficients remain baseline', () => {
  const source = [item('8', 0, true, 97, 7.5, 4), item('P', 4.1, false, 100, 11, 6, 'HaansoftBatang'),
    item('2', 10.2, true, 97, 7.5, 4)];
  assert.deepEqual(runs(attachTextScripts(source)), [{ kind: 'equation', script: '{}_{8}{rm P}_{2}' }]);
});

test('a chemical element tail and raised ionic charge stay in the same equation', () => {
  const source = [item('H', 0, false, 100, 11, 6, 'HaansoftBatang'), item('3', 6.1, true, 97, 7.5, 4),
    item('O', 10.1, false, 100, 11, 6, 'HaansoftBatang'), item('+', 18.1, true, 105, 7.5, 4)];
  assert.deepEqual(runs(attachTextScripts(source)), [{ kind: 'equation', script: '{rm H}_{3}{rm O}^{+}' }]);
});

test('text-font state parentheses join a chemical formula without losing a printed space', () => {
  const source = [item('H', 0, false, 100, 11, 6, 'HaansoftBatang'), item('2', 6.1, true, 97, 7.5, 4),
    item('(', 10.2, false, 100, 11, 4), item('g', 14.3, false, 100, 11, 5), item(') ＋', 19.4)];
  assert.deepEqual(runs(attachTextScripts(source)), [{ kind: 'equation', script: '{rm H}_{2}(g)~＋' }]);
});

// Coordinates captured from c1_2019_11_13 (A²⁺), c1_2020_09_06 (C₆₀), e1_2020_06_18 (PM₂.₅)
// and c1_2020_11_12 (CO₃²⁻): every glyph of a multi-character charge or index stays in one script.
test('a multi-character charge or index is one script, never a script plus a baseline glyph', () => {
  const batang = 'HaansoftBatang';
  const charge = [item('A', 188.6, false, 753.9, 11, 8.3, batang), item('2', 198.5, true, 758.8, 7.5, 3.7),
    item('+', 203.3, true, 759.1, 7.5, 5.8)];
  assert.equal(runs(attachTextScripts(charge))[0].script, '{rm A}^{2+}');
  const fullerene = [item('C', 633.9, false, 347.4, 11, 7.4, batang), item('6', 641.4, true, 344.4, 7.5, 3.7),
    item('0', 645.1, true, 344.4, 7.5, 3.7)];
  assert.equal(runs(attachTextScripts(fullerene))[0].script, '{rm C}_{60}');
  const dust = [item('PM', 319.3, false, 502.9, 11, 17.6, batang), item('2', 336.5, true, 499.9, 7.5, 3.7),
    item('.', 340.3, true, 500.3, 7.5, 2.1), item('5', 342.5, true, 499.9, 7.5, 3.7)];
  assert.equal(runs(attachTextScripts(dust))[0].script, '{rm PM}_{2.5}');
  const carbonate = [item('CO', 249.6, false, 967.9, 11, 15.3, batang), item('3', 265.3, true, 964.9, 7.5, 3.7),
    item('2', 267.9, true, 972.8, 7.5, 3.7), item('-', 272.7, true, 973.1, 7.5, 5.6)];
  assert.equal(runs(attachTextScripts(carbonate))[0].script, '{rm CO}^{2-}_{3}');
  // A sentence period is printed in the text font on the baseline and stays text.
  const sentence = [item('PM', 0, false, 100, 11, 17.6, batang), item('1', 17.2, true, 97, 7.5, 3.7),
    item('0', 20.9, true, 97, 7.5, 3.7), item('.', 24.9, false, 100, 11.5, 2.7)];
  assert.deepEqual(runs(attachTextScripts(sentence)), [{ kind: 'equation', script: '{rm PM}_{10}' }, { kind: 'text', value: '.' }]);
});
