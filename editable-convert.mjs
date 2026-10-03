import { typography, bodyCharFormat, paragraphFormat } from './document-typography.mjs?v=typography-20261003-3';
// --- data-table hook
import { insertDataTable, validateDataTable } from './hwp-tables.mjs?v=readability-20261004-4';
import { restoreProseBlocks } from './prose-flow.mjs?v=readability-20261004-4';
import { repairEquationSpacing } from './equation-spacing.mjs?v=typography-20261003-3';
import { findMathChoiceGroups, insertChoiceLayout } from './math-choice-layout.mjs?v=readability-20261004-4';
let corePromise;

export function groupFractions(script) {
  let result = '';
  for (let offset = 0; offset < script.length;) {
    const group = script[offset] === '{' && balancedFormula(script, offset);
    if (!group) { result += script[offset++]; continue; }
    const over = /^\s+over\s*\{/u.exec(script.slice(group[1]));
    const denominator = over && balancedFormula(script, group[1] + over[0].length - 1);
    if (denominator) {
      result += `{{${groupFractions(group[0])}} over {${groupFractions(denominator[0])}}}`;
      offset = denominator[1];
    } else {
      result += `{${groupFractions(group[0])}}`;
      offset = group[1];
    }
  }
  return result.replace(/([=<>+])/gu, ' $1 ');
}

function balancedFormula(text, opening) {
  let depth = 0;
  for (let index = opening; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}' && --depth === 0) return [text.slice(opening + 1, index), index + 1];
  }
  return null;
}

export function equationScript(source) {
  let value = source.trim();
  for (const match of [...value.matchAll(/\\sqrt\s*\[([^\[\]]+)\]\s*\{/gu)].reverse()) {
    const body = balancedFormula(value, match.index + match[0].length - 1);
    if (!body) continue;
    value = `${value.slice(0, match.index)}root {${equationScript(match[1])}} of {${equationScript(body[0])}}${value.slice(body[1])}`;
  }
  for (let count = 0; count < 12; count += 1) {
    const match = /\\?frac\s*\{/u.exec(value);
    if (!match) break;
    const numerator = balancedFormula(value, match.index + match[0].length - 1);
    if (!numerator) break;
    const denominatorAt = value.indexOf('{', numerator[1]);
    if (denominatorAt < 0 || value.slice(numerator[1], denominatorAt).trim()) break;
    const denominator = balancedFormula(value, denominatorAt);
    if (!denominator) break;
    value = `${value.slice(0, match.index)}{${equationScript(numerator[0])}} over {${equationScript(denominator[0])}}${value.slice(denominator[1])}`;
  }
  for (const match of [...value.matchAll(/\\(text|mathrm|mathbf|mathit)\s*\{/gu)].reverse()) {
    const group = balancedFormula(value, match.index + match[0].length - 1);
    if (!group) continue;
    const replacement = match[1] === 'text' ? ` "${group[0]}"`
      : `{${{ mathrm: 'rm', mathbf: 'bold', mathit: 'it' }[match[1]]} ${equationScript(group[0])}}`;
    value = value.slice(0, match.index) + replacement + value.slice(group[1]);
  }
  value = value.replace(/>=/gu, '≥').replace(/<=/gu, '≤')
    .replace(/([A-Za-z0-9])\\([{}])/gu, '$1 \\$2')
    .replace(/\\\{/gu, 'LEFT {').replace(/\\\}/gu, 'RIGHT }')
    .replace(/\\([A-Za-z]+)/gu, (match, command, offset, text) =>
      `${offset && /[A-Za-z0-9]/u.test(text[offset - 1]) ? ' ' : ''}${command}`)
    .replace(/\s+/gu, ' ').trim();
  // Hancom otherwise attaches the script to the decorated argument, not the whole accent.
  return value.split(/("[^"]*")/u).map((part, index) => {
    if (index % 2) return part;
    for (const match of [...part.matchAll(/\b(?:bar|vec)\s*\{/gu)].reverse()) {
      const group = balancedFormula(part, match.index + match[0].length - 1);
      if (group && /^\s*[_^]/u.test(part.slice(group[1]))) {
        part = `${part.slice(0, match.index)}{${part.slice(match.index, group[1])}}${part.slice(group[1])}`;
      }
    }
    return part.replace(/(?:LEFT\s+)?\|([^|]+?)(?:RIGHT\s+)?\|\s*(?=[_^])/gu,
      (_, argument) => `{LEFT | ${argument.trim()} RIGHT |}`);
  }).join('');
}

export function contentRuns(text) {
  const runs = [];
  const expression = /\\수식\{|\\\(|\$/gu;
  let offset = 0;
  for (const match of text.matchAll(expression)) {
    if (match.index < offset) continue;
    let formula;
    if (match[0] === '\\수식{') formula = balancedFormula(text, match.index + match[0].length - 1);
    else {
      const endMarker = match[0] === '$' ? '$' : '\\)';
      const end = text.indexOf(endMarker, match.index + match[0].length);
      if (end >= 0) formula = [text.slice(match.index + match[0].length, end), end + endMarker.length];
    }
    if (!formula) continue;
    if (match.index > offset) runs.push({ kind: 'text', value: text.slice(offset, match.index) });
    runs.push({ kind: 'equation', script: equationScript(formula[0]) });
    offset = formula[1];
  }
  if (offset < text.length) runs.push({ kind: 'text', value: text.slice(offset) });
  return runs;
}

export function paragraphsForText(text, number) {
  const normalized = text.replace(/\r\n?/gu, '\n').replace(/`/gu, '').trim();
  if (!normalized || /^\s*\d+\.\s*(?:\(cid:\d+\)\s*){3}/u.test(normalized)) return [];
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const paragraphs = [];
  for (const line of lines) {
    const pieces = line.split(/(?=[①②③④⑤])/u).filter(Boolean);
    for (const piece of pieces) {
      const value = piece.trim();
      if (value) paragraphs.push(contentRuns(value));
    }
  }
  if (paragraphs.length && !new RegExp(`^${number}\\.`).test(lines[0])) {
    paragraphs[0].unshift({ kind: 'text', value: `${number}. ` });
  }
  return paragraphs;
}

export function paragraphsForPrepared(question) {
  if (question.schema !== 'exam-editable-v1' || question.status !== 'needs_review'
    || !Array.isArray(question.blocks) || !question.blocks.length) {
    throw new Error('지원하지 않는 편집 문항 데이터입니다.');
  }
  const paragraphs = [];
  let previousRole = '';
  let numbered = false;
  for (const block of restoreProseBlocks(question.blocks, { referenceText: question.flowReference || '', inlineChoices: question.inlineChoices === true,
    preserveVerse: question.subject === 'kor' })) {
    if (block.kind === 'figure') {
      paragraphs.push([block.runs[0]]);
      continue;
    }
    // --- data-table hook
    if (block.kind === 'table') {
      if (block.role === 'choice') throw new Error('선지 안의 표는 변환할 수 없습니다.');
      paragraphs.push([{ kind: 'table', table: block }]);
      continue;
    }
    if (block.role !== previousRole && ['ask', 'bogi', 'choice'].includes(block.role)) {
      paragraphs.push([]);
    }
    if (block.role === 'bogi' && previousRole !== 'bogi') {
      paragraphs.push([{ kind: 'text', value: '<보기>' }]);
    }
    const label = block.role === 'stem' && !numbered ? `${question.number}. `
      : block.role === 'choice' ? `${block.label} `
        : block.label ? `${block.label}. ` : '';
    paragraphs.push([
      ...(label ? [{ kind: 'text', value: label }] : []),
      ...block.runs,
    ]);
    previousRole = block.role;
    if (block.role === 'stem') numbered = true;
  }
  return paragraphs;
}

export function insertRuns(document, paragraphIndex, runs) {
  validateParagraphs([runs]);
  let text = '';
  const equations = [];
  for (const run of runs) {
    if (run.kind === 'equation') equations.push({ offset: text.length, script: run.script });
    else text += run.value;
  }
  if (text) {
    const result = JSON.parse(document.insertText(0, paragraphIndex, 0, text));
    if (!result.ok) throw new Error(`${paragraphIndex + 1}번째 문단의 텍스트를 삽입하지 못했습니다.`);
  }
  for (const equation of equations.reverse()) {
    const result = JSON.parse(document.insertEquation(0, paragraphIndex, equation.offset, groupFractions(equationScript(equation.script)), typography.equation, 0));
    if (!result.ok) throw new Error(`${paragraphIndex + 1}번째 문단의 수식을 삽입하지 못했습니다.`);
  }
  if (!JSON.parse(document.applyCharFormat(0, paragraphIndex, 0, document.getLogicalLength(0, paragraphIndex),
    JSON.stringify(bodyCharFormat))).ok) throw new Error('본문 글자 크기를 설정하지 못했습니다.');
}

function configurePage(document) {
  const page = JSON.parse(document.getPageDef(0));
  page.marginLeft = 2835;
  page.marginRight = 2835;
  page.marginTop = 3402;
  page.marginBottom = 3402;
  page.marginHeader = 0;
  page.marginFooter = 0;
  const result = JSON.parse(document.setPageDef(0, JSON.stringify(page)));
  if (!result.ok) throw new Error('편집 문서의 쪽 여백을 설정하지 못했습니다.');
  if (!JSON.parse(document.setColumnDef(0, 2, 0, 1, 1700)).ok) throw new Error('2단을 설정하지 못했습니다.');
  // The reserved section-control paragraph should not add a full blank line above the first question.
  document.applyParaFormat(0, 0, JSON.stringify({ lineSpacing: 100, lineSpacingType: 'Percent', spacingBefore: 0, spacingAfter: 0 }));
  return Math.floor((page.width - page.marginLeft - page.marginRight - 1700) / 2);
}

async function core() {
  if (!corePromise) {
    corePromise = import('./vendor/rhwp-studio/assets/rhwp-core.js').then(async ({ default: init, HwpDocument }) => {
      const wasmUrl = new URL('./vendor/rhwp-studio/assets/rhwp_bg-PUGAA2uC.wasm?v=typography-20261003-1', import.meta.url);
      const source = wasmUrl.protocol === 'file:' && typeof process !== 'undefined'
        ? await import('node:fs/promises').then(({ readFile }) => readFile(wasmUrl)) : wasmUrl;
      await init({ module_or_path: source });
      return HwpDocument;
    }).catch((error) => { corePromise = null; throw error; });
  }
  return corePromise;
}

export function safeTextParagraphs(question) {
  if (question.textQuality === 'unreadable') {
    throw new Error('이 문항은 색인 텍스트를 읽을 수 없어 자동 변환할 수 없습니다. PDF 원본을 확인해 주세요.');
  }
  if (/\(cid:\d+\)/u.test(question.text || '')) {
    throw new Error('이 문항은 복원되지 않은 글자가 있어 편집본을 만들지 않았습니다. PDF 원본을 확인해 주세요.');
  }
  const hasUnresolvedMath = /[\uE000-\uF8FF]/u.test(question.text || '');
  if (hasUnresolvedMath) {
    throw new Error('이 문항은 특수 글꼴 수식을 안전하게 복원할 수 없어 편집본을 만들지 않았습니다. PDF 원본과 대조한 편집본이 필요합니다.');
  }
  const text = question.text || '';
  const paragraphs = paragraphsForText(text, question.no);
  if (!paragraphs.length) throw new Error('이 문항은 색인 텍스트를 읽을 수 없어 자동 변환할 수 없습니다. PDF 원본을 확인해 주세요.');
  if (question.responseType !== 'short_answer' && ![...'①②③④⑤'].every((label) => paragraphs.some((runs) => runs[0]?.kind === 'text'
    && runs[0].value.trimStart().startsWith(label)))) {
    throw new Error('이 문항은 선지 다섯 개가 모두 복원되지 않아 편집본을 만들지 않았습니다. PDF 원본을 확인해 주세요.');
  }
  validateQuestionParagraphs(paragraphs, question);
  return paragraphs;
}

export function validateParagraphs(paragraphs) {
  if (!Array.isArray(paragraphs) || !paragraphs.length) throw new Error('문단이 없습니다.');
  for (const runs of paragraphs) {
    if (!Array.isArray(runs)) throw new Error('잘못된 문단입니다.');
    for (const run of runs) {
      if (run?.kind === 'figure') {
        const image = run.image;
        if (runs.length !== 1 || !(image?.bytes instanceof Uint8Array) || !image.bytes.length
          || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) {
          throw new Error('잘못된 그림 영역입니다.');
        }
        continue;
      }
      // --- data-table hook
      if (run?.kind === 'table') {
        if (runs.length !== 1) throw new Error('표는 독립 문단이어야 합니다.');
        validateDataTable(run.table, validateParagraphs);
        continue;
      }
      const value = run?.kind === 'text' ? run.value : run?.kind === 'equation' ? run.script : null;
      if (typeof value !== 'string' || (run.kind === 'equation' && !value.trim())) throw new Error('잘못된 run 또는 빈 수식입니다.');
      if (/\(cid:\d+\)|[\uE000-\uF8FF]/u.test(value)) throw new Error('복원되지 않은 글자 또는 수식입니다.');
      if (/\\brace(?:Top|Middle|Bottom|Extender)/u.test(value)) throw new Error('조립되지 않은 수식 괄호입니다.');
    }
  }
}

export function validateQuestionParagraphs(paragraphs, question = {}) {
  validateParagraphs(paragraphs);
  const lines = paragraphs.map((runs) => runs.map((run) => run.kind === 'text' ? run.value : '수식').join('').trim());
  if (!lines.some((line) => line.replace(/^\d+\.\s*/u, '') && !/^[①②③④⑤]/u.test(line))) throw new Error('본문이 없습니다.');
  if (question.responseType === 'short_answer') return;
  if (question.inlineChoices === true) {
    if ((lines.join('\n').match(/[①②③④⑤]/gu) || []).join('') !== '①②③④⑤') {
      throw new Error('선지 다섯 개가 없거나 중복되었습니다.');
    }
    return;
  }
  for (const label of '①②③④⑤') {
    if (lines.filter((line) => line.startsWith(label)).length !== 1) throw new Error('선지 다섯 개가 없거나 중복되었습니다.');
  }
}

export async function createEditableHwpx(question) {
  const paragraphs = safeTextParagraphs(question);
  return createParagraphDocument(paragraphs, new Map(), {
    mathChoiceGroups: findMathChoiceGroups(paragraphs),
  });
}

export async function createPreparedHwpx(question) {
  const paragraphs = paragraphsForPrepared(question);
  return createParagraphDocument(paragraphs, new Map(), {
    mathChoiceGroups: findMathChoiceGroups(paragraphs),
  });
}

export async function createCollectionHwpx(resolvedItems, { pagePerQuestion = false } = {}) {
  if (!Array.isArray(resolvedItems) || !resolvedItems.length) throw new Error('선택한 문항이 없습니다.');
  const paragraphs = [];
  const anchors = new Map();
  const mathChoiceGroups = [];
  let previousPassage = '';
  for (const [index, item] of resolvedItems.entries()) {
    validateParagraphs(item.paragraphs);
    const start = Number.isInteger(item.questionParagraphStart) && item.questionParagraphStart > 0
      && item.questionParagraphStart < item.paragraphs.length ? item.questionParagraphStart : 0;
    const own = item.paragraphs.slice(start);
    validateQuestionParagraphs(own, item.question);
    mathChoiceGroups.push(...findMathChoiceGroups(own));
    // Questions of one [n～m] set share a passage: print it once, before the first of them.
    const repeated = !pagePerQuestion && start && item.passageKey && item.passageKey === previousPassage;
    previousPassage = start ? item.passageKey || '' : '';
    const caption = [{ kind: 'text', value: item.sourceLabel || item.question?.title || item.questionId || `문항 ${index + 1}` }];
    anchors.set(caption, questionBookmark(item.questionId || item.question?.id || `item-${index}`));
    paragraphs.push(caption);
    paragraphs.push(...(repeated ? own : item.paragraphs));
  }
  return createParagraphDocument(paragraphs, anchors, { pagePerQuestion, mathChoiceGroups });
}

export const questionBookmark = (id) => `exam_question_${encodeURIComponent(id)}`;

/** Resolve saved bookmarks instead of assuming paragraph indexes survive pagination or editing. */
export async function readQuestionTargets(bytes) {
  const HwpDocument = await core();
  const document = new HwpDocument(bytes);
  try {
    return Object.fromEntries(JSON.parse(document.getBookmarks())
      .filter((mark) => mark.name.startsWith('exam_question_'))
      .map((mark) => [decodeURIComponent(mark.name.slice('exam_question_'.length)), {
        kind: 'body_paragraph', section: mark.sec, paragraph: mark.para, charOffset: 0,
        length: document.getParagraphLength(mark.sec, mark.para),
      }]));
  } finally { document.free(); }
}

/** Read native page coordinates without changing the generated document. */
export async function readEditablePageGeometry(bytes) {
  const HwpDocument = await core();
  const document = new HwpDocument(bytes);
  try {
    const page = JSON.parse(document.getPageInfo(0));
    return { width: page.width, columns: page.columns };
  } finally { document.free(); }
}

const plainText = (runs) => runs.map((run) => run.kind === 'text' ? run.value : '').join('').trim();

/** Groups a <보기> title and the ㄱ/ㄴ/ㄷ lines after it into one boxed segment. */
export function documentSegments(paragraphs) {
  const segments = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const runs = paragraphs[index];
    // --- data-table hook
    if (runs[0]?.kind === 'figure') { segments.push({ kind: 'figure', figure: runs[0] }); continue; }
    if (runs[0]?.kind === 'table') { segments.push({ kind: 'table', table: runs[0].table }); continue; }
    if (!/^<\s*보\s*기\s*>$/u.test(plainText(runs).replace(/`/gu, ''))) {
      segments.push({ kind: 'paragraph', runs });
      continue;
    }
    const rows = [];
    let next = index + 1;
    while (next < paragraphs.length && paragraphs[next].length && !['table', 'figure'].includes(paragraphs[next][0]?.kind) && !/^[①②③④⑤]/u.test(plainText(paragraphs[next]))) {
      const continuation = rows.length && !/^[ㄱ-ㅎ]\./u.test(plainText(paragraphs[next]));
      if (continuation) rows.at(-1).push({ kind: 'text', value: ' ' }, ...paragraphs[next]);
      else rows.push([...paragraphs[next]]);
      next += 1;
    }
    if (!rows.some((row) => /^[ㄱ-ㅎ]\./u.test(plainText(row)))) {
      segments.push({ kind: 'paragraph', runs });
      continue;
    }
    segments.push({ kind: 'box', title: '<보기>', rows });
    index = next - 1;
  }
  return segments;
}

const spacing = () => JSON.stringify({ ...paragraphFormat, alignment: 'left',
  keepWithNext: false, keepLines: false, pageBreakBefore: false });

function insertCaption(document, index, runs, bookmark) {
  insertRuns(document, index, runs);
  if (!JSON.parse(document.addBookmark(0, index, 0, bookmark)).ok) throw new Error('문항 이동 표시를 만들지 못했습니다.');
  document.applyCharFormat(0, index, 0, document.getLogicalLength(0, index), JSON.stringify({ fontSize: typography.source }));
  if (!JSON.parse(document.applyParaFormat(0, index, JSON.stringify({ alignment: 'left', lineSpacing: 120,
    lineSpacingType: 'Percent', keepWithNext: true, keepLines: false, pageBreakBefore: false,
    spacingBefore: index > 1 ? 850 : 0, spacingAfter: 250 }))).ok) throw new Error('문항 제목의 간격을 설정하지 못했습니다.');
}

/** Embed only an independently detected figure; ordinary question content stays native. */
function insertFigure(document, index, figure, width) {
  const image = figure.image;
  const page = JSON.parse(document.getPageDef(0));
  const height = page.height - page.marginTop - page.marginBottom - 2500;
  // Match the original physical scale (PDF points -> HWP units), never enlarge small diagrams.
  const scale = Math.min(width / image.width, height / image.height, (figure.sourceColumnWidth > 0 ? width / figure.sourceColumnWidth : 100) / (figure.scale || 2));
  const result = JSON.parse(document.insertPicture(0, index, 0, '', image.bytes,
    Math.floor(image.width * scale), Math.floor(image.height * scale), image.width, image.height,
    'png', '원본 그림·도표'));
  if (!result.ok || !JSON.parse(document.setPictureProperties(0, result.paraIdx, result.controlIdx,
    JSON.stringify({ treatAsChar: true, textWrap: 'TopAndBottom', horzRelTo: 'Para', horzAlign: 'Left' }))).ok) {
    throw new Error('그림 영역을 문서에 삽입하지 못했습니다.');
  }
  document.applyParaFormat(0, index, JSON.stringify({ alignment: 'center', lineSpacing: 100,
    lineSpacingType: 'Percent', keepWithNext: false, keepLines: false, spacingBefore: 250, spacingAfter: 250 }));
}

function ensureParagraph(document, index) {
  if (document.getParagraphCount(0) <= index && !JSON.parse(document.insertParagraph(0, index)).ok) throw new Error('문단을 삽입하지 못했습니다.');
}

function insertCellRuns(document, table, cellPara, runs) {
  let text = '';
  const equations = [];
  for (const run of runs) {
    if (run.kind === 'equation') equations.push({ offset: text.length, script: run.script });
    else text += run.value;
  }
  if (text && !JSON.parse(document.insertTextInCell(0, table, 0, 0, cellPara, 0, text)).ok) {
    throw new Error('보기 칸에 글자를 넣지 못했습니다.');
  }
  if (text) document.applyCharFormatInCell(0, table, 0, 0, cellPara, 0, text.length, JSON.stringify(bodyCharFormat));
  // rhwp has no direct cell equation API; build each equation in a scratch paragraph and paste it.
  for (const equation of equations.reverse()) {
    const scratch = table + 1;
    if (!JSON.parse(document.insertParagraph(0, scratch)).ok) throw new Error('수식 작업 문단을 만들지 못했습니다.');
    try {
      const made = JSON.parse(document.insertEquation(0, scratch, 0, groupFractions(equationScript(equation.script)), typography.equation, 0));
      if (!made.ok) throw new Error('보기 칸의 수식을 만들지 못했습니다.');
      JSON.parse(document.copySelection(0, scratch, 0, scratch, 1));
      if (!JSON.parse(document.pasteInternalInCell(0, table, 0, 0, cellPara, equation.offset)).ok) {
        throw new Error('보기 칸에 수식을 넣지 못했습니다.');
      }
    } finally {
      document.deleteParagraph(0, scratch);
    }
  }
}

function insertBox(document, index, segment, width) {
  const created = JSON.parse(document.createTableEx(JSON.stringify({ sectionIdx: 0, paraIdx: index, charOffset: 0,
    rowCount: 1, colCount: 1, treatAsChar: true, colWidths: [width - 600] })));
  if (!created.ok) throw new Error('보기 상자를 만들지 못했습니다.');
  const table = created.paraIdx;
  const properties = { pageBreak: 0, paddingLeft: 360, paddingRight: 360, paddingTop: 240, paddingBottom: 240,
    outerLeft: 0, outerRight: 0, outerTop: 0, outerBottom: 0 };
  if (!JSON.parse(document.setTableProperties(0, table, created.controlIdx, JSON.stringify(properties))).ok
    || !JSON.parse(document.setCellProperties(0, table, created.controlIdx, 0,
      JSON.stringify({ ...properties, applyInnerMargin: true }))).ok) throw new Error('보기 너비와 여백을 설정하지 못했습니다.');
  // The title is a centered paragraph above the frame, like a printed exam heading.
  for (let count = 1; count < segment.rows.length; count += 1) {
    if (!JSON.parse(document.splitParagraphInCell(0, table, 0, 0, 0, 0)).ok) throw new Error('보기 줄을 나누지 못했습니다.');
  }
  for (const [row, runs] of segment.rows.entries()) {
    insertCellRuns(document, table, row, runs);
    document.applyParaFormatInCell(0, table, 0, 0, row, spacing(runs));
  }
  return table;
}

function pageLayouts(document) {
  return Array.from({ length: document.pageCount() }, (_, pageIndex) => ({
    pageIndex, page: JSON.parse(document.getPageInfo(pageIndex)),
    runs: JSON.parse(document.getPageTextLayout(pageIndex)).runs,
    controls: JSON.parse(document.getPageControlLayout(pageIndex)).controls,
  }));
}

// Saved line starts can be empty or stale after a split. Rendered text runs expose
// logical offsets; include equation offsets so a line beginning with a formula
// moves with that formula, and distinguish the two columns on the same page.
export function logicalLines(document, paragraph, layout = pageLayouts(document)) {
  const length = document.getLogicalLength(0, paragraph);
  const rightStart = layout[0].page.columns[1].x;
  const offsets = new Set([0]);
  for (const { runs, controls } of layout) {
    const rows = new Map();
    for (const run of runs) {
      if (run.secIdx !== 0 || run.paraIdx !== paragraph || run.parentParaIdx !== undefined) continue;
      const row = `${run.y}:${run.x >= rightStart - 1}`;
      rows.set(row, Math.min(rows.get(row) ?? length, run.charStart));
    }
    for (const offset of rows.values()) offsets.add(offset);
    for (const control of controls) {
      if (control.secIdx === 0 && control.paraIdx === paragraph && control.cellIdx === undefined) offsets.add(controlOffset(document, control));
    }
  }
  const cursor = (offset) => JSON.parse(document.getCursorRect(0, paragraph, offset === 0 ? 0 : Math.min(offset + 1, length)));
  const sameLine = (a, b) => a.pageIndex === b.pageIndex && Math.abs(a.y - b.y) < 1
    && (a.x >= rightStart - 1) === (b.x >= rightStart - 1);
  const starts = [0];
  let first = cursor(0);
  for (const offset of [...offsets].sort((a, b) => a - b)) {
    if (!offset || offset >= length) continue;
    const position = cursor(offset);
    if (!sameLine(first, position)) { starts.push(offset); first = position; }
  }
  return starts.map((charStart, lineIndex) => ({ lineIndex, lineCount: starts.length, charStart,
    charEnd: starts[lineIndex + 1] ?? length }));
}

const controlOffset = (document, control) => {
  const positions = JSON.parse(document.getControlTextPositions(0, control.paraIdx));
  return positions[control.controlIdx] + control.controlIdx;
};

function safeSplitOffset(document, paragraph, offset) {
  // The core misplaces a control split exactly at its starting position. Carry
  // the preceding text character (usually a space) with the formula instead.
  const positions = JSON.parse(document.getControlTextPositions(0, paragraph));
  const starts = new Set(positions.map((position, index) => position + index));
  while (offset > 0 && starts.has(offset)) offset -= 1;
  return offset;
}

function clearAutomaticPageBreaks(document) {
  // This pipeline owns the breaks in a newly generated document; never run it
  // against a user's edited file. Splits retain editable content and bookmarks.
  for (let paragraph = 1; paragraph < document.getParagraphCount(0); paragraph += 1) {
    if (JSON.parse(document.getParaPropertiesAt(0, paragraph)).pageBreakBefore
      && !JSON.parse(document.applyParaFormat(0, paragraph, JSON.stringify({ pageBreakBefore: false }))).ok) {
      throw new Error('자동 쪽 나누기를 초기화하지 못했습니다.');
    }
  }
}

function paginateGeneratedDocument(document, { pagePerQuestion = false } = {}) {
  let previous;
  for (let pass = 0; pass < 6; pass += 1) {
    clearAutomaticPageBreaks(document);
    if (pagePerQuestion) {
      const starts = JSON.parse(document.getBookmarks())
        .filter((mark) => mark.name.startsWith('exam_question_'))
        .sort((a, b) => a.para - b.para);
      for (const mark of starts.slice(1)) {
        if (!JSON.parse(document.applyParaFormat(mark.sec, mark.para, JSON.stringify({ pageBreakBefore: true }))).ok)
          throw new Error('문항별 새 페이지를 설정하지 못했습니다.');
      }
    }
    fitInlineControls(document);
    repairSavedTextBounds(document);
    repairEquationSpacing(document);
    keepContentInLeftColumn(document);
    const paragraphs = Array.from({ length: document.getParagraphCount(0) }, (_, paragraph) => [
      document.getLogicalLength(0, paragraph),
      JSON.parse(document.getParaPropertiesAt(0, paragraph)).pageBreakBefore,
    ]);
    const signature = JSON.stringify([document.pageCount(), paragraphs]);
    if (signature === previous) return;
    previous = signature;
  }
  throw new Error('편집 문서의 쪽 배치를 안정화하지 못했습니다.');
}

export function keepContentInLeftColumn(document) {
  let repairs = 0;
  const maxRepairs = document.getParagraphCount(0) * 4;
  let layout;
  for (let paragraph = 1; paragraph < document.getParagraphCount(0); paragraph += 1) {
    layout ??= pageLayouts(document);
    const lines = logicalLines(document, paragraph, layout);
    let overflow = lines.find((line) => {
      const cursor = JSON.parse(document.getCursorRect(0, paragraph, line.charStart === 0 ? 0 : Math.min(line.charStart + 1, line.charEnd)));
      const page = JSON.parse(document.getPageInfo(cursor.pageIndex));
      return cursor.x >= page.columns[1].x - 1 || cursor.y + cursor.height > page.footerArea.y + 1;
    });
    // A formula or inline picture can be taller than its text caret. Move the entire
    // containing line, rather than splitting the sentence at the individual control.
    for (const { page, controls } of layout) {
      for (const control of controls) {
        if (control.paraIdx !== paragraph || control.cellIdx !== undefined) continue;
        if (control.x < page.columns[1].x - 1 && control.y + control.h <= page.footerArea.y + 1) continue;
        const offset = controlOffset(document, control);
        const line = lines.find((line) => offset >= line.charStart && offset < line.charEnd) || lines.at(-1);
        if (!overflow || line.charStart < overflow.charStart) overflow = line;
      }
    }
    if (!overflow) continue;
    if (++repairs > maxRepairs) throw new Error('문항의 쪽 배치를 완료하지 못했습니다.');
    let target = paragraph;
    const offset = safeSplitOffset(document, paragraph, overflow.charStart);
    if (offset) {
      if (!JSON.parse(document.splitParagraph(0, paragraph, offset)).ok) throw new Error('긴 문항의 줄을 나누지 못했습니다.');
      target += 1;
    }
    if (!offset && JSON.parse(document.getParaPropertiesAt(0, target)).pageBreakBefore) throw new Error('문항을 왼쪽 단에 배치하지 못했습니다.');
    if (!JSON.parse(document.applyParaFormat(0, target, JSON.stringify({ pageBreakBefore: true }))).ok) throw new Error('쪽을 나누지 못했습니다.');
    layout = undefined;
    paragraph = Math.min(paragraph, target) - 1;
  }
}

/** The HWPX importer can restore print-line breaks measured with narrower
 * equation advances. A balanced edit fixes the transient view but not reload.
 * Split at the last fitting word boundary using the saved visible text advances;
 * all text and native controls survive in the following editable paragraph. */
export function repairSavedTextBounds(document) {
  const limit = Math.max(64, document.getParagraphCount(0) * 16);
  for (let pass = 0; pass < limit; pass += 1) {
    const saved = new document.constructor(document.exportHwpx());
    let target;
    try {
      for (let p = 0; p < saved.pageCount() && !target; p += 1) {
        const info = JSON.parse(saved.getPageInfo(p));
        for (const run of JSON.parse(saved.getPageTextLayout(p)).runs) {
          if (run.parentParaIdx !== undefined || !run.text.trim()) continue;
          const column = info.columns.findLast(c => run.x >= c.x - 1) || info.columns[0];
          const edge = column.x + column.width;
          if (run.x + run.w <= edge + 1) continue;
          let fit = 0;
          for (let i = 1; i < run.charX.length; i += 1) {
            if (run.x + run.charX[i] > edge - 1) break;
            fit = i;
          }
          const prefix = run.text.slice(0, fit);
          const wordEnd = [...prefix.matchAll(/\s+/gu)].at(-1);
          const relative = wordEnd ? wordEnd.index + wordEnd[0].length : fit;
          let offset = run.charStart + relative;
          // Prefer moving an unbroken word with its preceding formula when its
          // start is already near the edge; never insert/delete content to fit.
          if (!wordEnd && run.charStart > 0) offset = run.charStart;
          offset = safeSplitOffset(document, run.paraIdx, offset);
          if (!offset || offset >= document.getLogicalLength(0, run.paraIdx))
            throw new Error('본문을 한 단 너비에 맞추지 못했습니다.');
          target = { paragraph: run.paraIdx, offset };
          break;
        }
      }
    } finally { saved.free(); }
    if (!target) return pass;
    if (!JSON.parse(document.splitParagraph(0, target.paragraph, target.offset)).ok)
      throw new Error('본문의 줄 너비를 보정하지 못했습니다.');
  }
  throw new Error('본문의 줄 너비를 안정화하지 못했습니다.');
}

function fitInlineControls(document) {
  const maxRepairs = document.getParagraphCount(0) * 4;
  for (let repair = 0; repair < maxRepairs; repair += 1) {
    let corrected = false;
    for (let pageIndex = 0; pageIndex < document.pageCount() && !corrected; pageIndex += 1) {
      const page = JSON.parse(document.getPageInfo(pageIndex));
      for (const control of JSON.parse(document.getPageControlLayout(pageIndex)).controls) {
        if (control.cellIdx !== undefined) continue;
        const column = page.columns.findLast((column) => control.x >= column.x - 1) || page.columns[0];
        if (control.type === 'equation' && control.w > column.width - 8) {
          const properties = JSON.parse(document.getEquationProperties(0, control.paraIdx, control.controlIdx, -1, -1));
          const offset = safeSplitOffset(document, control.paraIdx, controlOffset(document, control));
          if (offset) {
            if (!JSON.parse(document.splitParagraph(0, control.paraIdx, offset)).ok) throw new Error('긴 수식을 새 줄에 배치하지 못했습니다.');
            corrected = true;
            break;
          }
          const scale = (column.width - 8) / control.w;
          if (Math.floor(properties.fontSize * scale) < typography.minimumEquation)
            throw new Error('긴 수식이 최소 8pt 크기로도 한 단 너비를 초과합니다. 수식을 나누어 주세요.');
          if (!JSON.parse(document.setEquationProperties(0, control.paraIdx, control.controlIdx, -1, -1,
            JSON.stringify({ fontSize: Math.floor(properties.fontSize * scale), width: Math.floor(properties.width * scale),
              height: Math.floor(properties.height * scale) }))).ok) throw new Error('긴 수식의 너비를 조정하지 못했습니다.');
          corrected = true;
          break;
        }
        if (control.x + control.w <= column.x + column.width + 1) continue;
        const offset = safeSplitOffset(document, control.paraIdx, controlOffset(document, control));
        if (!offset || !JSON.parse(document.splitParagraph(0, control.paraIdx, offset)).ok) throw new Error('개체를 한 단 너비에 맞추지 못했습니다.');
        corrected = true;
        break;
      }
    }
    if (!corrected) return;
  }
  throw new Error('편집 문서의 개체 배치를 완료하지 못했습니다.');
}
function boxFits(document, paragraph, rows) {
  const page = JSON.parse(document.getPageInfo(0));
  const usableHeight = page.height - page.marginTop - page.marginBottom - page.marginHeader - page.marginFooter;
  const first = JSON.parse(document.getCursorRectInCell(0, paragraph, 0, 0, 0, 0));
  const row = rows.length - 1;
  const last = JSON.parse(document.getCursorRectInCell(0, paragraph, 0, 0, row,
    document.getCellParagraphLength(0, paragraph, 0, 0, row)));
  if (first.pageIndex !== last.pageIndex || last.y + last.height - first.y >= usableHeight - 48) return false;
  const controls = JSON.parse(document.getPageControlLayout(first.pageIndex)).controls;
  const table = controls.find((control) => control.type === 'table' && control.paraIdx === paragraph);
  if (!table) return false;
  return controls.filter((control) => control.paraIdx === paragraph && control.type === 'equation')
    .every((control) => control.x >= table.x && control.x + control.w <= table.x + table.w - 4);
}

async function createParagraphDocument(paragraphs, anchors = new Map(), options = {}) {
  validateParagraphs(paragraphs);
  const HwpDocument = await core();
  const document = HwpDocument.createEmpty();
  try {
    const blank = JSON.parse(document.createBlankDocument());
    if (!blank.sectionCount) throw new Error('rhwp 문서를 생성하지 못했습니다.');
    const columnWidth = configurePage(document);
    // Keep section/column controls in their own empty paragraph. The editor otherwise
    // counts these controls as text when positioning inline equations in paragraph 0.
    let index = 1;
    const segments = documentSegments(paragraphs);
    const choices = new Map((options.mathChoiceGroups || []).map((group) => [group[0], group]));
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      ensureParagraph(document, index);
      const group = choices.get(segment.runs);
      if (group && group.every((runs, offset) => segments[segmentIndex + offset]?.kind === 'paragraph'
        && segments[segmentIndex + offset].runs === runs)) {
        const layout = insertChoiceLayout(document, index, group, columnWidth - 600,
          (script) => groupFractions(equationScript(script)));
        if (layout) {
          index = layout.paraIdx + 1;
          segmentIndex += group.length - 1;
          continue;
        }
      }
      if (segment.kind === 'figure') {
        insertFigure(document, index, segment.figure, columnWidth);
        index += 1;
        continue;
      }
      // --- data-table hook
      if (segment.kind === 'table') {
        index = insertDataTable(document, index, segment.table, (script) => groupFractions(equationScript(script)), columnWidth - 600) + 1;
        continue;
      }
      if (segment.kind === 'box') {
        insertRuns(document, index, [{ kind: 'text', value: segment.title }]);
        document.applyParaFormat(0, index, JSON.stringify({ alignment: 'center', keepWithNext: true, lineSpacing: 140, lineSpacingType: 'Percent' }));
        index += 1;
        ensureParagraph(document, index);
        const table = insertBox(document, index, segment, columnWidth);
        if (boxFits(document, table, segment.rows)) index = table + 1;
        else {
          if (!JSON.parse(document.deleteTableControl(0, table, 0)).ok) throw new Error('보기 상자의 문단 전환에 실패했습니다.');
          for (const runs of segment.rows) {
            ensureParagraph(document, index);
            insertRuns(document, index, runs);
            document.applyParaFormat(0, index, spacing(runs));
            index += 1;
          }
        }
        continue;
      }
      if (anchors.has(segment.runs)) {
        insertCaption(document, index, segment.runs, anchors.get(segment.runs));
        index += 1;
        continue;
      }
      insertRuns(document, index, segment.runs);
      const formatted = JSON.parse(document.applyParaFormat(0, index, spacing(segment.runs)));
      if (!formatted.ok) throw new Error('수식 문단의 간격을 설정하지 못했습니다.');
      index += 1;
    }
    // Use the same HWPX import path as the editor: imported equation advances differ from
    // those of createEmpty(), and saved line segments must match the document users open.
    let bytes = document.exportHwpx();
    // Saving refreshes imported line segments. Validate the representation that
    // will actually reopen, not only the transient layout before serialization.
    for (let pass = 0; pass < 4; pass += 1) {
      const reopened = new HwpDocument(bytes);
      try {
        paginateGeneratedDocument(reopened, options);
        bytes = reopened.exportHwpx();
      } finally { reopened.free(); }
      const saved = new HwpDocument(bytes);
      try {
        const rightStart = JSON.parse(saved.getPageInfo(0)).columns[1].x;
        const savedLayout = pageLayouts(saved);
        const stable = Array.from({ length: saved.getParagraphCount(0) }, (_, p) => p)
          .every((p) => logicalLines(saved, p, savedLayout).every((line) => {
            const offset = line.charStart === 0 ? 0 : Math.min(line.charStart + 1, line.charEnd);
            return JSON.parse(saved.getCursorRect(0, p, offset)).x < rightStart - 1;
          }));
        if (stable) return bytes;
      } finally { saved.free(); }
    }
    throw new Error('저장 후 문항의 왼쪽 단 배치를 안정화하지 못했습니다.');
  } finally {
    document.free();
  }
}
