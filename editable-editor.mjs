const dialog = document.querySelector('#editable-dialog');
const host = document.querySelector('#editable-host');
const status = document.querySelector('#editable-status');
const download = document.querySelector('#editable-download');
const close = document.querySelector('#editable-close');

let editorPromise;
let editor;
let indexPromise;
let currentId = '';
let dirty = false;
let loading = false;
let dirtyTimer;
let savedSha = '';

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

async function entries() {
  if (!indexPromise) {
    indexPromise = fetch(new URL('./data/editable/index.json', import.meta.url))
      .then(async (response) => {
        if (response.status === 404) return {};
        if (!response.ok) throw new Error('편집 문서 목록을 불러오지 못했습니다.');
        const index = await response.json();
        return index.items || {};
      }).catch((error) => { indexPromise = null; throw error; });
  }
  return indexPromise;
}

async function prepareEditor() {
  if (!editorPromise) {
    editorPromise = import('./vendor/rhwp-editor/index.js').then(async ({ createEditor }) => {
      const instance = await createEditor(host, {
        studioUrl: new URL('./vendor/rhwp-studio/index.html', import.meta.url).href,
        renderer: 'canvas2d',
        width: '100%', height: '100%',
      });
      return instance;
    }).catch((error) => { editorPromise = null; throw error; });
  }
  editor = await editorPromise;
  return editor;
}

async function syncDirty() {
  if (!editor || loading || !dialog.open) return;
  const state = await editor.getDocumentState();
  if ((state.dirty || state.documentSha256 !== savedSha) && !dirty) {
    dirty = true;
    setStatus('편집한 내용이 있습니다. 내려받으면 수정본이 저장됩니다.');
  }
}

export async function openEditable(question) {
  if (dirty && !window.confirm('내려받지 않은 수정 내용이 있습니다. 다른 문항을 열까요?')) return;
  const questionId = question.id;
  currentId = questionId;
  dirty = false;
  savedSha = '';
  loading = true;
  download.disabled = true;
  dialog.classList.remove('is-unavailable');
  document.querySelector('#editable-title').textContent = `${question.subjectLabel} ${question.no}번`;
  setStatus('편집 가능한 문서를 준비하는 중입니다.');
  if (!dialog.open) dialog.showModal();
  try {
    if (location.protocol === 'file:') {
      throw new Error('rhwp 편집기는 파일 직접 열기에서 실행되지 않습니다. 공개 사이트 링크 또는 로컬 웹 서버로 접속해 주세요.');
    }
    const entry = (await entries())[questionId];
    if (entry?.status === 'unavailable') {
      throw new Error(entry.reason || '이 문항은 편집본을 안전하게 만들 수 없습니다.');
    }
    const preparedSource = entry?.status === 'needs_review' && entry.source;
    const preparedFile = entry?.status === 'needs_review' && entry.file;
    const prepared = preparedSource || preparedFile;
    setStatus(prepared ? '저장된 편집본과 rhwp를 불러오는 중입니다.' : '색인 텍스트를 편집 가능한 HWPX로 변환하는 중입니다.');
    const [instance, bytes] = await Promise.all([
      prepareEditor(),
      preparedSource
        ? fetch(new URL(preparedSource, location.href)).then(async (response) => {
          if (!response.ok) throw new Error('문항의 편집 데이터를 불러오지 못했습니다.');
          const questionData = await response.json();
          return import('./editable-convert.mjs').then(({ createPreparedHwpx }) => createPreparedHwpx(questionData));
        })
        : preparedFile ? fetch(new URL(preparedFile, location.href)).then(async (response) => {
          if (!response.ok) throw new Error('문항의 HWPX 파일을 불러오지 못했습니다.');
          return new Uint8Array(await response.arrayBuffer());
        })
        : import('./editable-convert.mjs').then(({ createEditableHwpx }) => createEditableHwpx(question)),
    ]);
    await instance.loadFile(bytes, `${questionId}.hwpx`, {
      skipUnsavedGuard: true, suppressDialogs: true,
    });
    savedSha = (await instance.getDocumentState()).documentSha256;
    dirty = false;
    download.disabled = false;
    setStatus(prepared
      ? 'PDF 원본 기반 편집 초안입니다. 그림은 생략됐으며, 원본과 문장·수식을 대조한 뒤 사용하세요.'
      : '색인 텍스트로 현장에서 만든 편집 초안입니다. 그림은 생략됐고 수식·선지·문장 순서가 틀릴 수 있으니 원본과 대조하세요.');
    window.clearInterval(dirtyTimer);
    dirtyTimer = window.setInterval(() => { syncDirty().catch(() => {}); }, 1200);
  } catch (error) {
    dialog.classList.add('is-unavailable');
    setStatus(error instanceof Error ? error.message : '편집 문서를 열지 못했습니다.', true);
  } finally {
    loading = false;
  }
}

async function requestClose() {
  await syncDirty().catch(() => {});
  if (dirty && !window.confirm('내려받지 않은 편집 내용이 있습니다. 닫을까요?')) return;
  window.clearInterval(dirtyTimer);
  dirty = false;
  dialog.close();
}

close.addEventListener('click', requestClose);
dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  requestClose();
});
download.addEventListener('click', async () => {
  if (!editor || !currentId) return;
  download.disabled = true;
  setStatus('편집본을 저장하는 중입니다.');
  try {
    const bytes = await editor.exportHwpx();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/hwp+zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentId}-edited.hwpx`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    await editor.notifySaved?.(link.download).catch(() => {});
    savedSha = (await editor.getDocumentState()).documentSha256;
    dirty = false;
    setStatus('수정한 HWPX 파일을 내려받았습니다. 원본은 변경되지 않았습니다.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '편집본을 저장하지 못했습니다.', true);
  } finally {
    download.disabled = false;
  }
});
window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});
