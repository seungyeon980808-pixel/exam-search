function table(view, tag) {
  const count = view.getUint16(4);
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    const name = String.fromCharCode(...Array.from({ length: 4 }, (_, offset) => view.getUint8(record + offset)));
    if (name === tag) return { offset: view.getUint32(record + 8), length: view.getUint32(record + 12) };
  }
  throw new Error(`내장 글꼴에 ${tag} 테이블이 없습니다.`);
}

export function glyphBytes(fontData, glyphId) {
  const data = new Uint8Array(fontData);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const head = table(view, 'head');
  const hhea = table(view, 'hhea');
  const maxp = table(view, 'maxp');
  const hmtx = table(view, 'hmtx');
  const loca = table(view, 'loca');
  const glyf = table(view, 'glyf');
  const count = view.getUint16(maxp.offset + 4);
  if (!Number.isInteger(glyphId) || glyphId < 0 || glyphId >= count) {
    throw new Error('PDF 글리프 번호가 글꼴 범위를 벗어났습니다.');
  }
  const unitsPerEm = view.getUint16(head.offset + 18);
  const longLocations = view.getInt16(head.offset + 50) === 1;
  const at = (index) => longLocations
    ? view.getUint32(loca.offset + index * 4) : view.getUint16(loca.offset + index * 2) * 2;
  const from = at(glyphId);
  const to = at(glyphId + 1);
  if (to < from || to > glyf.length) throw new Error('PDF 글리프 윤곽 범위가 잘못됐습니다.');
  const horizontalCount = view.getUint16(hhea.offset + 34);
  const advance = view.getUint16(hmtx.offset + Math.min(glyphId, horizontalCount - 1) * 4);
  const bearing = view.getInt16(hmtx.offset + (glyphId < horizontalCount
    ? glyphId * 4 + 2 : horizontalCount * 4 + (glyphId - horizontalCount) * 2));
  return { raw: data.subarray(glyf.offset + from, glyf.offset + to),
    unitsPerEm, metrics: [advance, bearing] };
}

export async function verifyGlyph(fontData, glyphId, proof) {
  const actual = glyphBytes(fontData, glyphId);
  if (actual.unitsPerEm !== proof.unitsPerEm
    || actual.metrics[0] !== proof.metrics[0]
    || actual.metrics[1] !== proof.metrics[1]) return false;
  const digest = await crypto.subtle.digest('SHA-256', actual.raw);
  const hex = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
  return hex === proof.glyfSha256;
}
