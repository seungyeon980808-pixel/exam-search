import { readQuestionPdf } from './pdf-viewer.mjs';
import { inQuestion, verifiedGlyphMap } from './live-fonts.mjs';

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
  }, '').replace(/\\lambda\s+([a-z])/gu, '\\lambda_{$1}');
}

function clipItems(question, pdf, glyphs) {
  return pdf.content.items.filter((item) => inQuestion(item, question, pdf.pageHeight))
    .map((item) => ({ x: item.transform[4], y: item.transform[5], width: item.width,
      height: item.height || 0,
      raw: item.str, value: textFor(item, glyphs),
      math: pdf.fonts[item.fontName]?.name?.split('+').at(-1) === 'HyhwpEQ' }));
}

function findLines(items) {
  const lines = [];
  for (const item of items.filter((value) => !value.math && value.raw.trim())
    .sort((left, right) => right.y - left.y)) {
    const line = lines.find((entry) => Math.abs(entry.y - item.y) < 2.5);
    if (line) line.anchors.push(item);
    else lines.push({ y: item.y, anchors: [item], items: [] });
  }
  for (const item of items) {
    const line = [...lines].sort((left, right) => Math.abs(left.y - item.y) - Math.abs(right.y - item.y))[0];
    if (line && Math.abs(line.y - item.y) < 13) line.items.push({ ...item });
    else if (item.math) lines.push({ y: item.y, anchors: [], items: [{ ...item }] });
  }
  for (const line of lines.filter((entry) => !entry.anchors.length)) {
    const ranked = [...line.items].sort((left, right) => right.height - left.height
      || right.width - left.width);
    const primary = ranked[0];
    if (ranked.some((item) => item !== primary
      && Math.abs(item.height - primary.height) < 0.5
      && Math.abs(item.width - primary.width) < 0.5
      && Math.abs(item.y - primary.y) > 2.3)) {
      throw new Error('독립 수식 줄의 기준선을 확인할 수 없습니다.');
    }
    line.y = primary.y;
  }
  return lines.sort((left, right) => right.y - left.y);
}

function recoverFractions(items) {
  const consumed = new Set();
  const additions = [];
  for (const bar of items.filter((item) => item.math && item.value.includes('\\frac'))) {
    const near = items.filter((item) => item !== bar && item.math
      && item.x >= bar.x - 3 && item.x <= bar.x + bar.width + 2
      && Math.abs(item.y - bar.y) < 18);
    const above = near.filter((item) => item.y - bar.y > 2.5).sort((a, b) => a.x - b.x);
    const below = near.filter((item) => bar.y - item.y > 2.5).sort((a, b) => a.x - b.x);
    if (!above.length && below.length) {
      consumed.add(bar);
      for (const part of below) consumed.add(part);
      additions.push({ x: bar.x, y: bar.y, width: bar.width, math: true,
        value: `\\bar{${below.map((part) => part.value.trim()).join('')}}` });
      continue;
    }
    if (!above.length || !below.length) {
      throw new Error('PDF의 분자·분모 위치를 확인할 수 없습니다.');
    }
    consumed.add(bar);
    for (const part of [...above, ...below]) consumed.add(part);
    const numerator = recoverSubscripts(above, Math.max(...above.map((part) => part.y)));
    additions.push({ x: bar.x, y: bar.y, width: bar.width, math: true,
      value: `\\frac{${numerator.map((part) => part.value.trim()).join('')}}{${below.map((part) => part.value.trim()).join('')}}` });
  }
  return [...items.filter((item) => !consumed.has(item)), ...additions];
}

function recoverNuclearScripts(items, baseline) {
  const ordered = [...items].sort((left, right) => left.x - right.x);
  const removed = new Set();
  for (const lower of ordered) {
    if (!lower.math || !/^\d+$/u.test(lower.value.trim())
      || baseline - lower.y < 2 || baseline - lower.y > 8) continue;
    const upper = ordered.find((item) => item !== lower && item.math
      && /^\d+$/u.test(item.value.trim()) && Math.abs(item.x - lower.x) < 1
      && item.y - baseline > 2 && item.y - baseline < 8);
    const symbol = ordered.find((item) => item.math && item.x >= lower.x + lower.width - 0.5
      && item.x - lower.x - lower.width < 3 && /^[A-Za-z]/u.test(item.value));
    if (!upper || !symbol) continue;
    symbol.value = `{}^{${upper.value.trim()}}_{${lower.value.trim()}}${symbol.value}`;
    removed.add(lower);
    removed.add(upper);
  }
  return ordered.filter((item) => !removed.has(item));
}

function recoverSubscripts(items, baseline) {
  const ordered = [...items].sort((left, right) => left.x - right.x);
  const removed = new Set();
  for (const item of ordered) {
    if (!item.math || baseline - item.y < 2.3 || baseline - item.y > 8
      || !/^[A-Za-z0-9]+$/u.test(item.value.trim())) continue;
    const parent = ordered.filter((candidate) => candidate !== item && candidate.math
      && candidate.x + candidate.width <= item.x + 1
      && item.x - candidate.x - candidate.width < 8)
      .sort((left, right) => right.x - left.x)[0];
    if (!parent) throw new Error(`수식의 아래 첨자 ${item.value} (${item.x}, ${item.y})가 연결될 대상을 찾지 못했습니다.`);
    parent.value = `${parent.value.trimEnd()}_{${item.value.trim()}}`;
    parent.width = item.x + item.width - parent.x;
    removed.add(item);
  }
  return ordered.filter((item) => !removed.has(item));
}

function recoverSuperscripts(items, baseline) {
  const ordered = [...items].sort((left, right) => left.x - right.x);
  const removed = new Set();
  for (const item of ordered) {
    if (!item.math || item.y - baseline < 2.3 || item.y - baseline > 8
      || !/^[A-Za-z0-9]+$/u.test(item.value.trim())) continue;
    const parent = ordered.filter((candidate) => candidate !== item && candidate.math
      && candidate.x + candidate.width <= item.x + 1
      && item.x - candidate.x - candidate.width < 8)
      .sort((left, right) => right.x - left.x)[0];
    if (!parent) throw new Error(`수식의 위 첨자 ${item.value} (${item.x}, ${item.y})가 연결될 대상을 찾지 못했습니다.`);
    parent.value = `${parent.value.trimEnd()}^{${item.value.trim()}}`;
    parent.width = item.x + item.width - parent.x;
    removed.add(item);
  }
  return ordered.filter((item) => !removed.has(item));
}

function lineRuns(line) {
  const items = recoverSuperscripts(recoverSubscripts(
    recoverNuclearScripts(recoverFractions(line.items), line.y), line.y), line.y)
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

function appendLine(block, runs) {
  if (block.runs.length) block.runs.push({ kind: 'text', value: ' ' });
  block.runs.push(...runs);
}

export function buildLiveStructure(question, pdf, glyphs) {
  const lines = findLines(clipItems(question, pdf, glyphs));
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
        let block = blocks.at(-1);
        if (!block || block.role !== current) {
          block = { role: current, label: '', runs: [] };
          blocks.push(block);
        }
        appendLine(block, currentRuns);
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
  if (choiceCount !== 5 || !blocks.some((block) => block.role === 'stem')) {
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
