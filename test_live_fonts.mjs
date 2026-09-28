import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { verifyGlyph } from './ttf-glyphs.mjs';

function specimen(raw = Uint8Array.of(0, 1, 0, 0, 0, 0, 0, 100, 0, 100, 0, 2, 0, 0, 0x31, 0x33, 0x27, 100), metrics = [500, 20]) {
  const tags = ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf'];
  const sizes = [54, 36, 6, 8, 12, raw.length];
  const bytes = new Uint8Array(12 + 16 * tags.length + sizes.reduce((a, b) => a + b));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000); view.setUint16(4, tags.length);
  const offsets = {};
  let at = 12 + 16 * tags.length;
  tags.forEach((tag, i) => {
    offsets[tag] = at;
    [...tag].forEach((char, j) => view.setUint8(12 + i * 16 + j, char.charCodeAt(0)));
    view.setUint32(20 + i * 16, at); view.setUint32(24 + i * 16, sizes[i]);
    at += sizes[i];
  });
  view.setUint16(offsets.head + 18, 1024); view.setInt16(offsets.head + 50, 1);
  view.setUint16(offsets.hhea + 34, 2); view.setUint16(offsets.maxp + 4, 2);
  view.setUint16(offsets.hmtx + 4, metrics[0]); view.setInt16(offsets.hmtx + 6, metrics[1]);
  view.setUint32(offsets.loca + 8, raw.length);
  bytes.set(raw, offsets.glyf);
  return { bytes, offsets, proof: { codepoint: 0xE000, glyphId: 1, formula: 'A',
    unitsPerEm: 1024, metrics, glyfSha256: createHash('sha256').update(raw).digest('hex') } };
}

const fixture = specimen();
const proof = fixture.proof;
const registry = JSON.parse(await readFile(new URL('./data/editable/glyph-proofs.json', import.meta.url)));
globalThis.fetch = async () => ({ ok: true, json: async () => ({ fonts: [
  ...registry.fonts,
  { fontName: 'HyhwpEQ', unitsPerEm: 1024, glyphs: [proof] },
  { fontName: 'Conflicting', unitsPerEm: 1024, glyphs: [proof, { ...proof, formula: 'B' }] },
] }) });
const { verifiedGlyphMap } = await import('./live-fonts.mjs');
const question = { box: [0, 0, 100, 100] };
function page(fontName = 'ABCDEF+HyhwpEQ-Identity-H') {
  return { pageHeight: 100, content: { items: [{ str: '\uE000', fontName: 'font1', width: 10,
    transform: [1, 0, 0, 1, 10, 50] }] }, fonts: { font1: { name: fontName, data: fixture.bytes } },
  glyphs: [{ fontId: 'font1', codepoint: 0xE000, glyphId: 1 }] };
}

test('recovers a verified glyph when the font has subset and Identity suffixes', async () => {
  const result = await verifiedGlyphMap(question, page());
  assert.equal(result.get('font1:57344'), 'A');
});

test('rejects a different outline even when the font name and codepoint match', async () => {
  const pdf = page();
  pdf.fonts.font1.data = fixture.bytes.slice();
  pdf.fonts.font1.data[fixture.offsets.glyf + 17] ^= 1;
  await assert.rejects(verifiedGlyphMap(question, pdf), /모양을 검증하지 못했습니다/);
});

test('rejects changed advance metrics for an identical outline', async () => {
  assert.equal(await verifyGlyph(fixture.bytes, 1, { ...proof, metrics: [501, 20] }), false);
});

test('rejects an empty outline even when its digest and metrics match', async () => {
  assert.equal(await verifyGlyph(fixture.bytes, 0, { ...proof, metrics: [0, 0],
    glyfSha256: createHash('sha256').update(new Uint8Array()).digest('hex') }), false);
});

test('rejects one unverified occurrence of an otherwise verified codepoint', async () => {
  const pdf = page();
  pdf.glyphs.push({ fontId: 'font1', codepoint: 0xE000, glyphId: 0 });
  await assert.rejects(verifiedGlyphMap(question, pdf), /모양을 검증하지 못했습니다/);
});

test('rejects conflicting semantics for one exact outline', async () => {
  await assert.rejects(verifiedGlyphMap(question, page('Conflicting')), /서로 다른 수식/);
});

test('rejects an unrecognized font family with matching bytes', async () => {
  await assert.rejects(verifiedGlyphMap(question, page('Unknown')), /모양을 검증하지 못했습니다/);
});

const braceSpecimens = [
  [0xE078, '\\braceTop', [506, 210], '000100d2ff3501c7025e00130006b20b08012b31013506070607060706151133113437363736373601c7402f2e1c1e0f0f3004050811342e0248160715152222333443fdf601d6392d291b3a2723'],
  [0xE079, '\\braceMiddle', [506, 15], '0001000fff35010303350026000ab6100100240113042b3105353427262726272627363736373637363d012315140706070607060715161716171617161d010103090c1d1d31253938222e1e1e0e0c310c0b151726263434262617150b0ccbdb3f2c3c262517110c0e0f16222540323cd7cd4331311f1e171610260e16171f1e313242d1'],
  [0xE07A, '\\braceBottom', [506, 210], '000100d2000c01c7033500130006b2080b012b31253526272627262726351123111417161716171601c7422d3411080504300f0f1e1c2e2f0c180f23273a1c292c3801d5fdf84333342121161600'],
  [0xE07B, '\\braceExtender', [506, 210], '000100d200360102023700030006b20002012b3125112311010230360201fdff'],
];
for (const [codepoint, token, metrics, hex] of braceSpecimens) {
  test(`recovers ${token} from its audited outline without emitting a literal brace`, async () => {
    const pdf = page();
    pdf.content.items[0].str = String.fromCodePoint(codepoint);
    pdf.glyphs[0].codepoint = codepoint;
    pdf.fonts.font1.data = specimen(Buffer.from(hex, 'hex'), metrics).bytes;
    const result = await verifiedGlyphMap(question, pdf);
    assert.equal(result.get(`font1:${codepoint}`), token);
  });
}
