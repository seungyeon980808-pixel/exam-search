import { paragraphsForPrepared, safeTextParagraphs, validateQuestionParagraphs } from './editable-convert.mjs?v=frame-20261020-1';
import { restoreFigures, withoutFigures } from './figure-fallback.mjs?v=library-release-20261011-3';
import { passageBlocks, passageKey } from './shared-passage.mjs?v=library-release-20261011-3';
import { finalizeContentQuality } from './content-quality.mjs?v=readability-20261004-4';

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

async function readPrepared(path, { signal } = {}) {
  const response = await fetch(new URL(path, import.meta.url), { signal });
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
  // Native text is the dependable default. Image work is enabled only by an explicit
  // conversion option, including when prepared data already contains figure controls.
  const includeImages = dependencies.includeImages === true;
  dependencies = { ...dependencies, includeImages };
  const check = () => dependencies.signal?.throwIfAborted();
  check();
  const entry = (await (dependencies.entries || editableEntries)())[question.id];
  check();
  // Shared passages precede the independently validated question paragraphs.
  const result = async (paragraphs, provenance, warnings = [], inlineChoices = false, quality) => {
    warnings = [...frameFailures, ...warnings];
    const validatedQuestion = { ...question, inlineChoices };
    validateQuestionParagraphs(paragraphs, validatedQuestion);
    const passage = await passageBlocks(question, { ...dependencies, notes: warnings });
    check();
    quality = quality || { state: provenance === 'index-draft' ? 'incomplete' : 'unverified',
      scope: 'observed-source-regions', regions: [], unresolvedCount: 0, excludedCount: 0 };
    if (warnings.some((note) => /공통 지문을 제외했습니다/u.test(note))) quality = { ...quality, state: 'incomplete' };
    if (passage.length) quality = { ...quality, passageRequiresReview: true };
    if (passage.length) paragraphs = [...passage.map((block) => block.runs), [], ...paragraphs];
    return { questionId: question.id, question: validatedQuestion,
      // The passage paragraphs and their blank separator; one [n～m] set shares the same key.
      ...(passage.length ? { questionParagraphStart: passage.length + 1, passageKey: passageKey(question) } : {}),
      sourceLabel: question.title || `${question.pdfFile} ${question.no}번`,
      paragraphs, provenance, warnings: [...new Set(warnings)], quality, status: 'needs_review' };
  };
  // 5E 문항 틀(과학탐구 기출): 5E ExamPool 「변형」과 같은 틀로 문항 한 개 한글 문서를 만든다.
  // 실패하면(원본 PDF를 못 읽은 경우 제외) 아래 기존 변환으로 돌아간다.
  const frameFailures = [];
  // 브라우저에서만(한글 엔진·그림 그리기가 화면 도구를 쓴다). 노드 단위 검사는 기존 변환을 그대로 본다.
  if (dependencies.frame ?? typeof document !== 'undefined') {
    const frame = dependencies.frameModule ? await dependencies.frameModule() : await import('./exampool/frame.mjs?v=frame-20261020-1');
    if (frame.frameEligible(question)) {
      try {
        const converted = await frame.convertFrame(question, { signal: dependencies.signal, includeImages });
        check();
        return { questionId: question.id, question, sourceLabel: question.title || `${question.pdfFile} ${question.no}번`,
          frame: converted, paragraphs: [], provenance: '5e-frame', warnings: converted.notes,
          quality: { state: converted.excludedFigures ? 'excluded' : 'unverified', scope: '5e-frame', regions: [], unresolvedCount: 0, excludedCount: converted.excludedFigures || 0 },
          status: 'needs_review' };
      } catch (error) {
        check();
        if (error?.name === 'AbortError' || error?.name === 'DriveError' && !error.status) throw error;
        frameFailures.push(`5E 문항 틀로 바꾸지 못해 기본 변환을 썼습니다: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (entry?.status === 'needs_review' && entry.source) {
    let prepared = await (dependencies.readPrepared || readPrepared)(entry.source, { signal: dependencies.signal });
    check();
    // Validate identity, equations and choices before optional drawing work. A bad
    // native question must never be disguised as an illustration warning.
    const native = withoutFigures(prepared);
    preparedParagraphs(question, native);
    prepared = includeImages ? await restoreFigures(question, prepared, { ...dependencies, bestEffort: true }) : native;
    check();
    const audit = finalizeContentQuality(prepared, { includeImages, sourcePage: question.page });
    return result(preparedParagraphs(question, prepared), 'prepared', [...(prepared.notes || []), ...audit.warnings], prepared.inlineChoices === true, audit.quality);
  }
  let prepared;
  try {
    const convert = dependencies.convert || (await import('./live-convert.mjs?v=library-release-20261011-3')).convertQuestionNow;
    check();
    prepared = await convert(question, { includeImages, signal: dependencies.signal });
    check();
  } catch (error) {
    check();
    if (entry?.status === 'unavailable' || (entry?.file && !entry.source)) throw error;
    // A PDF that could not be downloaded says nothing about the question; say so plainly
    // instead of presenting an index draft as if the conversion itself had failed.
    if (error?.name === 'DriveError' && !error.status) throw error;
    return result(safeTextParagraphs({ ...question, text: question.questionText || question.text }), 'index-draft', [
      `원본 PDF 분석 실패: ${error instanceof Error ? error.message : String(error)}`,
      '색인 텍스트 초안입니다. 수식·선지를 원본 PDF와 확인하세요.',
    ]);
  }
  const native = withoutFigures(prepared);
  preparedParagraphs(question, native);
  prepared = includeImages ? await restoreFigures(question, prepared, { ...dependencies, bestEffort: true }) : native;
  check();
  const audit = finalizeContentQuality(prepared, { includeImages, sourcePage: question.page });
  return result(preparedParagraphs(question, prepared), 'pdf', [...(prepared.notes || []), ...audit.warnings], prepared.inlineChoices === true, audit.quality);
}
