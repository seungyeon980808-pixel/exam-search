import { driveFilePath } from './data.mjs';
import { driveLink } from './drive-source.mjs';
import { editableEntries, resolveEditableContent } from './editable-source.mjs';
import { createEditableBatch } from './editable-batch.mjs';
import { createPreparedHwpx, createCollectionHwpx } from './editable-convert.mjs';

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
let editorPromise;
let editor;
let session;
let intent = 0;
let loadQueue = Promise.resolve();
let dirtyTimer;

const active = (value) => session === value && dialog.open;
const ready = (item) => item.status === 'ready' || item.status === 'draft';
function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}
function pdfHref(question) {
  const href = driveLink(driveFilePath(question.pdfFile));
  return href ? `${href}#page=${question.page}` : '';
}
function renderItems(value) {
  const labels = { pending: '대기', running: '분석 중', ready: '준비됨', draft: '색인 초안', error: '실패', cancelled: '취소됨' };
  list.replaceChildren(...value.items.map((item) => {
    const row = document.createElement('li');
    row.dataset.id = item.id;
    const text = document.createElement('span');
    text.textContent = `${item.result?.sourceLabel || (item.question ? `${item.question.pdfFile} · ${item.question.no}번` : item.id)} — ${labels[item.status]}${item.error ? `: ${item.error}` : ''}${value.loaded && !ready(item) ? ' (문서에서 제외)' : ''}`;
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
async function prepareEditor() {
  if (!editorPromise) editorPromise = import('./vendor/rhwp-editor/index.js').then(({ createEditor }) => createEditor(host, {
    studioUrl: new URL('./vendor/rhwp-studio/index.html', import.meta.url).href,
    renderer: 'canvas2d', width: '100%', height: '100%',
  })).catch((error) => { editorPromise = null; throw error; });
  editor = await editorPromise;
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
async function begin(title, collection) {
  const request = ++intent;
  if (!await allowReplace() || request !== intent) return null;
  session?.batch?.cancel();
  window.clearInterval(dirtyTimer);
  const value = { collection, items: [], loaded: false, dirty: false, savedSha: '', batch: null };
  session = value;
  download.disabled = true;
  retry.hidden = partial.hidden = true;
  original.hidden = pdfLink.hidden = collection;
  sources.hidden = !collection;
  sources.open = false;
  host.hidden = true;
  list.replaceChildren();
  dialog.classList.remove('is-unavailable');
  document.querySelector('#editable-title').textContent = title;
  setStatus('편집 가능한 문서를 준비하는 중입니다.');
  if (!dialog.open) dialog.showModal();
  return value;
}
async function loadDocument(value, bytes, filename) {
  const operation = loadQueue.catch(() => {}).then(async () => {
    if (!active(value)) return;
    const instance = await prepareEditor();
    if (!active(value)) return;
    try {
      await instance.loadFile(bytes, filename, { skipUnsavedGuard: true, suppressDialogs: true });
      if (!active(value)) return;
      const state = await instance.getDocumentState();
      if (!active(value)) return;
      value.savedSha = state.documentSha256;
      value.loaded = true;
      value.dirty = false;
      value.filename = filename;
      value.draft = value.items.some((item) => item.status === 'draft');
      host.hidden = false;
      download.disabled = false;
      retry.hidden = partial.hidden = true;
      renderItems(value);
      setStatus(value.draft
        ? '원본 PDF 분석에 실패해 색인 텍스트로 만든 편집 초안이 포함되어 있습니다. 수식·선지를 원본 PDF와 확인하세요.'
        : '편집 가능한 문서입니다. 그림·도표는 생략됐습니다. 원본 PDF와 문장·수식을 대조한 뒤 사용하세요.');
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
  setStatus(error instanceof Error ? error.message : '편집 문서를 열지 못했습니다.', true);
  download.disabled = true;
}
export async function openEditable(question) {
  const value = await begin(`${question.subjectLabel} ${question.no}번`, false);
  if (!value) return;
  original.href = `./cards/${encodeURIComponent(question.id)}.webp`;
  original.hidden = false;
  pdfLink.href = pdfHref(question);
  pdfLink.hidden = !pdfHref(question);
  try {
    const entry = (await editableEntries())[question.id];
    if (!active(value)) return;
    let bytes;
    if (entry?.status === 'needs_review' && entry.file && !entry.source) {
      const response = await fetch(new URL(entry.file, location.href));
      if (!response.ok) throw new Error('문항의 HWPX 파일을 불러오지 못했습니다.');
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      const result = await resolveEditableContent(question);
      if (!active(value)) return;
      value.items = [{ id: question.id, question, result, status: result.provenance === 'index-draft' ? 'draft' : 'ready' }];
      bytes = await createPreparedHwpx({ schema: 'exam-editable-v1', status: 'needs_review',
        blocks: result.paragraphs.map((runs) => ({ role: 'body', runs })) });
    }
    if (!active(value)) return;
    await loadDocument(value, bytes, `${question.id}.hwpx`);
  } catch (error) { fail(value, error); }
}
function localDate() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}
async function openResults(value) {
  if (!active(value) || value.loaded) return;
  retry.hidden = partial.hidden = true;
  const included = value.items.filter(ready);
  try {
    setStatus(`${included.length}개 문항을 한 문서로 구성하는 중입니다.`);
    const bytes = await createCollectionHwpx(included.map((item) => item.result));
    if (!active(value)) return;
    await loadDocument(value, bytes, `선택문항-${included.length}개-${localDate()}.hwpx`);
    if (active(value)) { value.batch.cancel(); value.batch = null; }
  } catch (error) { fail(value, error); }
}
async function runBatch(value, retrying = false) {
  retry.hidden = partial.hidden = true;
  try {
    const state = await value.batch[retrying ? 'retryFailed' : 'run']();
    if (!active(value) || state.cancelled) return;
    value.items = state.items;
    renderItems(value);
    const count = value.items.filter(ready).length;
    const errors = value.items.length - count;
    if (!errors) return await openResults(value);
    sources.open = true;
    setStatus(`${count}개 준비됨 · ${errors}개 실패. 실패 문항을 재시도하거나 성공한 문항만 열 수 있습니다.`, true);
    retry.hidden = false;
    partial.hidden = count === 0;
    partial.textContent = `성공한 ${count}개만 열기`;
  } catch (error) { fail(value, error); }
}
export async function openEditableCollection(ids) {
  const snapshot = [...ids];
  if (!snapshot.length) return;
  const value = await begin(`선택 문항 ${snapshot.length}개`, true);
  if (!value) return;
  try {
    value.batch = createEditableBatch(snapshot, { onProgress(state) {
      if (!active(value)) return;
      value.items = state.items;
      renderItems(value);
      setStatus(`${state.total}개 중 ${state.completed}개 처리 · 문항별 상태는 목록에서 확인할 수 있습니다.`);
    } });
    await runBatch(value);
  } catch (error) { fail(value, error); }
}
async function requestClose() {
  const request = ++intent;
  if (!await allowReplace() || request !== intent) return;
  session?.batch?.cancel();
  session = null;
  window.clearInterval(dirtyTimer);
  download.disabled = true;
  dialog.close();
}
document.querySelector('#editable-close').addEventListener('click', requestClose);
dialog.addEventListener('cancel', (event) => { event.preventDefault(); requestClose(); });
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
