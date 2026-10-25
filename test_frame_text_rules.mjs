import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, uprightScript } from './exampool/convert/rules.js';

// 10-25: 5E 틀 변환기의 글 정리 규칙(수식 짝 읽기, 바로 선 단위·화학식).
test('equations separated by a space stay apart as an equation space instead of being glued', () => {
  assert.equal(clean('$A$ $1mol$과'), '$A~1{rm mol}$과');
  assert.equal(clean('$A$$B$'), '$AB$');
  assert.equal(clean('$X$와 $Y$'), '$X$와 $Y$');
  assert.equal(clean('a $ $ b'), 'a b');
  assert.equal(clean('시․공간적 $A$∼$D$'), '시·공간적 $A$～$D$');
});
test('units and real chemical formulas are upright; variables and hypothetical elements stay italic', () => {
  const cases = { '210N': '210{rm N}', '0.2m': '0.2{rm m}', '3m': '3m', '70km/s/Mpc': '70{rm km}/{rm s}/{rm Mpc}', mol: '{rm mol}', s: 's',
    KCl: '{rm KCl}', 'C_{6}H_{12}O_{6}': '{rm C}_{6}{rm H}_{12}{rm O}_{6}', 'H_{3}O^{+}': '{rm H}_{3}{rm O}^{+}', 'Ca^{2+}': '{rm Ca}^{2+}',
    X: 'X', 'Y^{-}': 'Y^{-}', 'B_{0}': 'B_{0}', 'v_{0}': 'v_{0}', PV: 'PV', LED: '{rm LED}', ABC: 'ABC', '\\frac{pH}{pOH}': '\\frac{{rm pH}}{{rm pOH}}', '2mg': '2mg', '12a+b': '12a+b' };
  for (const [input, expected] of Object.entries(cases)) assert.equal(uprightScript(input), expected, input);
  assert.equal(uprightScript(uprightScript('C_{6}H_{12}O_{6}')), '{rm C}_{6}{rm H}_{12}{rm O}_{6}');
});
