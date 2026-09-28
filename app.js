import { driveFilePath, getJson } from './data.mjs';
import { driveLink } from './drive-source.mjs';
import { renderFilePages, renderFileThumbnail, renderQuestion } from './pdf-viewer.mjs';
import { curriculumDisplayState } from './search.mjs';
import { openEditable } from './editable-editor.mjs';
import { createQuestionSelection } from './question-selection.mjs';

const $ = (selector) => document.querySelector(selector);
const shell = $('.app-shell');
const tokensNode = $('#tokens');
const input = $('#keyword-input');
const help = $('#search-help');
const list = $('#result-list');
const cardLayoutObserver = new ResizeObserver((entries) => {
  if (!shell.classList.contains('is-split')) return;
  const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0;
  for (const { target } of entries) {
    if (target.hidden) continue;
    const height = target.getBoundingClientRect().height;
    if (height) target.style.setProperty('--masonry-span', String(Math.ceil(height + gap)));
  }
});
const loadMore = $('#load-more');
const previewToggle = $('#preview-toggle');
const group = $('#group-filter');
const subject = $('#subject-filter');
const year = $('#year-filter');
const month = $('#month-filter');
const framework = $('#framework-filter');
const unit = $('#unit-filter');
const standard = $('#standard-filter');
const answerToggle = $('#answer-toggle');
const viewer = $('#image-viewer');
const pageSize = 9;
const filePageSize = 12;
const state = { mode: 'questions', tokens: [], total: 0, baseOffset: 0, offset: 0, page: 0, selectedId: '', selectedFile: '', requestId: 0, selectionRequestId: 0, fileRequestId: 0, navigating: false, zoom: 100 };
const initialParams = new URLSearchParams(location.search);
let initialSelectionPending = true;
let activeQuestionObjectUrl = null;
let stopFileRendering = null;
let answerRequestId = 0;
let availableSubjects = [];
const previewUrls = new Map();
const previewQueue = [];
let activePreviews = 0;
const previewObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting || entry.target.hidden) continue;
    previewObserver.unobserve(entry.target);
    const task = entry.target.previewTask;
    if (task) {
      previewQueue.push(task);
      runPreviewQueue();
    }
  }
}, { rootMargin: '200px 0px' });

function runPreviewQueue() {
  while (activePreviews < 2 && previewQueue.length) {
    const task = previewQueue.shift();
    if (!task.element.isConnected) continue;
    activePreviews += 1;
    void task.render().then((url) => {
      if (!task.element.isConnected) { URL.revokeObjectURL(url); return; }
      previewUrls.set(task.element, url);
      task.image.onload = () => {
        if (!task.element.isConnected) return;
        task.placeholder?.remove();
        task.preview.classList.remove('is-loading', 'is-error');
      };
      task.image.onerror = () => {
        if (!task.element.isConnected) return;
        task.preview.classList.remove('is-loading');
        task.preview.classList.add('is-error');
        task.preview.textContent = '원본 PDF에서 확인';
      };
      task.image.hidden = false;
      task.image.src = url;
    }).catch(() => {
      if (task.element.isConnected) {
        task.preview.classList.remove('is-loading');
        task.preview.classList.add('is-error');
        task.preview.textContent = '원본 PDF에서 확인';
      }
    }).finally(() => { activePreviews -= 1; runPreviewQueue(); });
  }
}

function clearPreviews() {
  previewObserver.disconnect();
  previewQueue.length = 0;
  for (const url of previewUrls.values()) URL.revokeObjectURL(url);
  previewUrls.clear();
}

function updateSubjectOptions(selected = '') {
  const details = group.value === 'science' || group.value === 'social' || group.value === 'other';
  const control = $('#subject-filter-control');
  control.hidden = !details;
  $('#search-form').classList.toggle('has-details', details);
  subject.replaceChildren(new Option('전체 세부과목', ''));
  if (details) {
    for (const entry of availableSubjects.filter((item) => item.group === group.value)) {
      subject.add(new Option(entry.label, entry.value));
    }
  }
  subject.disabled = !details;
  subject.value = [...subject.options].some((option) => option.value === selected) ? selected : '';
}

function officialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['www.suneung.re.kr', 'www.moe.go.kr', 'www.ncic.re.kr', 'ncic.re.kr']
      .includes(url.hostname) ? url.href : '';
  } catch { return ''; }
}

function answerHref(entry) {
  const path = entry.sourcePath || driveFilePath(entry.sourceFile);
  const gateway = path ? driveLink(path) : '';
  if (gateway) return `${gateway}#page=${Number(entry.sourcePage) || 1}`;
  return officialUrl(entry.sourceUrl);
}

async function renderAnswers() {
  const requestId = ++answerRequestId;
  const detail = $('#answer-detail');
  detail.hidden = true;
  for (const card of list.querySelectorAll('.result-card')) card.querySelector('.card-answer')?.remove();
  if (!answerToggle.checked) return;
  const selectedId = state.selectedId;
  const cards = [...list.querySelectorAll('.result-card:not([hidden])')];
  const results = await Promise.allSettled([selectedId, ...cards.map((card) => card.dataset.id)]
    .map((id) => id ? getJson(`/api/answer?id=${encodeURIComponent(id)}`) : null));
  if (requestId !== answerRequestId || !answerToggle.checked) return;
  const selected = results[0].status === 'fulfilled' ? results[0].value : null;
  if (selectedId && state.selectedId === selectedId) {
    detail.hidden = false;
    $('#answer-value').textContent = selected?.answer != null ? String(selected.answer) : '확인 필요';
    $('#answer-note').textContent = selected?.answer != null ? '공식 확정 정답표 대조 완료' : '검증된 정답 연결이 없습니다.';
    const source = $('#answer-source');
    const href = selected ? answerHref(selected) : '';
    if (href) source.href = href;
    else source.removeAttribute('href');
    source.hidden = !href;
  }
  for (const [index, card] of cards.entries()) {
    const result = results[index + 1];
    const entry = result.status === 'fulfilled' ? result.value : null;
    const badge = document.createElement('span');
    badge.className = 'card-answer';
    badge.textContent = entry?.answer != null ? `정답 ${entry.answer}` : '정답 확인 필요';
    card.append(badge);
  }
}

let selectedQuestion = null;
const selection = createQuestionSelection();
const selectionLabels = new Map();
const selectionToolbar = $('#selection-toolbar');
$('.pane-actions').prepend(selectionToolbar);

function renderSelection() {
  const ids = selection.snapshot();
  selectionToolbar.hidden = !ids.length;
  $('#selection-count').textContent = `선택 ${ids.length}개`;
  $('#selection-open').disabled = !ids.length;
  if (!ids.length) $('#selection-toggle').setAttribute('aria-expanded', 'false');
  $('#selection-tray').hidden = !ids.length || $('#selection-toggle').getAttribute('aria-expanded') !== 'true';
  for (const checkbox of list.querySelectorAll('.question-selection input')) {
    checkbox.checked = selection.has(checkbox.closest('.question-item').dataset.id);
  }
  $('#detail-selection').disabled = !selectedQuestion;
  $('#detail-selection').checked = !!selectedQuestion && selection.has(selectedQuestion.id);
  const items = ids.map((id, index) => {
    const row = document.createElement('li');
    row.dataset.id = id;
    const name = document.createElement('span');
    name.className = 'selection-name';
    name.textContent = `${index + 1}. ${selectionLabels.get(id) || id}`;
    const actions = document.createElement('div');
    actions.className = 'selection-item-actions';
    for (const [action, text, disabled] of [['up', '위로', index === 0], ['down', '아래로', index === ids.length - 1], ['remove', '제거', false]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button secondary';
      button.dataset.action = action;
      button.textContent = text;
      button.disabled = disabled;
      button.setAttribute('aria-label', `${selectionLabels.get(id) || id} ${text}`);
      actions.append(button);
    }
    row.append(name, actions);
    return row;
  });
  $('#selection-list').replaceChildren(...items);
}

function setHelp(message, error = false) {
  help.textContent = message;
  help.classList.toggle('is-error', error);
}

function renderTokens() {
  tokensNode.replaceChildren();
  for (const word of state.tokens) {
    const token = document.createElement('button');
    token.type = 'button';
    token.className = 'token';
    token.dataset.word = word;
    token.setAttribute('aria-label', `${word} 단어 삭제`);
    const label = document.createElement('span');
    label.textContent = word;
    const remove = document.createElement('span');
    remove.setAttribute('aria-hidden', 'true');
    remove.textContent = '×';
    token.append(label, remove);
    tokensNode.append(token);
  }
  input.placeholder = state.tokens.length === 3 ? '' : state.mode === 'files' ? '시험지 속 문항 검색' : '문항 검색';
  input.disabled = state.tokens.length === 3;
}

function addInputWords() {
  const incoming = input.value.trim().split(/[#，,\s]+/u).filter(Boolean);
  if (!incoming.length) return true;
  const joined = [...new Set([...state.tokens, ...incoming])];
  if (joined.length > 3) {
    setHelp('검색어는 최대 세 단어입니다. 입력한 단어를 줄여 주세요.', true);
    return false;
  }
  state.tokens = joined;
  input.value = '';
  renderTokens();
  setHelp(joined.length ? `${joined.length}개 단어를 모두 포함하는 문항을 찾습니다.` : '단어를 입력하고 Enter를 누르세요.');
  return true;
}

function queryUrl(offset) {
  const params = new URLSearchParams();
  if (state.tokens.length) params.set('q', state.tokens.join(' '));
  if (group.value) params.set('group', group.value);
  if (subject.value) params.set('subject', subject.value);
  if (year.value) { params.set('yearFrom', year.value); params.set('yearTo', year.value); }
  if (month.value) params.set('month', month.value);
  if (framework.value) params.set('framework', framework.value);
  if (unit.value) params.set('unit', unit.value);
  if (standard.value) params.set('standard', standard.value);
  params.set('offset', String(offset));
  if (state.mode === 'questions' && initialSelectionPending && initialParams.get('id')) {
    params.set('focus', initialParams.get('id'));
    params.set('pageSize', String(pageSize));
  }
  if (state.mode === 'files' && initialSelectionPending && initialParams.get('file')) {
    params.set('focus', initialParams.get('file'));
    params.set('pageSize', String(filePageSize));
  }
  return `/${state.mode === 'files' ? 'api/files' : 'api/search'}?${params}`;
}

function updateAddress() {
  const params = new URLSearchParams();
  if (state.tokens.length) params.set('q', state.tokens.join(' '));
  if (group.value) params.set('group', group.value);
  if (subject.value) params.set('subject', subject.value);
  if (year.value) params.set('year', year.value);
  if (month.value) params.set('month', month.value);
  if (framework.value) params.set('framework', framework.value);
  if (unit.value) params.set('unit', unit.value);
  if (standard.value) params.set('standard', standard.value);
  if (state.mode === 'files') params.set('mode', 'files');
  if (shell.classList.contains('is-split') || shell.classList.contains('is-file-preview')) params.set('view', 'split');
  if ((shell.classList.contains('is-detail') || shell.classList.contains('is-split')) && state.selectedId) params.set('id', state.selectedId);
  if (shell.classList.contains('is-file-preview') && state.selectedFile) params.set('file', state.selectedFile);
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
}

function setPreviewMode(open) {
  if (state.mode === 'files') return;
  shell.classList.toggle('is-split', open);
  shell.classList.remove('is-detail');
  previewToggle.setAttribute('aria-pressed', String(open));
  previewToggle.textContent = open ? '미리보기 닫기' : '미리보기 열기';
  $('#mobile-back').textContent = open ? '← 결과만 보기' : '← 검색 결과';
  updateAddress();
}

function setFilePreviewMode(open) {
  shell.classList.toggle('is-file-preview', open);
  previewToggle.setAttribute('aria-pressed', String(open));
  previewToggle.textContent = open ? '미리보기 닫기' : '미리보기 열기';
  if (!open) $('#file-preview').hidden = true;
  updateAddress();
}

function setResultMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  selectedQuestion = null;
  state.requestId += 1;
  state.selectionRequestId += 1;
  state.fileRequestId += 1;
  shell.classList.remove('is-split', 'is-detail', 'is-file-preview');
  $('#file-preview').hidden = true;
  shell.classList.toggle('is-files', mode === 'files');
  list.classList.toggle('file-list', mode === 'files');
  $('#mode-questions').setAttribute('aria-pressed', String(mode === 'questions'));
  $('#mode-files').setAttribute('aria-pressed', String(mode === 'files'));
  previewToggle.hidden = false;
  previewToggle.setAttribute('aria-pressed', 'false');
  previewToggle.textContent = '미리보기 열기';
  $('#result-sort').textContent = mode === 'files' ? '최신순' : '관련도 · 최신순';
  renderTokens();
  updateAddress();
}

function cardUrl(item) {
  if (item.cardPath) return item.cardPath;
  // Existing science assets remain available; newly indexed subjects render from PDF on demand.
  return /^[pbce][12]_\d{4}_(06|09|11)_\d{2}$/u.test(item.id)
    ? `./cards/${encodeURIComponent(item.id)}.webp` : '';
}

function cardFor(item) {
  const wrapper = document.createElement('div');
  wrapper.className = 'result-item question-item';
  wrapper.dataset.id = item.id;
  const labelText = `${item.exam} · ${item.subjectLabel} ${item.no}번`;
  selectionLabels.set(item.id, labelText);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'result-card';
  button.dataset.id = item.id;
  button.setAttribute('aria-current', String(item.id === state.selectedId));
  const meta = document.createElement('span');
  meta.className = 'result-meta';
  meta.textContent = labelText;
  const preview = document.createElement('span');
  preview.className = 'result-preview is-loading';
  const image = document.createElement('img');
  image.loading = 'lazy';
  image.decoding = 'async';
  const thumbnail = cardUrl(item);
  image.alt = `${item.exam} ${item.subjectLabel} ${item.no}번 PDF 원본 문항`;
  if (thumbnail) {
    image.src = thumbnail;
    image.onload = () => preview.classList.remove('is-loading');
    image.onerror = () => {
      preview.classList.remove('is-loading');
      preview.classList.add('is-error');
      preview.append(document.createTextNode('원본 미리보기를 불러오지 못했습니다. 눌러서 문항을 확인하세요.'));
    };
    preview.append(image);
  } else {
    image.hidden = true;
    const placeholder = document.createElement('span');
    placeholder.textContent = '원본 미리보기를 만드는 중…';
    preview.append(image, placeholder);
    button.previewTask = { element: button, image, preview, placeholder, render: () => renderQuestion(item, 1.3) };
    previewObserver.observe(button);
  }
  button.append(meta, preview);
  const tags = document.createElement('span');
  tags.className = 'result-tags';
  tags.textContent = item.tags?.length ? item.tags.slice(0, 3).join(' · ') : '단원 미분류';
  button.append(tags);
  const label = document.createElement('label');
  label.className = 'question-selection card-selection';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = selection.has(item.id);
  checkbox.setAttribute('aria-label', `${labelText} 선택`);
  const caption = document.createElement('span');
  caption.textContent = '선택';
  label.append(checkbox, caption);
  wrapper.append(button, label);
  cardLayoutObserver.observe(wrapper);
  return wrapper;
}

function fileRowFor(item) {
  const row = document.createElement('div');
  row.className = 'result-item file-row';
  row.dataset.file = item.pdfFile;
  row.setAttribute('aria-current', String(item.pdfFile === state.selectedFile));
  const select = document.createElement('button');
  select.type = 'button';
  select.className = 'file-select';
  select.setAttribute('aria-label', `${item.pdfFile} 시험지 미리보기`);
  select.addEventListener('click', () => selectFile(item));
  const preview = document.createElement('span');
  preview.className = 'file-thumbnail';
  const image = document.createElement('img');
  image.loading = 'lazy';
  image.decoding = 'async';
  image.width = 100;
  image.height = 130;
  const hasStaticThumbnail = /^[pbce][12]_\d{4}_(06|09|11)\.pdf$/u.test(item.pdfFile);
  if (hasStaticThumbnail) image.src = `./thumbnails/${encodeURIComponent(item.pdfFile.replace(/\.pdf$/u, ''))}.webp`;
  image.alt = `${item.pdfFile} 첫 페이지 미리보기`;
  image.onerror = () => {
    image.remove();
    preview.textContent = '미리보기 없음';
  };
  let placeholder;
  if (!hasStaticThumbnail) {
    preview.classList.add('is-loading');
    image.hidden = true;
    placeholder = document.createElement('span');
    placeholder.textContent = '미리보기 생성 중';
  }
  preview.append(image);
  if (placeholder) preview.append(placeholder);
  const text = document.createElement('span');
  text.className = 'file-description';
  const name = document.createElement('strong');
  name.textContent = item.pdfFile;
  const exam = document.createElement('span');
  exam.textContent = `${item.exam} · ${item.subjectLabel}`;
  const count = document.createElement('span');
  count.className = 'file-count';
  count.textContent = item.questionCount === 0 ? '문항 색인 확인 필요'
    : state.tokens.length ? `일치 문항 ${item.matchedCount}개` : `문항 ${item.questionCount}개`;
  text.append(name, exam, count);
  const open = document.createElement('a');
  open.className = 'file-open';
  const href = driveLink(driveFilePath(item.pdfFile));
  open.href = href ? `${href}#page=${item.firstMatchPage || 1}` : '';
  open.hidden = !href;
  open.target = '_blank';
  open.rel = 'noopener';
  open.textContent = 'PDF 열기 ↗';
  select.append(preview, text);
  row.append(select, open);
  if (!hasStaticThumbnail) {
    row.previewTask = { element: row, image, preview, placeholder, render: () => renderFileThumbnail(item.pdfFile) };
    previewObserver.observe(row);
  }
  return row;
}

async function selectFile(item) {
  const fileRequestId = ++state.fileRequestId;
  state.selectedFile = item.pdfFile;
  for (const row of list.querySelectorAll('.file-row')) {
    row.setAttribute('aria-current', String(row.dataset.file === item.pdfFile));
  }
  const href = driveLink(driveFilePath(item.pdfFile));
  $('#file-preview-title').textContent = item.pdfFile;
  $('#file-preview-open').href = href ? `${href}#page=${item.firstMatchPage || 1}` : '';
  $('#file-preview-open').hidden = !href;
  $('#detail-empty').hidden = true;
  $('#detail-content').hidden = true;
  $('#file-preview').hidden = false;
  const pages = $('#file-preview-pages');
  pages.textContent = '시험지 페이지를 불러오는 중…';
  setFilePreviewMode(true);
  stopFileRendering?.();
  stopFileRendering = null;
  try {
    stopFileRendering = await renderFilePages(item.pdfFile, pages, item.firstMatchPage || 1,
      () => fileRequestId === state.fileRequestId);
  } catch (error) {
    if (fileRequestId === state.fileRequestId) pages.textContent = error.message;
  }
}

function showPage(page) {
  state.page = page;
  const cards = [...list.querySelectorAll('.result-item')];
  const first = page * (state.mode === 'files' ? filePageSize : pageSize) - state.baseOffset;
  const visible = state.mode === 'files' ? filePageSize : pageSize;
  for (const [index, card] of cards.entries()) card.hidden = index < first || index >= first + visible;
  if (answerToggle.checked) void renderAnswers().catch((error) => setHelp(error.message, true));
  const pages = Math.ceil(state.total / visible);
  $('#results-pagination').hidden = pages <= 1;
  $('#page-position').textContent = `${page + 1} / ${pages}`;
  $('#previous-page').disabled = page === 0;
  loadMore.disabled = page >= pages - 1;
}

function updateNavigation() {
  const cards = [...list.querySelectorAll('.result-card')];
  const position = cards.findIndex((card) => card.dataset.id === state.selectedId);
  $('#nav-position').textContent = position < 0 ? '' : `${state.baseOffset + position + 1} / ${state.total}`;
  $('#previous-question').disabled = position < 0 || (position === 0 && state.baseOffset === 0);
  $('#next-question').disabled = position < 0 || (position === cards.length - 1 && state.offset >= state.total);
}

async function search(reset = true) {
  const requestId = ++state.requestId;
  const filesMode = state.mode === 'files';
  if (reset) {
    state.selectionRequestId += 1;
    state.fileRequestId += 1;
    state.baseOffset = 0;
    state.offset = 0;
    state.page = 0;
    state.selectedId = '';
    state.selectedFile = '';
    shell.classList.remove('is-detail');
    if (shell.classList.contains('is-file-preview')) setFilePreviewMode(false);
    previewToggle.disabled = true;
    clearPreviews();
    cardLayoutObserver.disconnect();
    list.replaceChildren();
    $('#result-count').textContent = '검색 중…';
  }
  try {
    const data = await getJson(queryUrl(state.offset));
    if (requestId !== state.requestId) return;
    state.total = data.total;
    previewToggle.disabled = !data.total;
    $('#result-sort').textContent = filesMode && !state.tokens.length ? '최신순' : '관련도 · 최신순';
    $('#result-count').textContent = `${filesMode ? '시험지' : '검색 결과'} ${data.total.toLocaleString('ko-KR')}개`;
    if (reset && !data.total) {
      if (shell.classList.contains('is-split')) setPreviewMode(false);
      const empty = document.createElement('p');
      empty.className = 'list-message';
      empty.textContent = filesMode
        ? '조건에 맞는 시험지가 없습니다. 검색어를 줄이거나 필터를 바꿔 보세요.'
        : '조건에 맞는 문항이 없습니다. 단어를 하나 줄이거나 과목·연도 필터를 바꿔 보세요.';
      list.append(empty);
      $('#detail-content').hidden = true;
      $('#detail-empty').hidden = false;
      updateNavigation();
    }
    if (reset) {
      state.baseOffset = data.offset;
      state.page = Math.floor(data.offset / (filesMode ? filePageSize : pageSize));
    }
    list.append(...data.items.map(filesMode ? fileRowFor : cardFor));
    state.offset = data.offset + data.items.length;
    showPage(state.page);
    if (reset && filesMode && initialSelectionPending) {
      initialSelectionPending = false;
      const preferred = initialParams.get('file');
      const target = data.items.find((item) => item.pdfFile === preferred)
        || (initialParams.get('view') === 'split' ? data.items[0] : null);
      if (target) selectFile(target);
    }
    if (reset && !filesMode) {
      let preferred = null;
      if (initialSelectionPending) {
        initialSelectionPending = false;
        preferred = initialParams.get('id');
        if (initialParams.get('view') === 'split' && data.items.length) setPreviewMode(true);
      }
      const target = data.items.find((item) => item.id === preferred)?.id
        || (shell.classList.contains('is-split') ? data.items[0]?.id : null);
      if (target) await selectQuestion(target, !shell.classList.contains('is-split'));
    }
    if (!filesMode) updateNavigation();
    updateAddress();
  } catch (error) {
    if (requestId !== state.requestId) return;
    if (reset) {
      if (shell.classList.contains('is-split')) setPreviewMode(false);
      $('#result-count').textContent = '검색할 수 없습니다';
      const failure = document.createElement('p');
      failure.className = 'list-message';
      failure.textContent = error.message;
      list.replaceChildren(failure);
    }
    setHelp(error.message, true);
  }
}

function renderCurriculum(item) {
  const content = $('#curriculum-content');
  content.replaceChildren();
  const standards = item.curriculum?.standards || [];
  const { yearMismatch, verifiedCount, candidateCount } = curriculumDisplayState(item);
  $('#standards-count').textContent = yearMismatch
    ? `${candidateCount}건 연도 불일치 · 확인 필요`
    : verifiedCount ? `검토 완료 ${verifiedCount}개${candidateCount ? ` · 후보 ${candidateCount}건` : ''}`
      : candidateCount ? `후보 ${candidateCount}건 · 확인 필요` : '미분류';
  const curriculum = item.curriculum || {};
  $('#confidence-badge').textContent = yearMismatch
    ? `${curriculum.framework} · 해당 학년도 적용 불일치 · 검토 필요`
    : standards.length ? `${curriculum.framework || '교육과정 미확인'} · ${verifiedCount === standards.length ? '검토 완료' : '검토 필요'}`
      : `${curriculum.framework || '적용 교육과정 확인 필요'} · 미분류`;
  if (officialUrl(curriculum.sourceUrl)) {
    const link = document.createElement('a');
    link.href = officialUrl(curriculum.sourceUrl);
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '교육과정 공식 출처 ↗';
    content.append(link);
  }
  if (!standards.length) {
    const message = document.createElement('p');
    message.className = 'unmapped-copy';
    message.textContent = '아직 연결된 성취기준이 없습니다. PDF 원본과 단원 태그를 확인해 주세요.';
    content.append(message);
    return;
  }
  for (const standard of standards) {
    const entry = document.createElement('div');
    entry.className = 'standard-entry';
    const code = document.createElement('span');
    code.className = 'standard-code';
    code.textContent = standard.code;
    const title = document.createElement('h3');
    title.className = 'standard-title';
    title.textContent = `${standard.subject} · ${standard.unit}`;
    const copy = document.createElement('p');
    copy.className = 'standard-copy';
    copy.textContent = standard.text;
    const review = document.createElement('small');
    review.className = 'standard-review';
    review.textContent = `${yearMismatch ? '적용 연도 불일치 · 확인 필요' : curriculum.reviewStatus === 'verified' && standard.reviewStatus === 'verified' ? '검토 완료' : '확인 필요'}${standard.evidence ? ` · 근거: ${standard.evidence}` : ''}${standard.confidence ? ` · 신뢰도: ${standard.confidence}` : ''}`;
    entry.append(code, title, copy, review);
    if (officialUrl(standard.sourceUrl)) {
      const link = document.createElement('a');
      link.href = officialUrl(standard.sourceUrl);
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = '성취기준 원문 ↗';
      entry.append(link);
    }
    content.append(entry);
  }
}

async function selectQuestion(id, openDetail = true) {
  if (!id) return;
  const selectionRequestId = ++state.selectionRequestId;
  try {
    const item = await getJson(`/api/question?id=${encodeURIComponent(id)}`);
    if (selectionRequestId !== state.selectionRequestId) return;
    state.selectedId = id;
    selectedQuestion = item;
    selectionLabels.set(id, `${item.exam} · ${item.subjectLabel} ${item.no}번`);
    renderSelection();
    let selectedCard;
    for (const [index, card] of [...list.querySelectorAll('.result-card')].entries()) {
      const selected = card.dataset.id === id;
      card.setAttribute('aria-current', String(selected));
      if (selected) {
        selectedCard = card;
        showPage(Math.floor((state.baseOffset + index) / pageSize));
      }
    }
    if (!openDetail) selectedCard?.scrollIntoView({ block: 'nearest' });
    $('#detail-empty').hidden = true;
    $('#detail-content').hidden = false;
    $('#detail-heading').textContent = `${item.subjectLabel} ${item.no}번`;
    $('#detail-subheading').textContent = `${item.exam} · ${item.page}쪽`;
    const href = driveLink(driveFilePath(item.pdfFile));
    $('#open-pdf').href = href ? `${href}#page=${item.page}` : '';
    $('#open-pdf').hidden = !href;
    const imageUrl = cardUrl(item);
    const imageLink = $('#source-image-link');
    imageLink.classList.add('is-loading');
    const image = $('#source-image');
    image.alt = `${item.exam} ${item.subjectLabel} ${item.no}번 PDF 원본 문항`;
    image.onload = () => imageLink.classList.remove('is-loading');
    image.onerror = () => { imageLink.classList.remove('is-loading'); setHelp('이미지 생성에 실패했습니다. 시험지 PDF로 확인해 주세요.', true); };
    if (imageUrl) image.src = imageUrl;
    else image.removeAttribute('src');
    void renderQuestion(item).then((highResolutionUrl) => {
      if (selectionRequestId !== state.selectionRequestId) {
        URL.revokeObjectURL(highResolutionUrl);
        return;
      }
      if (activeQuestionObjectUrl) URL.revokeObjectURL(activeQuestionObjectUrl);
      activeQuestionObjectUrl = highResolutionUrl;
      image.src = highResolutionUrl;
    }).catch((error) => {
      if (selectionRequestId === state.selectionRequestId) {
        $('#source-note').textContent = `${error.message} ${imageUrl ? '카드 이미지로 확인하거나' : ''} 시험지 PDF 원본으로 확인해 주세요.`;
        setHelp(error.message, true);
      }
    });
    $('#source-note').textContent = `${item.pdfFile} · ${item.page}쪽 원본입니다. 수식과 그림은 PDF에서 대조하세요.`;
    const tagList = $('#tag-list');
    tagList.replaceChildren();
    const names = [...new Set([...(item.parts || []), ...(item.tags || [])])];
    if (!names.length) names.push('단원 미분류');
    for (const name of names) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = name;
      tagList.append(tag);
    }
    renderCurriculum(item);
    void renderAnswers().catch((error) => setHelp(error.message, true));
    if (openDetail) {
      if (shell.classList.contains('is-split')) setPreviewMode(false);
      shell.classList.add('is-detail');
      window.scrollTo(0, 0);
    }
    $('.detail-scroll').scrollTop = 0;
    updateNavigation();
    updateAddress();
  } catch (error) {
    setHelp(error.message, true);
  }
}

async function loadPrevious() {
  if (state.baseOffset === 0) return false;
  const from = Math.max(0, state.baseOffset - 40);
  const requestId = ++state.requestId;
  const data = await getJson(queryUrl(from));
  if (requestId !== state.requestId) return false;
  const preceding = data.items.slice(0, state.baseOffset - from);
  list.prepend(...preceding.map(state.mode === 'files' ? fileRowFor : cardFor));
  state.baseOffset = from;
  showPage(state.page);
  return preceding.length > 0;
}

async function navigateQuestion(direction) {
  if (state.navigating) return;
  state.navigating = true;
  try {
    let cards = [...list.querySelectorAll('.result-card')];
    let current = cards.findIndex((card) => card.dataset.id === state.selectedId);
    let next = current < 0 ? state.page * pageSize - state.baseOffset : current + direction;
    if (next < 0 && await loadPrevious()) {
      cards = [...list.querySelectorAll('.result-card')];
      current = cards.findIndex((card) => card.dataset.id === state.selectedId);
      next = current + direction;
    }
    if (next < 0) return;
    if (next >= cards.length && state.offset < state.total) {
      await search(false);
      cards = [...list.querySelectorAll('.result-card')];
    }
    const card = cards[next];
    if (!card) return;
    const detailOpen = shell.classList.contains('is-detail');
    await selectQuestion(card.dataset.id, detailOpen);
    if (!detailOpen) card.focus({ preventScroll: true });
  } finally {
    state.navigating = false;
  }
}

async function changePage(direction) {
  const visible = state.mode === 'files' ? filePageSize : pageSize;
  const target = state.page + direction;
  if (target < 0 || target >= Math.ceil(state.total / visible)) return;
  while (state.baseOffset > target * visible) {
    if (!await loadPrevious()) return;
  }
  while (state.offset < Math.min(state.total, (target + 1) * visible)) {
    const before = state.offset;
    await search(false);
    if (state.offset === before) return;
  }
  showPage(target);
  if (state.mode === 'files') {
    list.querySelector('.file-row:not([hidden]) .file-select')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    updateAddress();
    return;
  }
  const firstCard = list.querySelector('.question-item:not([hidden]) .result-card');
  if (shell.classList.contains('is-split') && firstCard) await selectQuestion(firstCard.dataset.id, false);
  else {
    state.selectedId = '';
    for (const card of list.querySelectorAll('.result-card')) card.setAttribute('aria-current', 'false');
    updateNavigation();
    updateAddress();
  }
  firstCard?.focus({ preventScroll: true });
  if (shell.classList.contains('is-split')) $('.results-pane').scrollTop = 0;
  else window.scrollTo(0, 0);
}

function setZoom(value) {
  state.zoom = Math.min(300, Math.max(100, value));
  $('#viewer-image').style.setProperty('--viewer-width', `${state.zoom}%`);
  $('#zoom-level').textContent = `${state.zoom}%`;
  $('#zoom-out').disabled = state.zoom === 100;
  $('#zoom-in').disabled = state.zoom === 300;
}

function openViewer() {
  const image = $('#source-image');
  if (!image.complete || !image.naturalWidth) return;
  $('#viewer-image').src = image.src;
  $('#viewer-image').alt = image.alt;
  $('#viewer-title').textContent = $('#detail-heading').textContent;
  $('#viewer-original').href = image.src;
  setZoom(100);
  viewer.showModal();
  $('#viewer-stage').scrollTo(0, 0);
  $('#close-viewer').focus();
}

$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (addInputWords()) search();
});
tokensNode.addEventListener('click', (event) => {
  const word = event.target.closest('button')?.dataset.word;
  if (!word) return;
  state.tokens = state.tokens.filter((token) => token !== word);
  renderTokens();
  search();
});
$('#clear-search').addEventListener('click', () => {
  state.tokens = [];
  input.value = '';
  group.value = '';
  updateSubjectOptions();
  subject.value = '';
  year.value = '';
  month.value = '';
  framework.value = '';
  unit.value = '';
  standard.value = '';
  renderTokens();
  setHelp(state.mode === 'files' ? '모든 시험지를 표시합니다.' : '모든 문항을 표시합니다.');
  search();
});
group.addEventListener('change', () => { updateSubjectOptions(); search(); });
for (const select of [subject, year, month, framework, unit, standard]) select.addEventListener('change', () => search());
answerToggle.addEventListener('change', () => {
  void renderAnswers().catch((error) => setHelp(error.message, true));
});
for (const [id, mode] of [['#mode-questions', 'questions'], ['#mode-files', 'files']]) {
  $(id).addEventListener('click', () => {
    if (state.mode === mode) return;
    setResultMode(mode);
    search();
  });
}
previewToggle.addEventListener('click', async () => {
  if (state.mode === 'files') {
    if (shell.classList.contains('is-file-preview')) { setFilePreviewMode(false); return; }
    const row = [...list.querySelectorAll('.file-row')].find((entry) => entry.dataset.file === state.selectedFile)
      || list.querySelector('.file-row:not([hidden])');
    if (row) row.querySelector('.file-select').click();
    return;
  }
  if (shell.classList.contains('is-split')) { setPreviewMode(false); return; }
  const card = [...list.querySelectorAll('.result-card')].find((entry) => entry.dataset.id === state.selectedId)
    || list.querySelector('.question-item:not([hidden]) .result-card');
  if (!card) return;
  setPreviewMode(true);
  await selectQuestion(card.dataset.id, false);
});
list.addEventListener('click', (event) => {
  const card = event.target.closest('.result-card');
  if (card) selectQuestion(card.dataset.id, !shell.classList.contains('is-split'));
});
list.addEventListener('change', (event) => {
  const wrapper = event.target.closest('.question-item');
  if (!wrapper || !event.target.matches('.question-selection input')) return;
  selection.toggle(wrapper.dataset.id);
  renderSelection();
});
$('#detail-selection').addEventListener('change', () => {
  if (!selectedQuestion) return;
  selection.toggle(selectedQuestion.id);
  renderSelection();
});
$('#selection-toggle').addEventListener('click', () => {
  const expanded = $('#selection-toggle').getAttribute('aria-expanded') === 'true';
  $('#selection-toggle').setAttribute('aria-expanded', String(!expanded));
  $('#selection-tray').hidden = expanded;
});
$('#selection-clear').addEventListener('click', () => {
  selection.clear();
  renderSelection();
  $('#mode-questions').focus();
});
$('#selection-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('li');
  const id = row.dataset.id;
  const action = button.dataset.action;
  const index = selection.snapshot().indexOf(id);
  if (action === 'remove') selection.remove(id);
  else selection.move(id, action === 'up' ? -1 : 1);
  renderSelection();
  const rows = [...$('#selection-list').children];
  const target = action === 'remove' ? rows[Math.min(index, rows.length - 1)] : rows.find((item) => item.dataset.id === id);
  const sameAction = target?.querySelector(`[data-action="${action}"]:not(:disabled)`);
  (sameAction || target?.querySelector('button:not(:disabled)') || $('#mode-questions')).focus();
});
$('#selection-open').addEventListener('click', () => {
  const ids = selection.snapshot();
  if (ids.length) document.dispatchEvent(new CustomEvent('open-editable-collection', { detail: { ids } }));
});
loadMore.addEventListener('click', () => changePage(1));
$('#previous-page').addEventListener('click', () => changePage(-1));
$('#mobile-back').addEventListener('click', () => {
  if (shell.classList.contains('is-split')) setPreviewMode(false);
  else shell.classList.remove('is-detail');
  updateAddress();
  const card = [...list.querySelectorAll('.result-card')].find((entry) => entry.dataset.id === state.selectedId);
  card?.scrollIntoView({ block: 'nearest' });
  card?.focus({ preventScroll: true });
});
$('#file-preview-back').addEventListener('click', () => {
  setFilePreviewMode(false);
  const row = [...list.querySelectorAll('.file-row')].find((entry) => entry.dataset.file === state.selectedFile);
  row?.querySelector('.file-select')?.focus({ preventScroll: true });
});
$('#previous-question').addEventListener('click', () => navigateQuestion(-1));
$('#next-question').addEventListener('click', () => navigateQuestion(1));
$('#source-image-link').addEventListener('click', () => {
  if (selectedQuestion) void openEditable(selectedQuestion);
});
$('#open-viewer').addEventListener('click', openViewer);
$('#open-editable').addEventListener('click', () => {
  if (selectedQuestion) void openEditable(selectedQuestion);
});
$('#close-viewer').addEventListener('click', () => viewer.close());
$('#zoom-out').addEventListener('click', () => setZoom(state.zoom - 25));
$('#zoom-in').addEventListener('click', () => setZoom(state.zoom + 25));
viewer.addEventListener('close', () => $('#open-viewer').focus());
window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === 'Escape' && shell.classList.contains('is-split') && !viewer.open) {
    if (event.target instanceof Element && event.target.closest('input, select, textarea')) return;
    setPreviewMode(false);
    previewToggle.focus();
    return;
  }
  if (event.key === 'Escape' && shell.classList.contains('is-file-preview')) {
    setFilePreviewMode(false);
    previewToggle.focus();
    return;
  }
  if ($('#editable-dialog').open || event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable="true"], dialog, .selection-tray, .selection-toolbar')) return;
  if (state.mode === 'files') return;
  const direction = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
  if (!direction) return;
  event.preventDefault();
  navigateQuestion(direction);
});

async function start() {
  try {
    const status = await getJson('/api/status');
    const issues = status.incomplete.length;
    const degraded = status.degradedPdfCount || 0;
    const mismatched = status.curriculumYearMismatchCount || 0;
    $('#source-status').textContent = `${status.pdfCount.toLocaleString('ko-KR')}개 시험지 · ${status.questionCount.toLocaleString('ko-KR')}개 문항`;
    if (issues || degraded || mismatched) {
      $('#index-issues').hidden = false;
      $('#issues-count').textContent = String(issues + degraded + mismatched);
      $('#issues-description').textContent = `누락 ${issues}개 시험지${degraded ? ` · 본문 글꼴 추출 주의 ${degraded}개` : ''}${mismatched ? ` · 교육과정 연도 불일치 ${mismatched}문항` : ''}`;
      const issueList = $('#issues-list');
      for (const issue of status.incomplete) {
        const line = document.createElement('li');
        line.textContent = `${issue.pdfFile}: ${issue.found === 0 ? '문항 추출 불가' : issue.reason || `${issue.missing.length}개 문항 누락`}`;
        issueList.append(line);
      }
      if (degraded) {
        const line = document.createElement('li');
        line.append('특수 글꼴 PDF는 본문 검색이 제한됩니다.', document.createElement('br'), '원본 이미지로 확인하세요.');
        issueList.append(line);
      }
      if (mismatched) {
        const line = document.createElement('li');
        line.textContent = `2020학년도 이전의 2015 개정 교육과정 연결 ${mismatched}건은 적용 연도가 맞지 않아 검토 완료·필터 결과에서 제외합니다.`;
        issueList.append(line);
      }
    }
    const years = status.years || [];
    for (const value of years) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value}학년도`;
      year.append(option);
    }
    availableSubjects = status.subjects || [];
    for (const { value, label } of status.groups || []) group.add(new Option(label, value));
    for (const value of status.frameworks || []) framework.add(new Option(value, value));
    for (const value of status.units || []) unit.add(new Option(value, value));
    for (const { value, label } of status.standards || []) standard.add(new Option(`${value} ${label}`, value));
    state.tokens = (initialParams.get('q') || '').trim().split(/\s+/u).filter(Boolean).slice(0, 3);
    const legacySubject = initialParams.get('subject') || '';
    group.value = initialParams.get('group') || availableSubjects.find((entry) => entry.value === legacySubject)?.group || '';
    updateSubjectOptions(legacySubject);
    year.value = initialParams.get('year') || '';
    month.value = initialParams.get('month') || '';
    framework.value = initialParams.get('framework') || '';
    unit.value = initialParams.get('unit') || '';
    standard.value = initialParams.get('standard') || '';
    // Answer visibility is never restored from URL, history, or persistent storage.
    answerToggle.checked = false;
    if (initialParams.get('mode') === 'files') {
      setResultMode('files');
    }
    renderTokens();
    await search();
  } catch (error) {
    $('#source-status').textContent = 'PDF 색인을 불러오지 못했습니다';
    setHelp(error.message, true);
  }
}

start();
