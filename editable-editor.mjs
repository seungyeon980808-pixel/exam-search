import { driveFilePath } from './data.mjs?v=library-20261008-3';
import { driveLink } from './drive-source.mjs';
import { resolveEditableContent } from './editable-source.mjs?v=library-20261008-3';
import { createEditableBatch } from './editable-batch.mjs?v=library-20261008-3';
import { createCollectionHwpx, readQuestionTargets, readEditablePageGeometry } from './editable-convert.mjs?v=readability-20261004-4';
import { renderQuestion } from './pdf-viewer.mjs?v=library-20261008-3';
import { passageKey, sharedPassageRegions } from './shared-passage.mjs?v=library-20261008-3';
import { contentQualitySummary } from './content-quality.mjs?v=readability-20261004-4';

import { columnViewport, columnPresentation, studioZoomSlider } from './editor-viewport.mjs?v=resizable-editor-20261003-1';

const dialog = document.querySelector('#editable-dialog');
const host = document.querySelector('#editable-host');
const status = document.querySelector('#editable-status');
const download = document.querySelector('#editable-download');
const original = document.querySelector('#editable-original');
const pdfLink = document.querySelector('#editable-pdf');
const list = document.querySelector('#editable-items');
const sources = document.querySelector('#editable-sources');
const retry = document.querySelector('#editable-retry');
const partial = document.querySelector('#editable-partial');
const content = document.querySelector('#editable-content');
const reference = document.querySelector('#editable-reference');
const referenceImage = document.querySelector('#editable-reference-image');
const referenceMessage = document.querySelector('#editable-reference-message');
const referenceScroll = document.querySelector('#editable-reference-scroll');
const loading = document.querySelector('#editable-loading');
const loadingDetail = document.querySelector('#editable-loading-detail');
const loadingTitle = document.querySelector('#editable-loading-title');
const loadingSpinner = document.querySelector('#editable-loading-spinner');
const imageMode = document.querySelector('#editable-image-mode');
const start = document.querySelector('#editable-start');
const reconvert = document.querySelector('#editable-reconvert');
const columnView = document.querySelector('#editable-column-view');
const pageView = document.querySelector('#editable-page-view');
const referenceToggle = document.querySelector('#editable-reference-toggle');
const information = document.querySelector('#editable-information');
const statusLabel = document.querySelector('#editable-status-label');
const reviewIssues = document.querySelector('#editable-review-issues');
const more = document.querySelector('#editable-more');
const layoutMode = document.querySelector('#editable-layout');
const zoomInput = document.querySelector('#editable-zoom');
const zoomOut = document.querySelector('#editable-zoom-out');
const zoomIn = document.querySelector('#editable-zoom-in');
const zoomFit = document.querySelector('#editable-zoom-fit');
let nativeZoomIntent = false;
let manualZoom = null; // Retain existing fit behavior until a user chooses a percentage.
let paperView = 'column';
let resizeFrame;
let fitting = false;
let editorPromise;
let editor;
let session;
let intent = 0;
let loadQueue = Promise.resolve();
let dirtyTimer;
let referenceUrls = [];

const active = (value) => session === value && dialog.open;
const ready = (item) => item.status === 'ready' || item.status === 'draft';
function setStatus(message, isError = false) {
  const quality = session?.loaded ? contentQualitySummary(session.items) : null;
  if (quality?.incomplete && !message.includes(quality.message)) message += ` ${quality.message}`;
  status.textContent = message;
  const warning = /초안|누락|실패|대조|확인 필요/u.test(message);
  information.classList.toggle('is-error', isError);
  information.classList.toggle('is-warning', warning && !isError);
  statusLabel.textContent = isError ? '확인 필요 ⓘ' : session?.phase === 'options' ? '변환 옵션 ⓘ'
    : session?.phase === 'converting' ? '생성 중 ⓘ' : session?.dirty ? '편집 중 ⓘ' : warning ? '원본 대조 ⓘ' : '편집 가능 ⓘ';
  statusLabel.title = message;
  reviewIssues.hidden = !quality?.incomplete;
  if (quality?.incomplete) {
    statusLabel.textContent = quality.label;
    information.classList.add('is-warning');
    information.open = true;
  }
  if (isError) information.open = true;
  status.classList.toggle('is-error', isError);
  if (!loading.hidden) loadingDetail.textContent = message;
}
reviewIssues.addEventListener('click', () => {
  more.open = true;
  sources.open = true;
  sources.querySelector('summary').focus();
});
function setBusy(value, busy) {
  if (!active(value)) return;
  loading.hidden = !busy;
  layoutMode.disabled = busy;
  for (const control of [zoomInput, zoomOut, zoomIn, zoomFit]) control.disabled = busy || !value.loaded;
  content.setAttribute('aria-busy', String(busy));
  status.setAttribute('aria-live', busy ? 'off' : 'polite');
  start.hidden = true;
  loadingSpinner.hidden = !busy;
  loadingTitle.textContent = '한글 문서 생성 중';
  reconvert.hidden = false;
}
const paintProgress = () => new Promise((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));

async function jumpToQuestion(value, id, button) {
  const instance = editor;
  if (!active(value) || !value.loaded || !instance) return;
  const navigation = value.navigation = (value.navigation || 0) + 1;
  try {
    const state = await instance.getDocumentState();
    if (!active(value) || navigation !== value.navigation) return;
    if (value.targetsSha !== state.documentSha256) {
      const bytes = await instance.exportHwpx();
      const targets = await readQuestionTargets(bytes);
      const after = await instance.getDocumentState();
      if (!active(value) || navigation !== value.navigation) return;
      if (state.documentSha256 !== after.documentSha256) throw new Error('편집 내용이 바뀌었습니다. 문항 카드를 다시 눌러 주세요.');
      value.targets = targets;
      value.targetsSha = state.documentSha256;
    }
    const target = value.targets?.[id];
    if (!target) throw new Error('이 문항의 이동 표시가 삭제되었습니다. 원본 카드에서 문항 번호를 확인해 주세요.');
    const result = await instance.focusTarget(target);
    if (!active(value) || navigation !== value.navigation) return;
    if (!result.focused) throw new Error('해당 문항으로 이동하지 못했습니다.');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!active(value) || navigation !== value.navigation) return;
    const studio = instance.element.contentDocument;
    const scroll = studio?.getElementById('scroll-container');
    const caret = studio?.querySelector('.caret');
    const top = Number.parseFloat(caret?.style.top);
    if (scroll && Number.isFinite(top)) scroll.scrollTop = Math.max(0, top - 24);
    pinColumnViewport();
    for (const card of referenceScroll.querySelectorAll('.editable-reference-jump')) card.setAttribute('aria-pressed', String(card === button));
  } catch (error) { if (active(value) && navigation === value.navigation) setStatus(error.message, true); }
}
function pdfHref(question) {
  const href = driveLink(driveFilePath(question.pdfFile));
  return href ? `${href}#page=${question.page}` : '';
}
function clearReference() {
  for (const url of referenceUrls) URL.revokeObjectURL(url);
  referenceUrls = [];
  for (const figure of referenceScroll.querySelectorAll('.editable-reference-item')) figure.remove();
  referenceImage.removeAttribute('src');
  referenceImage.hidden = true;
  referenceMessage.textContent = '원본 문항을 불러오는 중입니다.';
  referenceMessage.hidden = false;
  referenceScroll.scrollTop = 0;
  original.removeAttribute('href');
  original.hidden = true;
}
async function showCollectionReference(value, items) {
  referenceImage.hidden = true;
  referenceMessage.hidden = true;
  let previousPassage = '';
  const entries = items.flatMap((item) => {
    const regions = sharedPassageRegions(item.question);
    const key = passageKey(item.question);
    const passages = key && key !== previousPassage ? regions.map((region) => ({
      question: { ...item.question, ...region, displayBox: region.box }, passage: true,
    })) : [];
    previousPassage = key;
    return [...passages, item];
  });
  const slots = entries.map((item) => {
    const figure = document.createElement('figure');
    figure.className = 'editable-reference-item';
    const caption = document.createElement('span');
    caption.className = 'editable-reference-label';
    caption.textContent = `${item.question.exam} ${item.question.subjectLabel} ${item.passage ? '공통 지문' : `${item.question.no}번`}`;
    const note = document.createElement('p');
    note.textContent = '원본 문항을 불러오는 중입니다.';
    if (item.passage) figure.append(caption, note);
    else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'editable-reference-jump';
      button.dataset.questionId = item.question.id;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', `${caption.textContent} 편집 문항으로 이동`);
      button.addEventListener('click', () => void jumpToQuestion(value, item.question.id, button));
      button.append(caption, note);
      figure.append(button);
    }
    referenceScroll.append(figure);
    return { item, figure, note };
  });
  for (const { item, figure, note } of slots) {
    if (!active(value)) return;
    try {
      const url = await renderQuestion(item.question, 2);
      if (!active(value)) { URL.revokeObjectURL(url); return; }
      referenceUrls.push(url);
      const image = document.createElement('img');
      image.alt = `${item.question.exam} ${item.question.subjectLabel} ${item.passage ? '공통 지문' : `${item.question.no}번`} PDF 원본`;
      image.src = url;
      note.replaceWith(image);
      if (!value.collection && !item.passage) {
        original.href = url;
        original.hidden = false;
      }
    } catch {
      if (active(value)) note.textContent = '원본 이미지를 불러오지 못했습니다. 시험지 PDF에서 확인해 주세요.';
    }
    if (!figure.isConnected) return;
  }
}
function renderItems(value) {
  const labels = { pending: '대기', running: '분석 중', ready: '변환됨', draft: '색인 초안', error: '실패', cancelled: '취소됨' };
  list.replaceChildren(...value.items.map((item) => {
    const row = document.createElement('li');
    row.dataset.id = item.id;
    const text = document.createElement('span');
    const qualityLabel = item.result?.quality?.state === 'incomplete' ? ' · 복원 확인 필요'
      : item.result?.quality?.state === 'excluded' ? ' · 그림 제외' : '';
    row.dataset.quality = item.result?.quality?.state || '';
    text.textContent = `${item.result?.sourceLabel || (item.question ? `${item.question.pdfFile} · ${item.question.no}번` : item.id)} — ${labels[item.status]}${qualityLabel}${item.error ? `: ${item.error}` : ''}${value.loaded && !ready(item) ? ' (문서에서 제외)' : ''}`;
    row.append(text);
    if (item.result?.warnings?.length) {
      const warning = document.createElement('span');
      warning.className = 'editable-item-warning';
      warning.textContent = item.result.warnings.join(' ');
      row.append(warning);
    }
    if (item.question) {
      for (const [label, href] of [['PDF ↗', pdfHref(item.question)], ['원본 이미지 ↗', `./cards/${encodeURIComponent(item.id)}.webp`]]) {
        if (!href) continue;
        const link = document.createElement('a');
        link.textContent = label;
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener';
        row.append(link);
      }
    }
    return row;
  }));
}
function nativeZoom(studio) {
  const percent = studio?.getElementById('sb-zoom-display')?.textContent.match(/(\d+(?:\.\d+)?)\s*%/u);
  return percent ? Number(percent[1]) / 100 : 1;
}
function pinColumnViewport() {
  if (!session?.geometry || !editor || fitting) return;
  const studio = editor.element.contentDocument;
  const scroll = studio?.getElementById('scroll-container');
  const scroller = studio?.getElementById('scroll-content');
  const canvas = studio?.querySelector('.document-page-canvas');
  if (!scroll || !canvas || !scroller) return;
  if (paperView !== 'column') {
    scroller.style.transform = '';
    scroller.dataset.examShift = '0';
    return;
  }
  const zoom = nativeZoom(studio);
  const view = columnPresentation(session.geometry, scroll.clientWidth, zoom);
  const previousShift = Number(scroller.dataset.examShift || 0);
  const pageLeft = canvas.getBoundingClientRect().left - scroll.getBoundingClientRect().left
    + scroll.scrollLeft - previousShift;
  const shift = view.offset - pageLeft - view.cropStart;
  // Move the entire native scroll-content, including caret/selection layers.
  // Hit testing subtracts this container's actual bounding rectangle.
  scroller.style.transform = `translateX(${shift}px)`;
  scroller.dataset.examShift = String(shift);
  studio.documentElement.style.setProperty('--exam-column-left-crop', `${view.leftCrop}%`);
  studio.documentElement.style.setProperty('--exam-column-crop', `${view.rightCrop}%`);
  if (scroll.scrollLeft) scroll.scrollLeft = 0;
}
function applyStudioZoom(studio, zoom) {
  const slider = studio.getElementById('sb-zoom-range');
  slider.value = String(studioZoomSlider(zoom));
  slider.dispatchEvent(new studio.defaultView.Event('input', { bubbles: true }));
  // Native dragging snaps near 100%. Native keyboard increments accept an exact
  // percentage, so use those for the small rounding/snap correction.
  const value = Number(slider.value);
  const actual = value <= 500 ? Math.round(10 * 10 ** (value / 500))
    : Math.round(100 * 5 ** ((value - 500) / 500));
  let delta = Math.round(zoom * 100) - actual;
  while (delta) {
    const step = Math.abs(delta) >= 10 ? 10 : 1;
    const key = delta > 0 ? (step === 10 ? 'PageUp' : 'ArrowUp') : (step === 10 ? 'PageDown' : 'ArrowDown');
    slider.dispatchEvent(new studio.defaultView.KeyboardEvent('keydown', { key, bubbles: true }));
    delta += delta > 0 ? -step : step;
  }
}
async function fitEditorView() {
  const value = session;
  if (!value?.loaded || !editor || fitting) return;
  const studio = editor.element.contentDocument;
  const scroll = studio?.getElementById('scroll-container');
  if (!scroll) return;
  fitting = true;
  nativeZoomIntent = false;
  const requestedZoom = manualZoom;
  try {
    const state = await editor.getDocumentState();
    if (!active(value)) return;
    if (value.geometrySha !== state.documentSha256) {
      value.geometry = await readEditablePageGeometry(await editor.exportHwpx());
      if (!active(value)) return;
      value.geometrySha = state.documentSha256;
    }
    const canvas = studio.querySelector('.document-page-canvas');
    const oldZoom = nativeZoom(studio);
    const oldTop = scroll.scrollTop;
    const view = paperView === 'column' && columnViewport(value.geometry, scroll.clientWidth);
    studio.documentElement.dataset.examPaperView = view ? 'column' : 'page';
    if (view || requestedZoom !== null) {
      applyStudioZoom(studio, requestedZoom ?? view.zoom);
    } else {
      await editor.commands.execute('view:zoom-fit-width');
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!active(value)) return;
    const nextCanvas = studio.querySelector('.document-page-canvas');
    const newZoom = nativeZoom(studio);
    if (oldTop && oldZoom) scroll.scrollTop = oldTop * newZoom / oldZoom;
    if (paperView === 'page') scroll.scrollLeft = 0;
    syncZoomDisplay();
  } finally { fitting = false; }
  pinColumnViewport();
  syncZoomDisplay();
  if (manualZoom !== requestedZoom) scheduleEditorFit();
}
function syncZoomDisplay() {
  if (!session?.loaded || !editor || fitting) return;
  const studio = editor.element.contentDocument;
  const canvas = studio?.querySelector('.document-page-canvas');
  if (!canvas || !session.geometry?.width) return;
  const percent = Math.round(nativeZoom(studio) * 100);
  if (document.activeElement !== zoomInput) zoomInput.value = String(percent);
}
function setManualZoom(percent) {
  if (!session?.loaded || !Number.isFinite(percent)) return;
  nativeZoomIntent = false;
  manualZoom = Math.max(.1, Math.min(5, percent / 100));
  zoomInput.value = String(Math.round(manualZoom * 100));
  const studio = editor.element.contentDocument;
  const slider = studio?.getElementById('sb-zoom-range');
  if (slider) {
    applyStudioZoom(studio, manualZoom);
  }
  pinColumnViewport();
}
zoomInput.addEventListener('input', () => {
  const percent = Number(zoomInput.value);
  if (percent >= 10 && percent <= 500) setManualZoom(percent);
});
zoomInput.addEventListener('change', () => {
  if (!zoomInput.value) { syncZoomDisplay(); return; }
  setManualZoom(Number(zoomInput.value));
});
zoomOut.addEventListener('click', () => setManualZoom(Number(zoomInput.value) - 10));
zoomIn.addEventListener('click', () => setManualZoom(Number(zoomInput.value) + 10));
zoomFit.addEventListener('click', () => { manualZoom = null; void fitEditorView().then(syncZoomDisplay); });
layoutMode.addEventListener('change', () => {
  if (session?.phase === 'loaded') setStatus('문항 배치를 변경했습니다. 다시 변환을 누르면 적용됩니다.');
});
function scheduleEditorFit() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => void fitEditorView());
}
function syncReferenceView() {
  if (!session?.loaded) return;
  const visible = referenceToggle.getAttribute('aria-pressed') === 'true';
  reference.hidden = !visible;
  content.classList.toggle('has-reference', visible);
  scheduleEditorFit();
}
for (const [button, mode] of [[columnView, 'column'], [pageView, 'page']]) button.addEventListener('click', () => {
  paperView = mode;
  columnView.setAttribute('aria-pressed', String(mode === 'column'));
  pageView.setAttribute('aria-pressed', String(mode === 'page'));
  void fitEditorView();
});
referenceToggle.addEventListener('click', () => {
  referenceToggle.setAttribute('aria-pressed', String(referenceToggle.getAttribute('aria-pressed') !== 'true'));
  syncReferenceView();
});
const divider = document.querySelector('#editable-divider');
const stackedLayout = matchMedia('(max-width: 900px)');
let referenceWidth = 30;
let referenceHeight = 25;
let dividerPointer = null;
function updateDivider(value) {
  const stacked = stackedLayout.matches;
  const ratio = Math.min(65, Math.max(20, value));
  if (stacked) referenceHeight = ratio;
  else referenceWidth = ratio;
  content.style.setProperty(stacked ? '--editable-reference-height' : '--editable-reference-size', `${ratio}%`);
  divider.setAttribute('aria-orientation', stacked ? 'horizontal' : 'vertical');
  divider.setAttribute('aria-valuenow', String(Math.round(ratio)));
  divider.setAttribute('aria-valuetext', `원본 ${Math.round(ratio)}%, 변환 문서 ${Math.round(100 - ratio)}%`);
}
function resizeFromPointer(event) {
  const bounds = content.getBoundingClientRect();
  updateDivider(stackedLayout.matches
    ? (event.clientY - bounds.top) / bounds.height * 100
    : (event.clientX - bounds.left) / bounds.width * 100);
}
divider.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault();
  dividerPointer = event.pointerId;
  divider.setPointerCapture(event.pointerId);
  divider.focus();
  content.classList.add('is-resizing');
});
divider.addEventListener('pointermove', event => {
  if (event.pointerId === dividerPointer) resizeFromPointer(event);
});
function endDividerDrag() {
  dividerPointer = null;
  content.classList.remove('is-resizing');
  scheduleEditorFit();
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) divider.addEventListener(type, endDividerDrag);
divider.addEventListener('dblclick', () => updateDivider(stackedLayout.matches ? 25 : 30));
divider.addEventListener('keydown', event => {
  const previous = stackedLayout.matches ? referenceHeight : referenceWidth;
  const negative = stackedLayout.matches ? 'ArrowUp' : 'ArrowLeft';
  const positive = stackedLayout.matches ? 'ArrowDown' : 'ArrowRight';
  if (![negative, positive, 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  updateDivider(event.key === 'Home' ? 20 : event.key === 'End' ? 65 : previous + (event.key === negative ? -1 : 1) * (event.shiftKey ? 5 : 2));
});
stackedLayout.addEventListener('change', () => updateDivider(stackedLayout.matches ? referenceHeight : referenceWidth));
updateDivider(referenceWidth);
new ResizeObserver(scheduleEditorFit).observe(host);
for (const popup of [information, more]) popup.addEventListener('toggle', () => {
  if (popup.open) for (const other of [information, more]) if (other !== popup) other.open = false;
});
dialog.addEventListener('pointerdown', (event) => {
  for (const popup of [information, more]) if (!popup.contains(event.target)) popup.open = false;
});
dialog.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || ![information, more].some((popup) => popup.open)) return;
  const popup = [information, more].find((entry) => entry.open);
  popup.open = false;
  popup.querySelector('summary').focus();
  event.preventDefault();
  event.stopPropagation();
});

async function prepareEditor() {
  if (!editorPromise) editorPromise = import('./vendor/rhwp-editor/index.js').then(({ createEditor }) => createEditor(host, {
    studioUrl: new URL('./vendor/rhwp-studio/index.html?v=typography-20261003-1', import.meta.url).href,
    renderer: 'canvas2d', width: '100%', height: '100%',
  })).catch((error) => { editorPromise = null; throw error; });
  editor = await editorPromise;
  const studio = editor.element.contentDocument;
  if (studio && !studio.getElementById('exam-compact-chrome')) {
    const stylesheet = studio.createElement('link');
    stylesheet.id = 'exam-compact-chrome';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./editable-studio.css?v=resizable-editor-20261003-1', import.meta.url).href;
    const styled = new Promise((resolve) => {
      stylesheet.addEventListener('load', resolve, { once: true });
      stylesheet.addEventListener('error', resolve, { once: true });
    });
    studio.head.append(stylesheet);
    await styled;
    // Keep formatting controls available; the larger basic toolbox can be expanded from the menu.
    const documentMenu = studio.createElement('details');
    documentMenu.id = 'exam-document-menu';
    documentMenu.innerHTML = '<summary>문서 ⌄</summary>';
    const menuBar = studio.getElementById('menu-bar');
    menuBar.before(documentMenu);
    documentMenu.append(menuBar);
    studio.addEventListener('pointerdown', (event) => { if (!documentMenu.contains(event.target)) documentMenu.open = false; });
    studio.addEventListener('pointerdown', (event) => {
      if (event.isTrusted && event.target.closest('#sb-zoom-in, #sb-zoom-out, #sb-zoom-range, #sb-zoom-display, #sb-zoom-fit-width, #sb-zoom-fit')) nativeZoomIntent = true;
    });
    studio.addEventListener('keydown', (event) => {
      if (event.isTrusted && (event.target.id === 'sb-zoom-range' || ((event.ctrlKey || event.metaKey) && ['+', '-', '='].includes(event.key)))) nativeZoomIntent = true;
    });
    studio.getElementById('scroll-container').addEventListener('scroll', pinColumnViewport, { passive: true });
    new studio.defaultView.MutationObserver(pinColumnViewport).observe(studio.getElementById('scroll-content'), { childList: true });
    new studio.defaultView.MutationObserver(() => {
      pinColumnViewport();
      if (!fitting && session?.loaded) {
        if (nativeZoomIntent) manualZoom = nativeZoom(studio);
        syncZoomDisplay();
      }
    }).observe(studio.getElementById('sb-zoom-display'), { childList: true, subtree: true, characterData: true });
    if (studio.documentElement.dataset.toolboxBasic !== 'hidden') {
      await editor.commands.execute('view:toolbox-basic').catch(() => null);
    }
  }
  return editor;
}
async function syncDirty(value = session) {
  if (!value?.loaded || !editor) return;
  const state = await editor.getDocumentState();
  if (!active(value)) return;
  value.dirty ||= state.dirty || state.documentSha256 !== value.savedSha;
  if (value.dirty) setStatus(`편집한 내용이 있습니다. 내려받으면 수정본이 저장됩니다.${value.draft ? ' 색인 초안이 포함되어 있습니다.' : ''}`);
}
async function allowReplace() {
  try { await syncDirty(); } catch {
    if (session?.loaded) session.dirty = true;
  }
  return !session?.dirty || window.confirm('내려받지 않은 편집 내용이 있습니다. 버리고 계속할까요?');
}
async function begin(title, collection, context = {}) {
  const request = ++intent;
  if (!await allowReplace() || request !== intent) return null;
  session?.batch?.cancel();
  session?.controller?.abort();
  session?.choose?.(false);
  window.clearInterval(dirtyTimer);
  clearReference();
  const value = { ...context, collection, includeImages: imageMode.value === 'include', phase: 'options', items: [], loaded: false, dirty: false, savedSha: '', batch: null, controller: new AbortController() };
  session = value;
  download.disabled = true;
  retry.hidden = partial.hidden = true;
  const questionPdf = context.question ? pdfHref(context.question) : '';
  if (questionPdf) pdfLink.href = questionPdf;
  pdfLink.hidden = collection || !questionPdf;
  reference.hidden = collection;
  content.classList.toggle('has-reference', !collection);
  sources.hidden = !collection;
  sources.open = false;
  information.open = more.open = false;
  referenceToggle.setAttribute('aria-pressed', 'true');
  referenceToggle.disabled = true;
  columnView.disabled = pageView.disabled = true;
  layoutMode.disabled = false;
  for (const control of [zoomInput, zoomOut, zoomIn, zoomFit]) control.disabled = true;
  host.hidden = true;
  host.style.visibility = '';
  list.replaceChildren();
  dialog.classList.remove('is-unavailable');
  document.querySelector('#editable-title').textContent = title;
  setStatus('그림 포함 여부를 고른 뒤 변환을 시작하세요.');
  if (!dialog.open) dialog.showModal();
  content.setAttribute('aria-busy', 'false');
  status.setAttribute('aria-live', 'polite');
  loading.hidden = false;
  loadingSpinner.hidden = true;
  loadingTitle.textContent = '그림을 포함할까요?';
  loadingDetail.textContent = '본문·수식·보기는 편집 가능한 문서로 변환합니다. 그림 제외는 이미지 처리를 건너뛰고, 그림 포함은 그림 영역만 추가합니다.';
  start.hidden = false;
  reconvert.hidden = true;
  const chosen = await new Promise((resolve) => { value.choose = resolve; });
  if (!chosen || !active(value)) return null;
  value.choose = null;
  value.phase = 'converting';
  value.includeImages = imageMode.value === 'include';
  value.pagePerQuestion = layoutMode.value === 'question';
  setBusy(value, true);
  setStatus(value.includeImages ? '본문과 그림 영역을 변환하는 중입니다.' : '그림을 제외하고 본문·수식을 변환하는 중입니다.');
  await paintProgress();
  return active(value) ? value : null;
}
async function loadDocument(value, bytes, filename) {
  const operation = loadQueue.catch(() => {}).then(async () => {
    if (!active(value)) return;
    setStatus('생성한 한글 문서를 여는 중입니다.');
    const instance = await prepareEditor();
    if (!active(value)) return;
    try {
      await instance.loadFile(bytes, filename, { skipUnsavedGuard: true, suppressDialogs: true });
      if (!active(value)) return;
      const state = await instance.getDocumentState();
      if (!active(value)) return;
      value.savedSha = state.documentSha256;
      value.loaded = true;
      value.phase = 'loaded';
      value.dirty = false;
      value.filename = filename;
      value.targets = await readQuestionTargets(bytes);
      value.geometry = await readEditablePageGeometry(bytes);
      value.geometrySha = state.documentSha256;
      if (!active(value)) return;
      value.targetsSha = state.documentSha256;
      value.draft = value.items.some((item) => item.status === 'draft');
      host.hidden = false;
      host.style.visibility = 'hidden';
      await new Promise((resolve) => window.setTimeout(resolve, 160));
      if (!active(value)) return;
      await fitEditorView();
      const initialScroll = instance.element.contentDocument?.getElementById('scroll-container');
      if (initialScroll) initialScroll.scrollTop = 0;
      referenceToggle.disabled = columnView.disabled = pageView.disabled = false;
      syncReferenceView();
      host.style.visibility = '';
      setBusy(value, false);
      download.disabled = false;
      retry.hidden = partial.hidden = true;
      if (value.collection) sources.open = false;
      renderItems(value);
      const quality = contentQualitySummary(value.items);
      setStatus(value.draft
        ? '원본 PDF 분석에 실패해 색인 텍스트로 만든 편집 초안이 포함되어 있습니다. 수식·선지를 원본 PDF와 확인하세요.'
        : quality.message);
      statusLabel.textContent = quality.label;
      if (quality.incomplete) {
        information.open = true;
        information.classList.add('is-warning');
        sources.open = true;
      }
      sources.hidden = !value.collection && !value.items.some((item) => item.result?.warnings?.length);
      dirtyTimer = window.setInterval(() => { syncDirty(value).catch(() => {}); }, 1200);
    } catch (error) {
      instance.destroy();
      if (editor === instance) { editor = null; editorPromise = null; }
      throw error;
    }
  });
  loadQueue = operation;
  await operation;
}
function fail(value, error) {
  if (!active(value)) return;
  setBusy(value, false);
  setStatus(error instanceof Error ? error.message : '편집 문서를 열지 못했습니다.', true);
  download.disabled = true;
}
export async function openEditable(question) {
  const value = await begin(`${question.subjectLabel} ${question.no}번`, false, { question });
  if (!value) return;
  value.question = question;
  void showCollectionReference(value, [{ question }]);
  pdfLink.href = pdfHref(question);
  pdfLink.hidden = !pdfHref(question);
  try {
    const result = await resolveEditableContent(question, { signal: value.controller.signal, includeImages: value.includeImages,
      onPhase(message) { if (active(value)) setStatus(message); } });
    if (!active(value)) return;
    value.items = [{ id: question.id, question, result, status: result.provenance === 'index-draft' ? 'draft' : 'ready' }];
    setStatus('문항의 간격과 수식을 정리하는 중입니다.');
    await paintProgress();
    if (!active(value)) return;
    const bytes = await createCollectionHwpx([result], { pagePerQuestion: value.pagePerQuestion });
    if (!active(value)) return;
    await loadDocument(value, bytes, `${question.id}-${value.includeImages ? '그림포함' : '그림제외'}.hwpx`);
  } catch (error) { fail(value, error); }
}
function localDate() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}
async function openResults(value) {
  if (!active(value) || value.loaded) return;
  setBusy(value, true);
  retry.hidden = partial.hidden = true;
  const included = value.items.filter(ready);
  try {
    setStatus(`${included.length}개 문항을 한 문서로 구성하는 중입니다.`);
    await paintProgress();
    if (!active(value)) return;
    const bytes = await createCollectionHwpx(included.map((item) => item.result), { pagePerQuestion: value.pagePerQuestion });
    if (!active(value)) return;
    reference.hidden = false;
    content.classList.add('has-reference');
    void showCollectionReference(value, included.filter((item) => item.question));
    await loadDocument(value, bytes, `선택문항-${included.length}개-${localDate()}-${value.includeImages ? '그림포함' : '그림제외'}.hwpx`);
    if (active(value)) { value.batch.cancel(); value.batch = null; }
  } catch (error) { fail(value, error); }
}
async function runBatch(value, retrying = false) {
  retry.hidden = partial.hidden = true;
  setBusy(value, true);
  try {
    const state = await value.batch[retrying ? 'retryFailed' : 'run']();
    if (!active(value) || state.cancelled) return;
    value.items = state.items;
    renderItems(value);
    const count = value.items.filter(ready).length;
    const errors = value.items.length - count;
    if (!errors) return await openResults(value);
    setBusy(value, false);
    sources.open = true;
    more.open = true;
    setStatus(`${count}개 준비됨 · ${errors}개 실패. 실패 문항을 재시도하거나 성공한 문항만 열 수 있습니다.`, true);
    information.open = false;
    more.open = true;
    retry.hidden = false;
    partial.hidden = count === 0;
    partial.textContent = `성공한 ${count}개만 열기`;
  } catch (error) { fail(value, error); }
}
export async function openEditableCollection(ids) {
  const snapshot = [...ids];
  if (!snapshot.length) return;
  const value = await begin(`선택 문항 ${snapshot.length}개`, true, { ids: snapshot });
  if (!value) return;
  value.ids = snapshot;
  try {
    value.batch = createEditableBatch(snapshot, { includeImages: value.includeImages,
      onPhase(message, question) { if (active(value)) setStatus(`${question.no}번 · ${message}`); }, onProgress(state) {
      if (!active(value)) return;
      value.items = state.items;
      renderItems(value);
      setStatus(`문항 변환 ${state.completed} / ${state.total}개 완료`);
    } });
    await runBatch(value);
  } catch (error) { fail(value, error); }
}
async function requestClose() {
  const request = ++intent;
  if (!await allowReplace() || request !== intent) return;
  session?.batch?.cancel();
  session?.controller?.abort();
  session?.choose?.(false);
  session = null;
  window.clearInterval(dirtyTimer);
  clearReference();
  download.disabled = true;
  dialog.close();
}
document.querySelector('#editable-close').addEventListener('click', requestClose);
dialog.addEventListener('cancel', (event) => { event.preventDefault(); requestClose(); });
start.addEventListener('click', () => { if (session?.phase === 'options') session.choose?.(true); });
imageMode.addEventListener('change', () => {
  if (session?.phase === 'loaded') setStatus('그림 옵션을 변경했습니다. 다시 변환을 누르면 적용됩니다.');
});
reconvert.addEventListener('click', () => {
  const value = session;
  if (!value) return;
  if (value.collection) void openEditableCollection(value.ids);
  else void openEditable(value.question);
});
retry.addEventListener('click', () => { if (session?.batch && !session.loaded) runBatch(session, true); });
partial.addEventListener('click', () => { if (session?.batch && !session.loaded) openResults(session); });
document.addEventListener('open-editable-collection', (event) => { openEditableCollection(event.detail.ids); });
download.addEventListener('click', async () => {
  const value = session;
  const instance = editor;
  if (!value?.loaded || !instance) return;
  download.disabled = true;
  setStatus('편집본을 저장하는 중입니다.');
  try {
    const exportState = await instance.getDocumentState();
    if (!active(value)) return;
    const bytes = await instance.exportHwpx();
    if (!active(value)) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/hwp+zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = value.filename.replace(/\.hwpx$/u, '-edited.hwpx');
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    const afterExport = await instance.getDocumentState();
    if (!active(value)) return;
    if (afterExport.documentSha256 === exportState.documentSha256) await instance.notifySaved?.(link.download);
    if (!active(value)) return;
    const state = await instance.getDocumentState();
    if (!active(value)) return;
    value.savedSha = exportState.documentSha256;
    value.dirty = state.documentSha256 !== value.savedSha;
    setStatus(value.dirty
      ? `HWPX 파일을 내려받았습니다. 저장 중 추가한 수정은 아직 저장되지 않았습니다. 다시 내려받아 주세요.${value.draft ? ' 색인 초안이 포함되어 있습니다.' : ''}`
      : `수정한 HWPX 파일을 내려받았습니다.${value.draft ? ' 색인 초안이 포함되어 있습니다. 원본과 대조하세요.' : ' 원본은 변경되지 않았습니다.'}`);
  } catch (error) { if (active(value)) setStatus(error instanceof Error ? error.message : '편집본을 저장하지 못했습니다.', true); }
  finally { if (active(value)) download.disabled = false; }
});
window.addEventListener('beforeunload', (event) => {
  if (!session?.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});
