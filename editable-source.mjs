import { paragraphsForPrepared, safeTextParagraphs, validateQuestionParagraphs } from './editable-convert.mjs';
import { passageBlocks, passageKey } from './shared-passage.mjs';

let indexPromise;
export async function editableEntries() {
  if (!indexPromise) indexPromise = fetch(new URL('./data/editable/index.json', import.meta.url))
    .then(async (response) => {
      if (response.status === 404) return {};
      if (!response.ok) throw new Error('편집 문서 목록을 불러오지 못했습니다.');
      return (await response.json()).items || {};
    }).catch((error) => { indexPromise = null; throw error; });
  return indexPromise;
}

async function readPrepared(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error('문항의 편집 데이터를 불러오지 못했습니다.');
  return response.json();
}

export function preparedParagraphs(question, prepared) {
  if (prepared.questionId !== question.id || prepared.number !== question.no
    || prepared.sourcePdf !== question.pdfFile || prepared.page !== question.page) {
    throw new Error('편집 데이터의 문항 ID/번호/PDF/페이지가 일치하지 않습니다.');
  }
  // --- data-table hook
  const hasContent = (block) => (block.kind === 'table' ? block.rows?.flat(2) : block.runs)
    ?.some((run) => run.kind === 'equation' ? run.script?.trim() : run.value?.trim());
  if (!Array.isArray(prepared.blocks) || !prepared.blocks.some((block) => block.role === 'stem' && hasContent(block))) throw new Error('본문이 없습니다.');
  if (prepared.blocks.some((block) => block.role === 'choice' && !hasContent(block))) throw new Error('빈 선지입니다.');
  const paragraphs = paragraphsForPrepared(prepared);
  validateQuestionParagraphs(paragraphs, { ...question, inlineChoices: prepared.inlineChoices === true });
  return paragraphs;
}

export async function resolveEditableContent(question, dependencies = {}) {
  const check = () => dependencies.signal?.throwIfAborted();
  check();
  const entry = (await (dependencies.entries || editableEntries)())[question.id];
  check();
  // Shared passages precede the independently validated question paragraphs.
  const result = async (paragraphs, provenance, warnings = [], inlineChoices = false) => {
    warnings = [...warnings];
    const validatedQuestion = { ...question, inlineChoices };
    validateQuestionParagraphs(paragraphs, validatedQuestion);
    const passage = await passageBlocks(question, { ...dependencies, notes: warnings });
    check();
    if (passage.length) paragraphs = [...passage.map((block) => block.runs), [], ...paragraphs];
    return { questionId: question.id, question: validatedQuestion,
      // The passage paragraphs and their blank separator; one [n～m] set shares the same key.
      ...(passage.length ? { questionParagraphStart: passage.length + 1, passageKey: passageKey(question) } : {}),
      sourceLabel: question.title || `${question.pdfFile} ${question.no}번`,
      paragraphs, provenance, warnings, status: 'needs_review' };
  };
  if (entry?.status === 'needs_review' && entry.source) {
    const prepared = await (dependencies.readPrepared || readPrepared)(entry.source);
    check();
    return result(preparedParagraphs(question, prepared), 'prepared', prepared.notes || [], prepared.inlineChoices === true);
  }
  let prepared;
  try {
    const convert = dependencies.convert || (await import('./live-convert.mjs')).convertQuestionNow;
    check();
    prepared = await convert(question);
    check();
  } catch (error) {
    check();
    if (entry?.status === 'unavailable' || (entry?.file && !entry.source)) throw error;
    return result(safeTextParagraphs({ ...question, text: question.questionText || question.text }), 'index-draft', [
      `원본 PDF 분석 실패: ${error instanceof Error ? error.message : String(error)}`,
      '색인 텍스트 초안입니다. 수식·선지를 원본 PDF와 확인하세요.',
    ]);
  }
  return result(preparedParagraphs(question, prepared), 'pdf', prepared.notes || [], prepared.inlineChoices === true);
}
