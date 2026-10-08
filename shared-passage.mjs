import { restoreFigures, withoutFigures } from './figure-fallback.mjs?v=library-20261008-3';
import { validateParagraphs } from './editable-convert.mjs?v=readability-20261004-4';
import { restoreProseBlocks } from './prose-flow.mjs?v=readability-20261004-4';
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
  deps.signal?.throwIfAborted();
  const includeImages = deps.includeImages === true;
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
    const read = deps.readQuestionPdf || (await import('./pdf-viewer.mjs?v=library-20261008-3')).readQuestionPdf;
    const glyphMap = deps.glyphMap || (await import('./live-fonts.mjs')).verifiedGlyphMap;
    const build = deps.build || (await import('./live-convert.mjs?v=library-20261008-3')).buildLiveStructure;
    const cache = passageCache.get(read) ?? new Map();
    passageCache.set(read, cache);
    const key = JSON.stringify([passageKey(question), indexed, includeImages]);
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
        const pdf = await read(item, { signal: deps.signal });
        const glyphs = await glyphMap(item, pdf);
        const protectedPdf = { ...pdf, content: { ...pdf.content,
          items: pdf.content.items.map((entry) => ({ ...entry, str: protect(entry.str || '') })) } };
        const structure = build(item, protectedPdf, glyphs, { includeImages, signal: deps.signal });
        const native = withoutFigures(structure);
        validateParagraphs(native.blocks.map((block) => block.runs));
        // Compare the native passage before any optional crop. An unreadable drawing
        // must not discard otherwise valid shared text or defer its validation.
        for (const block of native.blocks) {
          const plain = block.runs.filter((run) => run.kind === 'text').map((run) => restore(run.value)).join('');
          const content = letters(plain);
          if (content && !indexed.includes(content)) return reject(`색인과 일치하지 않는 문단 (${plain.trim().slice(0, 70)})`);
        }
        // Use the already read PDF for optional detection, still inside the bounded,
        // best-effort operation rather than letting detection reject the whole passage.
        const enriched = includeImages ? await restoreFigures(item, structure,
          { ...deps, readQuestionPdf: async () => pdf, bestEffort: true }) : native;
        if (includeImages) notes.push(...(enriched.notes || []).filter((note) => /그림.*(?:제외했습니다|원본 이미지로)/u.test(note)));
        const extracted = enriched.blocks;
        for (const block of extracted) {
          if (block.kind === 'figure') { blocks.push(block); continue; }
          const runs = block.runs.map((run) => run.kind === 'text' ? { ...run, value: restore(run.value) } : { ...run });
          const plain = runs.filter((run) => run.kind === 'text').map((run) => run.value).join('');
          const content = letters(plain);
          if (!content && !runs.some((run) => run.kind === 'equation')) continue;
          if (content && !indexed.includes(content)) return reject(`색인과 일치하지 않는 문단 (${plain.trim().slice(0, 70)})`);
          if (/^[①②③④⑤]/u.test(plain.trimStart())) {
            const previous = blocks.findLast((candidate) => candidate.kind !== 'figure');
            if (!previous) return reject('지문 첫 문단의 선지 기호를 본문과 연결할 수 없습니다.');
            previous.runs.push({ kind: 'text', value: ' ' }, ...runs);
          } else blocks.push({ role: 'passage', label: '', runs, sourceLine: block.sourceLine });
        }
      }
      return blocks.length ? restoreProseBlocks(blocks, { referenceText: question.text.slice(0, split), preserveVerse: question.subject === 'kor' })
        : reject('PDF에서 지문 본문을 찾지 못했습니다.');
    };
    const blocks = await extract();
    deps.signal?.throwIfAborted();
    // Only completed extractions are kept: a failed download is retried by the next question.
    // Optional image failures may be transient. A new conversion should be able to
    // retry them, while successful include/exclude variants each retain their cache.
    if (!notes.some((note) => /그림.*제외했습니다/u.test(note))) {
      cache.set(key, { blocks: structuredClone(blocks), notes: [...notes] });
      if (cache.size > 24) cache.delete(cache.keys().next().value);
    }
    return finish(blocks);
  } catch (error) {
    deps.signal?.throwIfAborted();
    return finish(reject(error instanceof Error ? error.message : String(error)));
  }
}
