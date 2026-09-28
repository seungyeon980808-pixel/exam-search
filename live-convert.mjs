import { readQuestionPdf } from './pdf-viewer.mjs';
import { inQuestion, verifiedGlyphMap } from './live-fonts.mjs';
import { recoverEquationItems, recoverPiecewiseItems } from './live-equations.mjs';

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

function clipItems(question, pdf, glyphs) {
  const advances = new Map(pdf.glyphs?.map((glyph) =>
    [`${glyph.fontId}:${glyph.codepoint}`, glyph.advance]) || []);
  const source = pdf.equationItems ? [...pdf.content.items.filter((item) =>
    !/^(?:HyhwpEQ|HYhwpEQ)/u.test(pdf.fonts[item.fontName]?.name?.split('+').at(-1) || '')),
  ...pdf.equationItems] : pdf.content.items;
  return source.filter((item) => inQuestion(item, question, pdf.pageHeight))
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
    });
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
  for (const item of [...items].sort((a, b) => Number(b.raw === '\uE06D') - Number(a.raw === '\uE06D')
    || b.height - a.height)) {
    const enclosing = bars.filter((bar) => item === bar || (item.math
      && item.x + item.width / 2 >= bar.x && item.x + item.width / 2 <= bar.x + bar.width
      && Math.abs(item.y - bar.y) < 18)).sort((a, b) => Math.abs(item.y - a.y) - Math.abs(item.y - b.y)
        || a.width - b.width)[0];
    const placementY = enclosing ? enclosing.y + enclosing.height * 0.35
      : /^\\sum$/u.test(item.value) ? item.y + item.height * 0.17 : item.y;
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
  for (const line of lines) {
    if (choiceCount === 5) break;
    const runs = lineRuns(line);
    const plain = runs.map((run) => run.kind === 'text' ? run.value : '').join('').trim();
    if (!runs.length || /^<보\s*기>$/u.test(plain)) continue;
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
    const flush = () => {
      if (!currentRuns.length) return;
      if (current === 'choice') {
        const label = '①②③④⑤'[choiceCount++];
        blocks.push({ role: current, label, runs: currentRuns });
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
          current = 'choice';
          role = 'choice';
        } else currentRuns.push({ kind: 'text', value: part });
      }
    }
    flush();
  }
  if ((question.responseType !== 'short_answer' && choiceCount !== 5)
    || !blocks.some((block) => block.role === 'stem')) {
    throw new Error('원본 PDF에서 본문과 선지 다섯 개를 모두 분리하지 못했습니다.');
  }
  return { schema: 'exam-editable-v1', questionId: question.id,
    title: question.title, number: question.no, sourcePdf: question.pdfFile,
    page: question.page, status: 'needs_review', blocks,
    notes: ['원본 PDF에서 브라우저가 변환했습니다. 그림·도표는 생략했습니다.'] };
}

export async function convertQuestionNow(question) {
  const pdf = await readQuestionPdf(question);
  const glyphs = await verifiedGlyphMap(question, pdf);
  return buildLiveStructure(question, pdf, glyphs);
}
