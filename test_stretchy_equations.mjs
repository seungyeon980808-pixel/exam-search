import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverEquationItems, recoverStretchyBrackets } from './live-equations.mjs';

const eq = (value, x, y, width = 5.5, height = 11) => ({ value, raw: value, x, y, width, height, math: true });

test('stretchy square bracket pieces become one LEFT [ ... RIGHT ] equation', () => {
  const items = [eq('\\bracketTopLeft', 163.8, 539.3), eq('|', 163.8, 535.6, 5.5, 12.8), eq('\\bracketBottomLeft', 163.8, 524.7),
    eq('-', 169.1, 532, 8.3), eq('\\frac', 179.9, 528, 9.3), eq('{\\pi}', 181.6, 538.7, 6.3), eq('6', 182, 524.2),
    eq(',', 191.8, 532, 3), eq('b', 198.2, 531.4, 4.7),
    eq('\\bracketTopRight', 202.7, 539.3), eq('\\bracketRightExtender', 202.7, 535.6, 5.5, 12.8), eq('\\bracketBottomRight', 202.7, 524.7)];
  const out = recoverStretchyBrackets(items);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 'LEFT [ -\\frac{{\\pi}}{6},b RIGHT ]');
});

test('an unmatched bracket piece fails instead of producing a wrong equation', () => {
  assert.throws(() => recoverStretchyBrackets([eq('\\bracketTopLeft', 10, 50), eq('\\bracketBottomLeft', 10, 36), eq('x', 16, 43)]), /square bracket/u);
});

test('integral limits keep every character of a multi-character bound', () => {
  const items = [eq('\\int', 477.7, 910.8, 13.5, 22), eq('x', 489.1, 904.1, 4.2, 7.5), eq('x', 491.8, 924.6, 4.2, 7.5),
    eq('+', 497.3, 925, 5.8, 7.5), eq('a', 504.4, 924.6, 3.9, 7.5), eq('f', 508.3, 913.9, 5.4)];
  const values = recoverEquationItems(items, 913.9).map((item) => item.value);
  assert.deepEqual(values, ['\\int_{x}^{x+a}', 'f']);
});

test('a tall closing parenthesis after a fraction is not a subscript', () => {
  const items = [eq('(', 567.3, 909.8, 4.3, 25.8), eq('x', 572.4, 913.9, 6.3), eq('+', 580, 914.4, 8.6), eq('\\frac', 590.8, 910.4, 9.3),
    eq('{\\pi}', 592.5, 921.1, 6.3), eq('3', 592.9, 906.6), eq(')', 601.2, 909.8, 4.3, 25.8)];
  const text = recoverEquationItems(items, 913.9).map((item) => item.value).join('');
  assert.equal(text, '(x+\\frac{{\\pi}}{3})');
});

