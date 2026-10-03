import assert from 'node:assert/strict';
import test from 'node:test';
import { equationTextItems } from './pdf-text-geometry.mjs';

const ops = Object.fromEntries(['setFont', 'setTextMatrix', 'showText', 'setCharSpacing',
  'setHScale', 'save', 'restore', 'transform', 'beginText', 'moveText'].map((name, index) => [name, index]));
const font = { eq: { name: 'Subset+HyhwpEQ', fontMatrix: [0.001, 0, 0, 0.001, 0, 0] } };
const glyph = (unicode, width = 500) => ({ unicode, width });
const extract = (commands) => equationTextItems({ fnArray: commands.map(([name]) => ops[name]),
  argsArray: commands.map(([, args]) => args) }, ops, font);

test('operator geometry keeps separately scaled fraction bars and glyphs apart', () => {
  const items = extract([['setFont', ['eq', 1]], ['setTextMatrix', [[7.44, 0, 0, 7.5, 205.98, 564.96]]],
    ['showText', [[glyph('\ue036')]]], ['setTextMatrix', [[17.64, 0, 0, 10.98, 211.74, 564.54]]],
    ['showText', [[glyph('\ue06d')]]]]);
  assert.equal(items.length, 2);
  assert.equal(items[0].width, 3.72);
  assert.equal(items[1].width, 8.82);
  assert.deepEqual(items[1].transform.slice(4), [211.74, 564.54]);
});

test('text positioning honors TJ gaps, horizontal scale, and saved transforms', () => {
  const items = extract([['setFont', ['eq', 10]], ['setTextMatrix', [[1, 0, 0, 1, 20, 30]]],
    ['setHScale', [200]], ['showText', [[glyph('x'), -100, glyph('y')]]], ['save', []],
    ['transform', [2, 0, 0, 2, 5, 7]], ['showText', [[glyph('z')]]], ['restore', []],
    ['showText', [[glyph('a')]]]]);
  assert.equal(items[0].transform[4], 20);
  assert.equal(items[1].transform[4], 32);
  assert.equal(items[2].transform[4], 89);
  assert.equal(items[3].transform[4], 42);
});

test('contiguous ASCII operator names stay together without combining displaced limits', () => {
  const items = extract([['setFont', ['eq', 10]], ['setTextMatrix', [[1, 0, 0, 1, 20, 30]]],
    ['showText', [[glyph('l'), glyph('i'), glyph('m')]]],
    ['setTextMatrix', [[1, 0, 0, 1, 20, 22]]], ['showText', [[glyph('h')]]]]);
  assert.deepEqual(items.map((item) => item.str), ['lim', 'h']);
});
