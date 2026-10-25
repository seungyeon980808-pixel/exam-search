// 5E 문항 틀: 기출 PDF 문항을 5E ExamPool 「변형」과 같은 한글 문항 틀로 바꾼다(AI 없음).
// 1) convert/kice-engine.js가 PDF 글자·그림 위치로 ExamPool 문항(발문·자료·보기·선지)을 만든다.
// 2) ExamPool 상세 조판과 같은 단계(sheet/)로 문항 한 개짜리 한글 문서를 만든다. 화면(한글 창)은 쓰지 않는다.
// 3) 문항 문서들을 ExamPool 시험지와 같은 규칙(자르지 않고 2단에 차례로)으로 한 문서에 모은다.
// 한글 엔진은 5E 본체와 같은 rhwp 0.8.7 빌드(rhwp/)를 쓴다. 기출 탐색기의 기존 변환기(0.8.6)와 따로 읽는다.
import { buildQuestionHtml, verifyNativeQuestion } from './sheet/handoff.js?v=frame-20261025-1';
import { pageProfile, materializeEquations, normalizeQuestionImport, applyQuestionIndent, applyReferenceBogiIndent, applyCellEquationLines,
  applyFloatingPictures, applyCellFloatingPictures, settleFloatingPictures, applyFloatingTable, centerCellPictures, fixedLabelSpaces, growCellsToContent, applyInlineBoxes, alignBesideLeft, shrinkChoicesBeside } from './sheet/typeset-model.js?v=frame-20261025-1';
import { KICE_STANDARD, standardForPaper } from './sheet/typeset-standard.js?v=frame-20261025-1';
import { fitQuestionLines } from './sheet/line-fit.js?v=frame-20261025-1';
import { questionPageProfile, questionPageMetrics, fitQuestionPage } from './sheet/question-page.js?v=frame-20261025-1';
import { exportLayoutHwpx } from './sheet/native-hwpx.js?v=frame-20261025-1';
import { createNativeTextMeasurer } from './sheet/native-text-measure.js?v=frame-20261025-1';
import { loadImage } from './sheet/image-load.js?v=frame-20261025-1';
import { nativeInsertOptions } from './sheet/native-transfer.js?v=frame-20261025-1';
import { examPage, paginateQuestions } from './sheet/exam-layout.js?v=frame-20261025-1';

export const FRAME_VERSION = 'frame-20261025-1';
export const FRAME_SUBJECTS = new Set(['p1', 'p2', 'c1', 'c2', 'b1', 'b2', 'e1', 'e2']);
const PROFILE = { paper: 'B4', columns: 2 };
const LEAD = '<p style="margin:0;font-size:1pt;line-height:100%"> </p>';
const parse = (value) => typeof value === 'string' ? JSON.parse(value) : value;

// 틀 보기용 빈 그림 자리(ExamPool typeset.js와 같음). 기출 변환은 그림을 다 채우므로 거의 쓰이지 않는다.
const ghostFigures = new Map();
function ghostFigure(width, height, label) {
  const key = `${width}x${height}:${label || ''}`;
  if (ghostFigures.has(key)) return ghostFigures.get(key);
  const scale = 2, canvas = document.createElement('canvas');
  canvas.width = width * scale; canvas.height = height * scale;
  const g = canvas.getContext('2d'); g.scale(scale, scale);
  g.fillStyle = '#f4f5f6'; g.fillRect(0, 0, width, height);
  g.strokeStyle = '#b8bdc3'; g.lineWidth = 1; g.setLineDash([4, 3]); g.strokeRect(.5, .5, width - 1, height - 1);
  g.fillStyle = '#9aa0a6'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const line = (text, size, y) => { let px = size; do g.font = `${px}px "Apple SD Gothic Neo",sans-serif`; while (g.measureText(text).width > width - 12 && --px > 7); g.fillText(text, width / 2, y); };
  line(label && label.length < 12 ? `그림 ${label}` : '그림 자리', 13, height / 2 - 9); line('원본 PDF 참고', 10, height / 2 + 9);
  const figure = { name: '자료 자리.png', data: canvas.toDataURL('image/png'), width, height };
  ghostFigures.set(key, figure); return figure;
}

const script = (src) => new Promise((resolve, reject) => {
  const tag = document.createElement('script');
  tag.src = new URL(src, import.meta.url).href; tag.onload = resolve;
  tag.onerror = () => reject(new Error('한글 저장 도구를 불러오지 못했습니다.'));
  document.head.append(tag);
});

let enginePromise, convertPromise, measurer, recordsPromise;
/** rhwp 0.8.7과 HWPX 저장 도구(JSZip·CFB)를 한 번만 읽는다. */
export function loadFrameEngine() {
  enginePromise ||= (async () => {
    const tools = Promise.all([globalThis.JSZip || script('./vendor/jszip.min.js'), globalThis.XLSX?.CFB || script('./vendor/xlsx.full.min.js')]);
    const { default: init, HwpDocument } = await import('./rhwp/rhwp.js?v=frame-20261025-1');
    await Promise.all([init({ module_or_path: new URL('./studio/assets/rhwp_bg-BkVWMBaR.wasm', import.meta.url) }), tools]);
    return HwpDocument;
  })().catch((error) => { enginePromise = null; throw error; });
  return enginePromise;
}
const loadConverter = () => (convertPromise ||= import('./convert/kice-engine.js?v=' + FRAME_VERSION)
  .catch((error) => { convertPromise = null; throw error; }));
/** 2024~2026 조사 기록(틀 유형·자료 구조·배치)과 잘린 영역 보정. */
const loadRecords = () => (recordsPromise ||= fetch(new URL('./records.json?v=' + FRAME_VERSION, import.meta.url))
  .then((response) => { if (!response.ok) throw new Error('5E 틀 기록을 읽지 못했습니다.'); return response.json(); })
  .then((value) => value.items || {}).catch((error) => { recordsPromise = null; throw error; }));

/** 미리 읽어 두면 처음 변환이 빨라진다(엔진 내려받기·초기화를 겹친다). */
export function warmFrame() { return Promise.all([loadFrameEngine(), loadConverter(), loadRecords()]).catch(() => {}); }

export const frameEligible = (question) => FRAME_SUBJECTS.has(question?.subject) && !!question?.pdfFile && Array.isArray(question?.box);

/** 기출 문항 → ExamPool 문항(5E 틀). */
export async function frameQuestion(question, { signal } = {}) {
  const [engine, records] = await Promise.all([loadConverter(), loadRecords()]);
  const extra = records[question.id] || {}, r = extra.r || [];
  const source = { id: question.id, subject: question.subject, title: question.title, page: extra.p ?? question.page,
    box: extra.b || question.box, pdfFile: question.pdfFile, no: String(question.no),
    ...(r.length ? { form: r[0], struct: r[1], layout: r[2], choiceShape: r[3], choiceArrange: r[4] } : {}) };
  const { question: q, diag } = await engine.convertKice(source, { number: String(question.no), signal });
  delete q.kice;
  return { q, diag, notes: (diag?.notes || []).filter((note) => /못|확인|제외|원본 참고/.test(note)) };
}

async function prepareFigure(figure) {
  const image = await loadImage(figure.data);
  if (image.naturalWidth * image.naturalHeight > 40000000) throw new Error('그림이 너무 큽니다.');
  if (!figure.data.startsWith('data:image/png;')) {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0); figure.data = canvas.toDataURL('image/png');
  }
  return { ...figure, width: image.naturalWidth, height: image.naturalHeight };
}

/** ExamPool 상세 조판(typeset.js generate)과 같은 순서로 문항 한 개 문서를 만든다. */
export async function typesetFrame(value, profile = PROFILE) {
  const Document = await loadFrameEngine(), JSZip = globalThis.JSZip, CFB = globalThis.XLSX.CFB;
  measurer ||= createNativeTextMeasurer(Document);
  const d = Document.createEmpty();
  let bytes, height, step = '문서 준비';
  // 한글 엔진은 오류를 글자로 던진다. 어느 단계에서 났는지 붙여 Error로 바꾼다(기본 변환으로 넘어갈 때 이유가 남게).
  const at = (name) => { step = name; };
  try {
    d.createBlankDocument();
    // 용지 맞춤: B4 문항은 수능 틀을 원본 지면(단 폭 112mm, 본문 11.5pt·장평 95%·자간 −3%·줄 간격 145%)으로 바꾼다(standardForPaper).
    const standard = standardForPaper(KICE_STANDARD, profile.paper);
    const config = questionPageProfile(profile, 1200, standard);
    d.setPageDef(0, JSON.stringify(config.page)); d.setColumnDef(0, 1, 0, true, 0);
    at('틀 만들기');
    // 글자 폭 재기 배율(장평 + 자간)은 buildQuestionHtml이 틀 값으로 measurer.factor에 넣는다.
    const plan = await buildQuestionHtml(value, prepareFigure, config.width, { native: true, measureText: measurer, skeleton: true, ghostFigure, standard });
    at('붙여 넣기');
    if (!parse(d.pasteHtml(0, 0, 0, LEAD + plan.html)).ok) throw new Error('문항 조판을 만들지 못했습니다.');
    at('수식');
    bytes = await materializeEquations(Document, JSZip, await normalizeQuestionImport(d.exportHwpx(), JSZip, { standard }), plan.equations);
    const checked = new Document(bytes);
    try {
      at('보기 들여쓰기');
      const styled = new Document(await applyReferenceBogiIndent(checked, JSZip, CFB));
      try {
        at('줄 배치'); styled.reflowLinesegs();
        if (plan.cellFloats?.length) { at('칸 안 그림 어울림'); applyCellFloatingPictures(styled, plan.cellFloats); }
        at('칸 그림 가운데'); centerCellPictures(styled);
        if (standard.parts?.labelSpace === 'fixed') fixedLabelSpaces(styled);
        at('내어쓰기'); applyQuestionIndent(styled, value.number, { body: true, askLead: plan.askLead, askIndent: plan.askIndent, hangPx: plan.bodyIndent });
        // 어울림은 내어쓰기 뒤에 건다. 문단 모양을 나중에 바꾸면 한글 엔진이 그림 옆 줄 폭을 잘못 잡는다.
        if (plan.floats.length || plan.floatTable) {
          at('글 옆 그림'); applyFloatingPictures(styled, plan.floats); at('선지 그림 옆'); styled.reflowLinesegs(); shrinkChoicesBeside(styled); at('글 옆 표'); applyFloatingTable(styled, plan.floatTable, value.number);
          at('글 옆 배치'); styled.reflowLinesegs(); settleFloatingPictures(styled); at('글 옆 줄'); alignBesideLeft(styled);
        }
        // 윗줄부터 자간 맞춤(틀의 fit): 내어쓰기·어울림 뒤, 쪽 높이 맞춤 전. 그림 옆 글(어울림)이 있는 문항은 건너뛴다.
        const fit = standard.fit;
        if (fit?.on && !plan.floats.length && !plan.floatTable) {
          at('자간 맞춤'); fitQuestionLines(styled, { low: fit.low, high: fit.high, shortLastLine: fit.shortLastLine, base: standard.text.spacing });
        }
        // 내어쓰기로 문단 왼쪽 여백을 바꾸면 엔진이 그 뒤 글자처럼 놓인 표(〈보기〉·선지)의 세로 자리를 옛 값으로 들고 있다 —
        // 줄 배치를 다시 계산해도 그대로라, 높이를 낮게 재 문항이 둘째 쪽으로 넘어갔다(b2_2025_06_06: 〈보기〉가 발문 위 185px에 겹쳐 잡힘).
        // 한 번 저장해 다시 열면 바른 자리로 계산된다. 높이 맞춤·글 확인은 다시 연 문서로 한다.
        at('다시 열기');
        const settled = new Document(exportLayoutHwpx(styled, CFB));
        try {
          // 글 확인(계획한 글과 같은지)은 표시 글자를 지우기 전에 한다. 네모 칸 글자 테두리는 줄 높이를 바꾸므로 칸 높이·용지 맞춤보다 먼저.
          at('글 확인'); verifyNativeQuestion(settled, plan);
          at('네모 칸'); applyInlineBoxes(settled);
          at('칸 높이'); growCellsToContent(settled);
          at('용지 맞춤'); fitQuestionPage(settled, profile);
          height = questionPageMetrics(settled, profile).usedHeightMm;
          bytes = await applyCellEquationLines(exportLayoutHwpx(settled, CFB), JSZip);
        } finally { settled.free(); }
      } finally { styled.free(); }
    } finally { checked.free(); }
  } catch (error) {
    if (error instanceof Error) { error.message = `${step}: ${error.message}`; throw error; }
    throw new Error(`${step}: ${String(error?.message || error)}`);
  } finally { d.free(); }
  return { bytes, height, profile, warnings: [] };
}

/** 기출 문항 하나 → 5E 틀 문항 문서. 실패하면 던진다(부르는 쪽이 기존 변환으로 돌린다). */
export async function convertFrame(question, { signal, includeImages = true } = {}) {
  const { q, notes } = await frameQuestion(question, { signal });
  signal?.throwIfAborted();
  // 그림 제외: 그림을 빼도 틀은 그대로 두고 그 자리에 '그림 자리' 상자를 남긴다(편집 표·보기·선지는 그대로).
  const excludedFigures = includeImages ? 0 : stripFigures(q);
  const typeset = await typesetFrame(q);
  return { kind: 'frame', version: FRAME_VERSION, question: q, bytes: typeset.bytes, height: typeset.height, profile: typeset.profile,
    notes: excludedFigures ? [...notes, `그림 ${excludedFigures}개를 빼고 그림 자리만 남겼습니다.`] : notes, excludedFigures };
}

/** 문항의 그림(자료·표 칸·선지)을 빼고 뺀 수를 돌려준다. */
export function stripFigures(q) {
  let count = 0;
  const drop = (holder) => { if (holder?.figure) { holder.figure = null; count += 1; } };
  for (const block of q.blocks || []) {
    drop(block);
    for (const row of block.table?.cells || []) for (const cell of row) drop(cell);
    for (const line of block.lines || []) drop(line);
  }
  for (const choice of q.choices || []) drop(choice);
  for (const row of q.choiceTable?.cells || []) for (const cell of row) drop(cell);
  return count;
}

export const frameBookmark = (id) => `exam_question_${encodeURIComponent(id)}`;

/**
 * 문항 문서들을 시험지 한 문서로 모은다. entries: [{id, bytes, height}].
 * ExamPool 시험지(exam-build.js assembleExamDocument)와 같은 방식: 문단을 그대로 옮기고, 문항을 자르지 않게
 * 단이 시작되는 문항 앞에 단 나누기를 넣는다. pagePerQuestion이면 문항마다 쪽 나누기.
 */
export async function assembleFrameCollection(entries, { pagePerQuestion = false, between = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {}) {
  const Document = await loadFrameEngine();
  const items = entries.map((entry) => ({ ...entry, q: { typeset: { profile: PROFILE } } }));
  const sheet = examPage(items);
  const pages = paginateQuestions(items, { height: sheet.heightMm, columns: sheet.columns, gap: sheet.gapMm });
  const starts = new Set();
  for (const page of pages) for (const column of page.columns) if (column.length) starts.add(column[0]);
  const target = Document.createEmpty();
  try {
    target.createBlankDocument();
    const config = pageProfile({ paper: sheet.paper, columns: sheet.columns });
    target.setPageDef(0, JSON.stringify(config.page)); target.setColumnDef(0, sheet.columns, 0, true, config.spacing);
    // 맨 위 빈 문단(쪽·단 설정이 든 문단이라 지우지 못함)은 줄 높이를 거의 0으로 — 첫 단만 한 줄 아래에서 시작해 옆 단과 위 끝이 어긋나지 않게.
    // 빈 문단의 줄 높이는 글자 크기를 따르므로 폭 없는 글자(U+2060) 하나를 1pt로 둔다(5E exam-build.js와 같음).
    target.insertText(0, 0, 0, '\u2060'); target.applyCharFormat(0, 0, 0, 1, JSON.stringify({ fontSize: 100 }));
    target.applyParaFormat(0, 0, JSON.stringify({ lineSpacing: 100, lineSpacingType: 'Percent', spacingBefore: 0, spacingAfter: 0 }));
    for (const [index, item] of items.entries()) {
      const source = new Document(item.bytes);
      try {
        const before = target.getParagraphCount(0);
        const result = parse(target.importParagraphBlock(source, nativeInsertOptions(source, 0, before)));
        if (!result?.operationResult?.result?.inserted && result?.ok === false) throw new Error(`${index + 1}번째 문항을 시험지에 넣지 못했습니다.`);
        // 첫 문항: 단 맨 위 문단처럼 「문단 위」 간격 없이(옆 단 문항과 위 끝을 맞춘다).
        if (index === 0) target.applyParaFormat(0, before, JSON.stringify({ spacingBefore: 0 }));
        // 나누기는 넣은 문항의 첫 문단 앞에 건다. 앞 문항 끝 문단에 걸면, 그 문단이 표(그림 선지 등)뿐일 때
        // 글 길이가 0이라 표 앞에서 나뉘어 앞 문항의 선지가 다음 단·쪽으로 넘어갔다(5E 10-23).
        if (index > 0 && (pagePerQuestion || starts.has(item.id))) {
          const broke = parse(pagePerQuestion ? target.insertPageBreak(0, before, 0) : target.insertColumnBreak(0, before, 0));
          if (broke && broke.ok === false) throw new Error('시험지의 단 나누기를 넣지 못했습니다.');
        }
        // 「다음 문단과 함께」: 문항의 마지막 문단을 뺀 모든 문단에 걸어 문항 중간(발문·〈보기〉·선지 사이)에서 단이 나뉘지 않게 한다.
        for (let p = before; p < target.getParagraphCount(0) - 1; p++) target.applyParaFormat(0, p, JSON.stringify({ keepWithNext: true }));
        // 첫 문단 머리에 이동 표시(기출 탐색기의 문항 이동·원본 대조가 쓰는 이름 그대로).
        const mark = parse(target.addBookmark(0, before, 0, frameBookmark(item.id)));
        if (mark && mark.ok === false) throw new Error('문항 이동 표시를 만들지 못했습니다.');
      } finally { source.free(); }
      if (between && index < items.length - 1) await between();
    }
    // 글 옆 그림(어울림)이 든 문항은 옮겨 온 줄 배치가 원래 문서의 단 위치를 기준으로 남아 글이 그림 쪽으로 밀린다.
    // 그런 문항이 있을 때만 시험지 문서에서 줄 배치를 다시 계산한다(수식 줄은 exportLayoutHwpx가 엔진 저장본에서 되살린다).
    // 옮겨 넣은 문서에서 바로 다시 계산하면 엔진이 옛 위치를 그대로 쓴다. 한 번 저장한 문서를 다시 열어 계산한다.
    const bytes = exportLayoutHwpx(target, globalThis.XLSX.CFB);
    if (!await hasFloatingControls(bytes)) return bytes;
    const reopened = new Document(bytes);
    try { reopened.reflowLinesegs(); return exportLayoutHwpx(reopened, globalThis.XLSX.CFB); } finally { reopened.free(); }
  } finally { target.free(); }
}

// 글자처럼 취급하지 않는(떠 있는) 그림·표가 있는지 저장본에서 본다(native-hwpx.js와 같은 기준).
async function hasFloatingControls(bytes) {
  const zip = await globalThis.JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files).filter((path) => /^Contents\/section\d+\.xml$/.test(path))) {
    if (/<hp:pos\b[^>]*treatAsChar="0"/.test(await zip.file(name).async('string'))) return true;
  }
  return false;
}
