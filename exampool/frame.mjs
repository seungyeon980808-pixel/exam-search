// 5E 문항 틀: 기출 PDF 문항을 5E ExamPool 「변형」과 같은 한글 문항 틀로 바꾼다(AI 없음).
// 1) convert/kice-engine.js가 PDF 글자·그림 위치로 ExamPool 문항(발문·자료·보기·선지)을 만든다.
// 2) ExamPool 상세 조판과 같은 단계(sheet/)로 문항 한 개짜리 한글 문서를 만든다. 화면(한글 창)은 쓰지 않는다.
// 3) 문항 문서들을 ExamPool 시험지와 같은 규칙(자르지 않고 2단에 차례로)으로 한 문서에 모은다.
// 한글 엔진은 5E 본체와 같은 rhwp 0.8.7 빌드(rhwp/)를 쓴다. 기출 탐색기의 기존 변환기(0.8.6)와 따로 읽는다.
import { buildQuestionHtml, verifyNativeQuestion } from './sheet/handoff.js';
import { pageProfile, materializeEquations, normalizeQuestionImport, applyQuestionIndent, applyReferenceBogiIndent, applyCellEquationLines,
  applyFloatingPictures, settleFloatingPictures, applyFloatingTable, centerCellPictures } from './sheet/typeset-model.js?v=1014-compact-panel';
import { questionPageProfile, questionPageMetrics, fitQuestionPage } from './sheet/question-page.js?v=1014-compact-panel';
import { exportLayoutHwpx } from './sheet/native-hwpx.js?v=1014-compact-panel';
import { createNativeTextMeasurer } from './sheet/native-text-measure.js';
import { loadImage } from './sheet/image-load.js';
import { nativeInsertOptions } from './sheet/native-transfer.js?v=1014-compact-panel';
import { examPage, paginateQuestions } from './sheet/exam-layout.js';

export const FRAME_VERSION = 'frame-20261020-1';
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
    const { default: init, HwpDocument } = await import('./rhwp/rhwp.js');
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
  let bytes, height;
  try {
    d.createBlankDocument();
    const config = questionPageProfile(profile);
    d.setPageDef(0, JSON.stringify(config.page)); d.setColumnDef(0, 1, 0, true, 0);
    const plan = await buildQuestionHtml(value, prepareFigure, config.width, { native: true, measureText: measurer, skeleton: true, ghostFigure });
    if (!parse(d.pasteHtml(0, 0, 0, LEAD + plan.html)).ok) throw new Error('문항 조판을 만들지 못했습니다.');
    bytes = await materializeEquations(Document, JSZip, await normalizeQuestionImport(d.exportHwpx(), JSZip), plan.equations);
    const checked = new Document(bytes);
    try {
      const styled = new Document(await applyReferenceBogiIndent(checked, JSZip, CFB));
      try {
        styled.reflowLinesegs(); centerCellPictures(styled);
        applyQuestionIndent(styled, value.number, { body: true, askLead: plan.askLead, askIndent: plan.askIndent });
        if (plan.floats.length || plan.floatTable) {
          applyFloatingPictures(styled, plan.floats); applyFloatingTable(styled, plan.floatTable, value.number);
          styled.reflowLinesegs(); settleFloatingPictures(styled);
        }
        fitQuestionPage(styled, profile); verifyNativeQuestion(styled, plan);
        height = questionPageMetrics(styled, profile).usedHeightMm;
        bytes = await applyCellEquationLines(exportLayoutHwpx(styled, CFB), JSZip);
      } finally { styled.free(); }
    } finally { checked.free(); }
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
    // 구역 정보를 품는 첫 빈 문단이 본문 한 줄(약 7mm)을 차지하지 않게 1pt로 줄인다(기존 변환과 같은 처리).
    target.applyParaFormat(0, 0, JSON.stringify({ lineSpacing: 100, lineSpacingType: 'Percent', spacingBefore: 0, spacingAfter: 0 }));
    target.applyCharFormat(0, 0, 0, 0, JSON.stringify({ fontSize: 100 }));
    for (const [index, item] of items.entries()) {
      const source = new Document(item.bytes);
      try {
        if (index > 0 && (pagePerQuestion || starts.has(item.id))) {
          const last = target.getParagraphCount(0) - 1, at = target.getParagraphLength(0, last);
          const result = parse(pagePerQuestion ? target.insertPageBreak(0, last, at) : target.insertColumnBreak(0, last, at));
          if (result && result.ok === false) throw new Error('시험지의 단 나누기를 넣지 못했습니다.');
        }
        const before = target.getParagraphCount(0);
        const result = parse(target.importParagraphBlock(source, nativeInsertOptions(source, 0, before)));
        if (!result?.operationResult?.result?.inserted && result?.ok === false) throw new Error(`${index + 1}번째 문항을 시험지에 넣지 못했습니다.`);
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
    if (!hasFloatingControls(target)) return bytes;
    const reopened = new Document(bytes);
    try { reopened.reflowLinesegs(); return exportLayoutHwpx(reopened, globalThis.XLSX.CFB); } finally { reopened.free(); }
  } finally { target.free(); }
}

function hasFloatingControls(document) {
  for (let page = 0; page < document.pageCount(); page += 1) {
    for (const control of parse(document.getPageControlLayout(page)).controls || []) {
      if (control.cellPath?.length || !['image', 'table'].includes(control.type)) continue;
      const props = parse(control.type === 'image' ? document.getPictureProperties(control.secIdx, control.paraIdx, control.controlIdx)
        : document.getTableProperties(control.secIdx, control.paraIdx, control.controlIdx));
      if (props.treatAsChar === false) return true;
    }
  }
  return false;
}
