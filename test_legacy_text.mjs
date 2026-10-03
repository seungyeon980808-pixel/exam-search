import assert from 'node:assert/strict';
import test from 'node:test';
import { stackTextFractions, attachTextCharges, lineRuns } from './live-convert.mjs';
import { legacyText, attachedScript } from './legacy-glyphs.mjs';

const text = (value, x, y, width = 5.5, height = 11.5) => ({ value, raw: value, x, y, width, height, math: false });

test('a text-font numerator and denominator stacked after a choice marker become one fraction', () => {
  const out = stackTextFractions([text('④', 595.6, 249.2, 10.9), text('9', 614.1, 255.8), text('4', 614.1, 241.3)]);
  assert.deepEqual(out.map((item) => item.value), ['④', '\\frac{9}{4}']);
  assert.equal(out[1].math, true);
});

test('a radical before the denominator stays inside the fraction', () => {
  const out = stackTextFractions([text('②', 160.8, 420.8, 10.9), text('√', 178.4, 413.6, 18.5, 13), text('1', 185, 428.6), text('2', 188.8, 413.6)]);
  assert.deepEqual(out.map((item) => item.value), ['②', '\\frac{1}{\\sqrt{2}}']);
});

test('two text lines in the same column are never merged into a fraction', () => {
  const lines = [text('가', 100, 700), text('나', 100, 685)];
  assert.deepEqual(stackTextFractions(lines).map((item) => item.value), ['가', '나']);
});

test('legacy symbol fonts decode to the printed characters', () => {
  assert.equal(legacyText('ABCDEF+GSMediumB1', 'CO™'), 'CO₂');
  assert.equal(legacyText('ABCDEF+GSMediumB1', 'Na±'), 'Na⁺');
  assert.equal(legacyText('ABCDEF+GSMediumB1', '37˘C'), '37°C');
  assert.equal(legacyText('ABCDEF+GSSymbolB2', 'a'), 'α');
  assert.equal(legacyText('ABCDEF+GSMediItaC1', '*'), 'g');
  assert.equal(legacyText('ABCDEF+GSMediumB1', '*'), '*');
  assert.equal(legacyText('ABCDEF+Batang', 'CO™'), 'CO™');
});

test('a raised subscript glyph is printed as a superscript', () => {
  assert.equal(legacyText('X+GSMediumB1', '™', 0.6), '²');
  assert.equal(legacyText('X+GSMediumB1', '™', 0), '₂');
  assert.equal(legacyText('X+GSMediumB1', '≠', -0.4), '₊');
  assert.ok(attachedScript.test('ʰ') && attachedScript.test('ᵐ') && attachedScript.test('₂'));
});


// Source coordinates from b1_2025_11_20, page 4. No formula is inferred from chemistry.
test('ordinary-font charges remain attached to the observed chemical text baseline', () => {
  for (const [base, x, y, width, height, charge, cx, cy, cw, ch, expected] of [
    ['(NH4', 610.74, 373.0191, 17.34, 9.27, '＋', 628.08, 376.9791, 5.1, 6.05, '(NH4⁺)'],
    ['(NO3', 612.1249325, 248.2321, 22.7351915, 11.5, '－', 634.860124, 253.3159, 6.839876, 7.36, '(NO3⁻)'],
  ]) {
    const items = attachTextCharges([text(base,x,y,width,height), text(charge,cx,cy,cw,ch), text(')',cx+cw,y,3,height)]);
    assert.equal(items[1].y,y);
    assert.equal(lineRuns({y,items}).map(r=>r.value).join(''),expected);
    const ordinary = text('+',cx,y,cw,height);
    assert.deepEqual(attachTextCharges([text(base,x,y,width,height),ordinary])[1],ordinary);
  }
});
