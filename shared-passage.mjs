const letters = (text) => text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
const markers = '①②③④⑤';
const protectedMarkers = '❶❷❸❹❺';
// Questions of one [n～m] set share their passage, so a whole-paper conversion extracts it once.
// Keyed by the PDF reader so injected test readers never share results.
const passageCache = new WeakMap();

export function sharedPassageRegions(question) {
  const seen = new Set();
  return (question.passageRegions || []).filter((region) => {
    if (!Number.isInteger(region.page) || !Array.isArray(region.box) || region.box.length !== 4
      || !region.box.every(Number.isFinite) || region.box[2] <= region.box[0] || region.box[3] <= region.box[1]) return false;
    if (region.page === question.page && region.box.every((value, index) => Math.abs(value - question.box?.[index]) < 2)) return false;
    const key = JSON.stringify(region);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Identifies one printed passage; questions of the same [n～m] set share it. */
export function passageKey(question) {
  const regions = sharedPassageRegions(question);
  return regions.length ? JSON.stringify([question.pdfFile, regions]) : '';
}

function protect(text) {
  return text.replace(/[①②③④⑤]/gu, (char) => protectedMarkers[markers.indexOf(char)]).replace(/\./gu, '․');
}
function restore(text) {
  return text.replace(/[❶❷❸❹❺]/gu, (char) => markers[protectedMarkers.indexOf(char)]).replace(/․/gu, '.');
}

export async function passageBlocks(question, deps = {}) {
  const regions = sharedPassageRegions(question);
  if (!regions.length) return [];
  const notes = [];
  const reject = (reason) => {
    notes.push(`공통 지문을 제외했습니다: ${reason}`);
    return [];
  };
  const finish = (blocks) => {
    deps.notes?.push(...notes);
    return blocks;
  };
  const split = question.questionText ? (question.text || '').lastIndexOf(question.questionText) : -1;
  const indexed = split > 0 ? letters(question.text.slice(0, split)) : '';
  if (!indexed) return finish(reject('대조할 색인 지문이 없습니다.'));
  try {
    const read = deps.readQuestionPdf || (await import('./pdf-viewer.mjs')).readQuestionPdf;
    const glyphMap = deps.glyphMap || (await import('./live-fonts.mjs')).verifiedGlyphMap;
    const build = deps.build || (await import('./live-convert.mjs')).buildLiveStructure;
    const cache = passageCache.get(read) ?? new Map();
    passageCache.set(read, cache);
    const key = JSON.stringify([passageKey(question), indexed]);
    const hit = cache.get(key);
    if (hit) {
      notes.push(...hit.notes);
      return finish(structuredClone(hit.blocks));
    }
    const extract = async () => {
      const blocks = [];
      for (const region of regions) {
        deps.signal?.throwIfAborted();
        const item = { ...question, ...region, displayBox: region.box, responseType: 'short_answer' };
        const pdf = await read(item);
        const glyphs = await glyphMap(item, pdf);
        const protectedPdf = { ...pdf, content: { ...pdf.content,
          items: pdf.content.items.map((entry) => ({ ...entry, str: protect(entry.str || '') })) } };
        const extracted = build(item, protectedPdf, glyphs).blocks;
        for (const block of extracted) {
          const runs = block.runs.map((run) => run.kind === 'text' ? { ...run, value: restore(run.value) } : { ...run });
          const plain = runs.filter((run) => run.kind === 'text').map((run) => run.value).join('');
          const content = letters(plain);
          if (!content && !runs.some((run) => run.kind === 'equation')) continue;
          if (content && !indexed.includes(content)) return reject(`색인과 일치하지 않는 문단 (${plain.trim().slice(0, 70)})`);
          if (/^[①②③④⑤]/u.test(plain.trimStart())) {
            if (!blocks.length) return reject('지문 첫 문단의 선지 기호를 본문과 연결할 수 없습니다.');
            blocks.at(-1).runs.push({ kind: 'text', value: ' ' }, ...runs);
          } else blocks.push({ role: 'passage', label: '', runs });
        }
      }
      return blocks.length ? blocks : reject('PDF에서 지문 본문을 찾지 못했습니다.');
    };
    const blocks = await extract();
    deps.signal?.throwIfAborted();
    // Only completed extractions are kept: a failed download is retried by the next question.
    cache.set(key, { blocks: structuredClone(blocks), notes: [...notes] });
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    return finish(blocks);
  } catch (error) {
    deps.signal?.throwIfAborted();
    return finish(reject(error instanceof Error ? error.message : String(error)));
  }
}
