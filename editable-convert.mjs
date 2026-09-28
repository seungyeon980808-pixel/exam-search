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

function equationScript(source) {
  let value = source.trim();
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
  return value.replace(/\\\{/gu, 'LEFT {').replace(/\\\}/gu, 'RIGHT }')
    .replace(/\\([A-Za-z]+)/gu, '$1');
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
  for (const block of question.blocks) {
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
    const result = JSON.parse(document.insertEquation(0, paragraphIndex, equation.offset, groupFractions(equationScript(equation.script)), 1200, 0));
    if (!result.ok) throw new Error(`${paragraphIndex + 1}번째 문단의 수식을 삽입하지 못했습니다.`);
  }
}

function configurePage(document) {
  const page = JSON.parse(document.getPageDef(0));
  page.marginLeft = 5668;
  page.marginRight = 5668;
  const result = JSON.parse(document.setPageDef(0, JSON.stringify(page)));
  if (!result.ok) throw new Error('편집 문서의 쪽 여백을 설정하지 못했습니다.');
}

async function core() {
  if (!corePromise) {
    corePromise = import('./vendor/rhwp-studio/assets/rhwp-core.js').then(async ({ default: init, HwpDocument }) => {
      const wasmUrl = new URL('./vendor/rhwp-studio/assets/rhwp_bg-PUGAA2uC.wasm', import.meta.url);
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
  for (const label of '①②③④⑤') {
    if (lines.filter((line) => line.startsWith(label)).length !== 1) throw new Error('선지 다섯 개가 없거나 중복되었습니다.');
  }
}

export async function createEditableHwpx(question) {
  return createParagraphDocument(safeTextParagraphs(question));
}

export async function createPreparedHwpx(question) {
  return createParagraphDocument(paragraphsForPrepared(question));
}

export async function createCollectionHwpx(resolvedItems) {
  if (!Array.isArray(resolvedItems) || !resolvedItems.length) throw new Error('선택한 문항이 없습니다.');
  const paragraphs = [];
  for (const [index, item] of resolvedItems.entries()) {
    validateQuestionParagraphs(item.paragraphs, item.question);
    if (index) paragraphs.push([]);
    paragraphs.push([{ kind: 'text', value: item.sourceLabel || item.question?.title || item.questionId }]);
    paragraphs.push(...item.paragraphs);
  }
  return createParagraphDocument(paragraphs);
}

async function createParagraphDocument(paragraphs) {
  validateParagraphs(paragraphs);
  const HwpDocument = await core();
  const document = HwpDocument.createEmpty();
  try {
    const blank = JSON.parse(document.createBlankDocument());
    if (!blank.sectionCount) throw new Error('rhwp 문서를 생성하지 못했습니다.');
    configurePage(document);
    for (const [index, runs] of paragraphs.entries()) {
      if (index && !JSON.parse(document.insertParagraph(0, index)).ok) throw new Error('문단을 삽입하지 못했습니다.');
      insertRuns(document, index, runs);
      const tallEquation = runs.some((run) => run.kind === 'equation'
        && /\\(?:frac|sum|int)|cases\{/u.test(run.script));
      const formatted = JSON.parse(document.applyParaFormat(0, index,
        JSON.stringify({ alignment: 'left', lineSpacing: 180, lineSpacingType: 'Percent',
          spacingBefore: tallEquation ? 400 : 0, spacingAfter: tallEquation ? 800 : 0 })));
      if (!formatted.ok) throw new Error('수식 문단의 간격을 설정하지 못했습니다.');
    }
    return document.exportHwpx();
  } finally {
    document.free();
  }
}
