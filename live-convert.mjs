import { readQuestionPdf } from './pdf-viewer.mjs';
import { inQuestion, verifiedGlyphMap } from './live-fonts.mjs';
import { radicalBarFor, recoverEquationItems, recoverPiecewiseItems } from './live-equations.mjs';

function textFor(item, glyphs) {
  const decoded = [...item.str].map((char) => {
    if (!/[\uE000-\uF8FF]/u.test(char)) return char;
    const formula = glyphs.get(`${item.fontName}:${char.codePointAt(0)}`);
    if (!formula) throw new Error('검증되지 않은 수식 글자가 남았습니다.');
    return formula;
  });
  return decoded.reduce((result, value) => {
    const separator = /\\[A-Za-z]+$/u.test(result) && /^[A-Za-z]/u.test(value) ? ' ' : '';
    return result + separator + value;
  }, '');
}

/** KICE often sets subscripts such as U_A in the text font beside an equation-font base. */
export function attachTextScripts(items) {
  const bases = items.filter((item) => item.math && /^[A-Za-z\\]/u.test(item.value.trim()));
  return items.map((item) => {
    if (item.math || !/^[A-Za-z0-9]{1,3}$/u.test(item.value.trim())) return item;
    const base = bases.find((candidate) => item.height > 0 && item.height <= candidate.height * 0.8
      && item.x - (candidate.x + candidate.width) >= -1 && item.x - (candidate.x + candidate.width) <= 1.5
      && Math.abs(item.y - candidate.y) >= 2.3 && Math.abs(item.y - candidate.y) <= candidate.height * 0.7);
    return base ? { ...item, value: item.value.trim(), math: true } : item;
  });
}

function clipItems(question, pdf, glyphs) {
  const advances = new Map(pdf.glyphs?.map((glyph) =>
    [`${glyph.fontId}:${glyph.codepoint}`, glyph.advance]) || []);
  const source = pdf.equationItems ? [...pdf.content.items.filter((item) =>
    !/^(?:HyhwpEQ|HYhwpEQ)/u.test(pdf.fonts[item.fontName]?.name?.split('+').at(-1) || '')),
  ...pdf.equationItems] : pdf.content.items;
  return attachTextScripts(source.filter((item) => inQuestion(item, question, pdf.pageHeight))
    .flatMap((item) => {
      const base = { x: item.transform[4], y: item.transform[5], width: item.width,
      height: item.height || 0,
      raw: item.str, value: textFor(item, glyphs),
      math: /^(?:HyhwpEQ|HYhwpEQ)/u.test(pdf.fonts[item.fontName]?.name?.split('+').at(-1) || '') };
      if (!base.math || !/[\uE05C\uE06D\uE06E]/u.test(item.str) || [...item.str.trim()].length < 2) return [base];
      const chars = [...item.str];
      const widths = chars.map((char) => advances.get(`${item.fontName}:${char.codePointAt(0)}`)
        ?? (/\s/u.test(char) ? 0 : undefined));
      if (widths.some((width) => !Number.isFinite(width))) {
        throw new Error('수식 구조 글자의 실제 너비를 확인할 수 없습니다.');
      }
      const total = widths.reduce((sum, width) => sum + width, 0);
      if (total <= 0) throw new Error('수식 구조 글자의 실제 너비가 없습니다.');
      let x = base.x;
      return chars.map((char, index) => {
        const width = base.width * widths[index] / total;
        const part = { ...base, x, width, raw: char, value: textFor({ str: char, fontName: item.fontName }, glyphs) };
        x += width;
        return part;
      });
    }));
}

function findLines(items) {
  const lines = [];
  for (const item of items.filter((value) => !value.math && value.raw.trim())
    .sort((left, right) => right.y - left.y)) {
    const line = lines.find((entry) => Math.abs(entry.y - item.y) < 2.5);
    if (line) line.anchors.push(item);
    else lines.push({ y: item.y, anchors: [item], items: [] });
  }
  const bars = items.filter((item) => item.math && item.raw === '\uE06D');
  // A radical's top bar must stay on the radical's line; it never encloses a fraction's parts.
  const radicalOf = new Map();
  for (const radical of items.filter((item) => item.math && item.raw === '\uE05C')) {
    const bar = radicalBarFor(radical, bars);
    if (bar) radicalOf.set(bar, radical);
  }
  // A bar capped by a vector head is an arrow over the letters below it, never a fraction.
  const heads = items.filter((item) => item.math && item.raw === '\uE06E');
  const vectorBars = new Set(bars.filter((bar) => heads.some((head) =>
    Math.abs(head.x - (bar.x + bar.width)) <= 3 && Math.abs(head.y - bar.y) <= 3)));
  const fractionBars = bars.filter((bar) => !radicalOf.has(bar) && !vectorBars.has(bar));
  const placement = (item) => {
    if (radicalOf.has(item)) return placement(radicalOf.get(item));
    if (vectorBars.has(item) || (item.raw === '\uE06E' && heads.includes(item))) return item.y - item.height * 0.45;
    const enclosing = fractionBars.filter((bar) => item === bar || (item.math
      && item.x + item.width / 2 >= bar.x && item.x + item.width / 2 <= bar.x + bar.width
      && Math.abs(item.y - bar.y) < 18)).sort((a, b) => Math.abs(item.y - a.y) - Math.abs(item.y - b.y)
        || a.width - b.width)[0];
    return enclosing ? enclosing.y + enclosing.height * 0.35
      : /^\\sum$/u.test(item.value) ? item.y + item.height * 0.17 : item.y;
  };
  for (const item of [...items].sort((a, b) => Number(b.raw === '\uE06D') - Number(a.raw === '\uE06D')
    || b.height - a.height)) {
    const placementY = placement(item);
    const line = [...lines].sort((left, right) => Math.abs(left.y - placementY) - Math.abs(right.y - placementY))[0];
    if (line && Math.abs(line.y - placementY) < Math.max(13,
      ...line.anchors.map((anchor) => anchor.height * 1.7))) line.items.push({ ...item });
    else if (item.math) lines.push({ y: placementY, anchors: [], items: [{ ...item }] });
  }
  for (const line of lines.filter((entry) => !entry.anchors.length)) {
    const candidates = line.items.filter((item) => !/[\uE05C\uE06D\uE06E]/u.test(item.raw)
      && !/^\\(?:sum|int|prod)/u.test(item.value));
    const score = (item) => candidates.filter((other) => Math.abs(other.height - item.height) < 1
      && Math.abs(other.y - item.y) < 1.5).length * Math.max(1, item.height) ** 2;
    const ranked = [...(candidates.length ? candidates : line.items)].sort((left, right) => score(right) - score(left)
      || right.height - left.height || right.width - left.width);
    const primary = ranked[0];
    if (ranked.some((item) => item !== primary
      && score(item) === score(primary) && Math.abs(item.height - primary.height) < 0.5
      && Math.abs(item.width - primary.width) < 0.5
      && Math.abs(item.y - primary.y) > 2.3)) {
      throw new Error('독립 수식 줄의 기준선을 확인할 수 없습니다.');
    }
    line.y = primary.y;
  }
  return lines.sort((left, right) => right.y - left.y);
}

function lineRuns(line) {
  const items = recoverEquationItems(line.items, line.y)
    .sort((left, right) => left.x - right.x || right.y - left.y);
  const runs = [];
  let previous = null;
  for (const item of items) {
    if (!item.value) continue;
    const kind = item.math ? 'equation' : 'text';
    const value = item.value;
    const last = runs.at(-1);
    if (last?.kind === kind) {
      const gap = previous ? item.x - previous.x - previous.width : 0;
      if (kind === 'equation' && gap > 5) runs.push({ kind, script: value });
      else if (kind === 'equation') last.script += value;
      else last.value += gap > 1.5 && !/\s$/u.test(last.value) && !/^\s/u.test(value)
        && /[\p{L}\p{N}]$/u.test(last.value) && /^[\p{L}\p{N}]/u.test(value)
        ? ` ${value}` : value;
    } else runs.push(kind === 'equation' ? { kind, script: value } : { kind, value });
    previous = item;
  }
  return runs;
}

export function buildLiveStructure(question, pdf, glyphs) {
  const lines = findLines(recoverPiecewiseItems(clipItems(question, pdf, glyphs)));
  const blocks = [];
  let role = 'stem';
  let choiceCount = 0;
  let markers = 0;
  for (const line of lines) {
    if (choiceCount === 5) break;
    const runs = lineRuns(line);
    const plain = runs.map((run) => run.kind === 'text' ? run.value : '').join('').trim();
    if (!runs.length || /^<보\s*기>$/u.test(plain)) continue;
    if (/저작권은\s*한국교육과정평가원/u.test(plain) || (/^\d{1,2}$/u.test(plain) && runs.every((run) => run.kind === 'text'))) continue;
    if (/^\d{1,2}\./u.test(plain)) {
      const first = runs.find((run) => run.kind === 'text');
      first.value = first.value.replace(/^\s*\d{1,2}\.\s*/u, '');
    }
    if (/^이에 대한|^이에 관한|^이에 대해/u.test(plain)) role = 'ask';
    if (/^[ㄱㄴㄷ]\./u.test(plain)) {
      role = 'bogi';
      const label = plain[0];
      const first = runs.find((run) => run.kind === 'text');
      first.value = first.value.replace(/^\s*[ㄱㄴㄷ]\.\s*/u, '');
      blocks.push({ role, label, runs });
      continue;
    }
    let current = role;
    let currentRuns = [];
    const lineHasMarker = runs.some((run) => run.kind === 'text' && /[①②③④⑤]/u.test(run.value));
    if (role === 'choice' && !lineHasMarker) {
      // Wrapped choice text or figure labels continue the previous choice.
      blocks.findLast((block) => block.role === 'choice')?.runs.push({ kind: 'text', value: ' ' }, ...runs);
      continue;
    }
    const flush = () => {
      if (!currentRuns.length) return;
      if (current === 'choice') {
        const label = '①②③④⑤'[choiceCount++];
        const own = !currentRuns.some((run) => run.kind === 'equation' ? run.script?.trim() : run.value?.trim());
        blocks.push({ role: current, label, runs: currentRuns, own });
      } else {
        blocks.push({ role: current, label: '', runs: currentRuns });
      }
      currentRuns = [];
    };
    for (const run of runs) {
      if (run.kind !== 'text') { currentRuns.push(run); continue; }
      const parts = run.value.split(/([①②③④⑤])/u);
      for (const part of parts) {
        if (!part) continue;
        if (/^[①②③④⑤]$/u.test(part)) {
          flush();
          if (current === 'choice' && !currentRuns.length && role === 'choice' && markers > choiceCount) {
            blocks.push({ role: 'choice', label: '①②③④⑤'[choiceCount++], runs: [], own: true });
          }
          markers += 1;
          current = 'choice';
          role = 'choice';
        } else currentRuns.push({ kind: 'text', value: part });
      }
    }
    flush();
    if (current === 'choice' && markers > choiceCount) {
      blocks.push({ role: 'choice', label: '①②③④⑤'[choiceCount++], runs: [], own: true });
    }
  }
  const notes = ['원본 PDF에서 브라우저가 변환했습니다. 그림·도표는 생략했습니다.'];
  const choices = blocks.filter((block) => block.role === 'choice');
  // Drawn choices keep only axis ticks or stray labels, even after wrapped lines are joined.
  const token = (run) => run.kind === 'equation' ? run.script.trim() : run.value.trim();
  // Page watermarks such as "물리학 II" can bleed into drawn choices beside the graph.
  // Graph axes add short labels like "x 0 시간 B"; none of them is longer than a word.
  const drawn = (block) => block.runs.every((run) => run.kind === 'text'
    && token(run).split(/\s+/u).every((word) => /^(?:[\d.,()+\-÷*]*|\p{L}|II|Ⅱ|I|Ⅰ|시간|위치|속도|거리)$/u.test(word)));
  if (question.responseType !== 'short_answer' && markers === 5 && choices.length === 5
    && choices.some((block) => block.own && drawn(block)) && choices.every(drawn)) {
    // Graph or diagram choices have only their ①~⑤ labels as text. Keep the editable
    // stem and mark each choice for comparison with the original.
    blocks.splice(0, blocks.length, ...blocks.filter((block) => block.role !== 'choice'),
      ...[...'①②③④⑤'].map((label) => ({ role: 'choice', label,
        runs: [{ kind: 'text', value: '(선지는 원본 참고)' }] })));
    choiceCount = 5;
    notes.push('선지가 그림이거나 자동으로 옮길 수 없어 선지 자리에는 원본 참고 표시만 넣었습니다.');
  }
  if ((question.responseType !== 'short_answer' && choiceCount !== 5)
    || !blocks.some((block) => block.role === 'stem')) {
    throw new Error('원본 PDF에서 본문과 선지 다섯 개를 모두 분리하지 못했습니다.');
  }
  return { schema: 'exam-editable-v1', questionId: question.id,
    title: question.title, number: question.no, sourcePdf: question.pdfFile,
    page: question.page, status: 'needs_review', blocks,
    notes };
}

export async function convertQuestionNow(question) {
  const pdf = await readQuestionPdf(question);
  const glyphs = await verifiedGlyphMap(question, pdf);
  return buildLiveStructure(question, pdf, glyphs);
}
