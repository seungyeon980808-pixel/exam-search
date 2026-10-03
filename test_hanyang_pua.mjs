import test from 'node:test';
import assert from 'node:assert/strict';
import { hanyangPua, isOldHangulFont } from './hanyang-pua.mjs';
import { verifiedGlyphMap } from './live-fonts.mjs';

for (const [cp, text] of [[0xE857, '\u112B\u1161'], [0xEEA4, '\u110B\u11A1'], [0xF53A, '\u1112\u119E\u11AB'], [0xE63F, '\u1107\u1175\u11EB']]) {
  test(`decodes Hanyang U+${cp.toString(16)} to its Unicode syllable`, () => {
    assert.equal(hanyangPua(cp), text);
  });
}

test('leaves unmapped characters undefined', () => {
  for (const cp of [0xE000, 0xE0BB, 0xF8F8, 0xF8FF, 0xAC00, -1, 1.5, NaN]) {
    assert.equal(hanyangPua(cp), undefined);
  }
});

test('recognizes only audited Hanyang font families with PDF wrappers', () => {
  for (const name of ['ABCDEF+*¿¾ÇÑ±Û', '옛한글', 'ABCDEF+*옛한글-Identity-H', '*½Å¸í-Áß¸íÁ¶', '*신명-중명조']) {
    assert.equal(isOldHangulFont(name), true);
  }
  for (const name of [undefined, '', 'ABCDEF+HyhwpEQ-Identity-H', '*¸íÁ¶', 'Not옛한글', '옛한글Fake']) {
    assert.equal(isOldHangulFont(name), false);
  }
});

function page(name, text = '\uEEA4') {
  return { pageHeight: 100, fonts: { f: { name } }, glyphs: [], content: { items: [
    { str: text, fontName: 'f', width: 10, transform: [1, 0, 0, 1, 10, 50] },
  ] } };
}
const question = { box: [0, 0, 100, 100] };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ fonts: [] }) });

test('decodes an old-Hangul text item without equation outline proofs', async () => {
  const result = await verifiedGlyphMap(question, page('ABCDEF+*¿¾ÇÑ±Û'));
  assert.equal(result.get('f:61092'), '\u110B\u11A1');
});

test('decodes the Hanyang syllable present in Shinmyung Jungmyungjo', async () => {
  const result = await verifiedGlyphMap(question, page('ABCDEF+*½Å¸í-Áß¸íÁ¶', '\uF53A'));
  assert.equal(result.get('f:62778'), '\u1112\u119E\u11AB');
});

test('still rejects the same PUA code in an equation font', async () => {
  await assert.rejects(verifiedGlyphMap(question, page('HyhwpEQ')), /모양을 검증하지 못했습니다/u);
});

test('still rejects unmapped private characters in an old-Hangul font', async () => {
  await assert.rejects(verifiedGlyphMap(question, page('옛한글', '\uF8FF')), /모양을 검증하지 못했습니다/u);
});
