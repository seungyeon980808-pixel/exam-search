import { driveFilePath, getJson, browserCatalog, onSearchState, prefetchSearch } from './data.mjs?v=library-release-20261010-1';
import { driveLink } from './drive-source.mjs';
import { createPreviewLoader } from './preview-loader.mjs?v=preview-speed-20261009-1';
let pdfModule;
const pdfViewer = () => pdfModule ||= import('./pdf-viewer.mjs?v=library-release-20261010-1').catch(error => { pdfModule = null; throw error; });
const renderFilePages = async (...args) => (await pdfViewer()).renderFilePages(...args);
const renderFileThumbnail = async (...args) => (await pdfViewer()).renderFileThumbnail(...args);
const renderQuestion = async (...args) => (await pdfViewer()).renderQuestion(...args);
import { trackLabels, variantLabels } from './paper-profile.mjs';
import { curriculumDisplayState } from './search.mjs?v=library-release-20261010-1';
import { curriculumOptions } from './catalog-filters.mjs?v=library-toolbar-20261009-1';
let editorModule;
async function openEditor(method, args) {
  setHelp('편집 문서를 준비하고 있습니다.');
  try {
    editorModule ||= import('./editable-editor.mjs?v=library-release-20261010-1').catch(error => { editorModule = null; throw error; });
    return (await editorModule)[method](...args);
  } catch (error) { setHelp(error.message, true); }
}
const openEditable = (...args) => openEditor('openEditable', args);
const openEditableCollection = (...args) => openEditor('openEditableCollection', args);
import { createQuestionSelection } from './question-selection.mjs';
import { createLibraryPreferences } from './library-preferences.mjs';
import { mountLandingStory } from './landing-story.mjs';
import { readYearRange, writeYearRange, validYearRange, yearRangeLabel, includesYear } from './year-range.mjs';
import { createEmbeddedHost } from './embedded-host.mjs';

const publishEmbeddedAddress = createEmbeddedHost(window);

const $ = (selector) => document.querySelector(selector);
let preferenceStorage;
try { preferenceStorage = localStorage; } catch { /* Browsers can deny persistent storage. */ }
const preferences = createLibraryPreferences(preferenceStorage);
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
const yearFrom = $('#year-from');
const yearTo = $('#year-to');
let yearRange = { from: '', to: '' };
const month = $('#month-filter');
const track = $('#track-filter');
const variant = $('#variant-filter');
const allProfiles = $('#profile-all');
let paperOptions = [];
const savedProfiles = (() => { try { return JSON.parse(localStorage.getItem('exam-paper-profiles') || '{}'); } catch { return {}; } })();
const framework = $('#framework-filter');
const unit = $('#unit-filter');
const standard = $('#standard-filter');
const answerToggle = $('#answer-toggle');
const viewer = $('#image-viewer');
let pageSize = (() => { try { return Number(new URLSearchParams(location.search).get('pageSize') || localStorage.getItem('exam-page-size')) || 9; } catch { return 9; } })();
if (![6,9,18,36].includes(pageSize)) pageSize = 9;
$('#page-size').value = String(pageSize);
const filePageSize = 12;
const state = { mode: 'questions', tokens: [], total: 0, baseOffset: 0, offset: 0, page: 0, selectedId: '', selectedFile: '', requestId: 0, selectionRequestId: 0, fileRequestId: 0, navigating: false, zoom: 100 };
const initialParams = new URLSearchParams(location.search);
state.tokens = (initialParams.get('q') || '').trim().split(/\s+/u).filter(Boolean).slice(0, 3);
let initialSelectionPending = true;
let restoringHistory = false;
let historyOffset = 0;
let historyNavigation = 0;
let catalogData;
let sourceController;
let fileRenderController;
let searchController, detailController, warmController, warmSubject='', warmTimer;
function stopWarmup() {
  warmController?.abort();
  if(warmTimer!==undefined){
    if(window.cancelIdleCallback)cancelIdleCallback(warmTimer);else clearTimeout(warmTimer);
  }
  warmTimer=undefined;warmSubject='';
}
const warmScope=()=>subject.value||`group:${group.value||'all'}`;
function warmSelectedSubject({intent=false}={}) {
  if(!catalogData||(!subject.value&&!intent)||warmSubject===warmScope())return;
  stopWarmup();warmSubject=warmScope();warmController=new AbortController();
  const filters={subject:subject.value,group:group.value},signal=warmController.signal;
  const prepare=()=>{warmTimer=undefined;if(!signal.aborted)void prefetchSearch(filters,{signal,intent}).catch(()=>{});};
  warmTimer=window.requestIdleCallback?requestIdleCallback(prepare,{timeout:300}):setTimeout(prepare,80);
}
let landingOpen = !initialParams.size;
const story = mountLandingStory($('#landing-story'), { isVisible: () => landingOpen, onTry: async step => {
  if (step === 0) { $('#landing-subjects').querySelector('button')?.focus(); return; }
  if (!catalogData) return;
  const params = new URLSearchParams('group=science&subject=p1&year=2025&month=11');
  applySearchAddress(params);
  await search();
  if (step === 1) { list.querySelector('.question-item .question-selection input')?.focus(); return; }
  try { const item = await getJson('/api/question?id=p1_2025_11_01'); void openEditable(item); }
  catch (error) { setHelp(error.message, true); }
} });
$('#library-landing').hidden = !landingOpen;
$('#workspace').hidden = landingOpen;
function leaveLanding() { landingOpen = false; $('#library-landing').hidden = true; $('#workspace').hidden = false; story.refresh(); }
function setReadiness(text, retry = false, ready = false) {
  $('#search-readiness').classList.toggle('is-ready', ready);
  $('#search-readiness-text').textContent = text;
  $('#search-retry').hidden = !retry;
}
onSearchState(status => {
  if (status.updateAvailable) { $('#catalog-update').hidden = false; }
  if (status.phase === 'preparing') setReadiness(`본문 검색 준비 중${status.total ? ` · ${status.done}/${status.total} 과목` : ''}`);
  if (status.phase === 'ready') setReadiness('전체 본문 검색 준비 완료', false, true);
  if (status.phase === 'error') setReadiness(status.message, true);
});
$('#search-retry').addEventListener('click', () => void (catalogData ? search() : start()));
$('#page-size').addEventListener('change', () => {
  pageSize = Number($('#page-size').value);
  try { localStorage.setItem('exam-page-size', String(pageSize)); } catch {}
  if (!landingOpen) void search();
});
let activeQuestionObjectUrl = null;
let stopFileRendering = null;
let answerRequestId = 0;
let availableSubjects = [];
const previewLoader = createPreviewLoader();
const cardPreviews = new Map();
function clearPreviews() {
  previewLoader.clear();
  cardPreviews.clear();
}

const toolbar = $('.topbar');
const filterToggle = $('#filter-toggle');
const toolbarActions = $('#toolbar-inline-actions');
const compactToolbar = matchMedia('(max-width: 1360px)');
const mobileWorkspace = matchMedia('(max-width: 820px)');
const minimalWorkspace = matchMedia('(max-width: 420px)');
const fileTools = $('#file-workspace-tools');
let fileItems = [];
let fileConversionReady = false;
let activeFilePage = 0;
const toolbarDetails = [...toolbar.querySelectorAll('details')];

function closeToolbarPopovers() {
  toolbar.classList.remove('is-filters-open');
  filterToggle.setAttribute('aria-expanded', 'false');
  for (const detail of toolbarDetails) detail.open = false;
}

function syncToolbar() {
  toolbar.dataset.group = group.value;
  const previewParent = minimalWorkspace.matches ? $('#toolbar-menu-panel') : $('#workspace-tools');
  const modeControl = $('#workspace-mode').closest('label');
  if (modeControl.parentElement !== previewParent) previewParent.prepend(modeControl);
  const sizeControl = $('#page-size').closest('label');
  if (sizeControl.parentElement !== previewParent) previewParent.append(sizeControl);
  if (previewToggle.parentElement !== previewParent) {
    if (minimalWorkspace.matches) previewParent.prepend(previewToggle);
    else previewParent.insertBefore(previewToggle, $('#file-workspace-tools').parentElement === previewParent ? $('#file-workspace-tools') : null);
  }
  const fileParent = mobileWorkspace.matches ? $('#toolbar-menu-panel') : $('#workspace-tools');
  if (fileTools.parentElement !== fileParent) fileParent.append(fileTools);
  const description = [group, subject, month, track, variant, framework, unit, standard]
    .filter((control) => !control.disabled && !control.closest('[hidden]'))
    .map((control) => control.selectedOptions[0]?.textContent).filter(Boolean).join(' · ');
  filterToggle.title = [description, yearRangeLabel(yearRange)].filter(Boolean).join(' · ');
  for (const control of [group, subject, month, track, variant]) {
    const text = control.selectedOptions[0]?.textContent || '';
    control.title = text;
  }
  const parent = compactToolbar.matches ? $('#toolbar-menu-panel') : $('.search-panel');
  if (toolbarActions.parentElement !== parent) {
    if (compactToolbar.matches) parent.prepend(toolbarActions);
    else parent.insertBefore(toolbarActions, $('#toolbar-actions-anchor'));
  }
}

minimalWorkspace.addEventListener('change', () => { closeToolbarPopovers(); syncToolbar(); });
mobileWorkspace.addEventListener('change', () => { closeToolbarPopovers(); syncToolbar(); });
compactToolbar.addEventListener('change', () => { closeToolbarPopovers(); syncToolbar(); });
filterToggle.addEventListener('click', () => {
  const open = !toolbar.classList.contains('is-filters-open');
  closeToolbarPopovers();
  toolbar.classList.toggle('is-filters-open', open);
  filterToggle.setAttribute('aria-expanded', String(open));
});
for (const detail of toolbarDetails) detail.querySelector('summary')?.addEventListener('click', () => {
  if (detail.open) return;
  if (!detail.closest('#basic-filters')) {
    toolbar.classList.remove('is-filters-open');
    filterToggle.setAttribute('aria-expanded', 'false');
  }
  if (detail.id === 'year-details') resetYearDraft();
  for (const other of toolbarDetails) {
    if (other !== detail && !other.contains(detail) && !detail.contains(other)) other.open = false;
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!toolbar.contains(event.target)) closeToolbarPopovers();
});
toolbar.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || (!toolbar.classList.contains('is-filters-open') && !toolbarDetails.some((detail) => detail.open))) return;
  const opener = toolbar.classList.contains('is-filters-open') ? filterToggle
    : toolbarDetails.find((detail) => detail.open && detail.contains(document.activeElement))?.querySelector('summary');
  closeToolbarPopovers();
  event.preventDefault();
  event.stopPropagation();
  opener?.focus();
});
syncToolbar();

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
  updateYearOptions();
  syncToolbar();
}

function updateYearOptions() {
  if (!catalogData) return;
  // Keep bounds stable when changing subject, including endpoints without that subject's papers.
  const years = [...new Set([...catalogData.status.years, yearRange.from, yearRange.to].filter(Boolean).map(Number))].sort((a, b) => b - a);
  for (const control of [yearFrom, yearTo]) control.replaceChildren(new Option('제한 없음', ''), ...years.map(value => new Option(String(value), String(value))));
  resetYearDraft();
}

function resetYearDraft() {
  yearFrom.value = yearRange.from; yearTo.value = yearRange.to;
  validateYearDraft();
}

function validateYearDraft() {
  const valid = validYearRange({ from: yearFrom.value, to: yearTo.value });
  $('#year-error').textContent = valid ? '' : '시작 학년도가 종료 학년도보다 늦습니다.';
  $('#year-apply').disabled = !valid;
  yearFrom.setAttribute('aria-invalid', String(!valid)); yearTo.setAttribute('aria-invalid', String(!valid));
  return valid;
}

function setYearRange(value) {
  yearRange = value;
  $('#year-summary').textContent = yearRangeLabel(yearRange);
  $('#year-details').classList.toggle('is-applied', !!(value.from || value.to));
  $('#year-details > summary').setAttribute('aria-label', `연도 범위: ${yearRangeLabel(yearRange)}`);
  updateYearOptions();
}

function applyYearRange(value) {
  if (!validYearRange(value)) return;
  const changed = value.from !== yearRange.from || value.to !== yearRange.to;
  setYearRange(value);
  closeToolbarPopovers();
  (compactToolbar.matches ? filterToggle : $('#year-details > summary')).focus({ preventScroll: true });
  if (!changed) return;
  updatePaperOptions(); updateCurriculumOptions(); rememberProfile(); void search();
}

function updateCurriculumOptions(preferred = {}) {
  if (!catalogData) return;
  const filters = { group: group.value, subject: subject.value, yearFrom: yearRange.from, yearTo: yearRange.to, month: month.value, track: track.value, variant: variant.value, allProfiles: allProfiles.checked };
  const replace = (control, values, chosen) => {
    control.replaceChildren(new Option('전체', ''), ...values.map(value => new Option(value.label || value, value.value || value)));
    control.value = [...control.options].some(option => option.value === chosen) ? chosen : '';
  };
  replace(framework, curriculumOptions(catalogData, filters).frameworks, preferred.framework ?? framework.value);
  filters.framework = framework.value;
  const selectedUnit = preferred.unit ?? unit.value;
  filters.preserveUnit = selectedUnit;
  replace(unit, curriculumOptions(catalogData, filters).units, selectedUnit);
  filters.unit = unit.value;
  const options = curriculumOptions(catalogData, filters);
  replace(standard, options.standards, preferred.standard ?? standard.value);
  const scoped = group.value && (!subject.disabled ? subject.value : true);
  unit.disabled = !scoped; standard.disabled = !scoped;
  $('#unit-filter-note').textContent = !scoped ? '과목과 세부과목을 먼저 골라 주세요.' : !options.units.length ? '이 조건에는 연결된 단원이 없습니다. 키워드로 검색해 주세요.' : '';
  for (const [id, control, name] of [['framework', framework, '교육과정'], ['unit', unit, '단원'], ['standard', standard, '성취기준']]) {
    const details = $(`#${id}-details`), label = control.value ? `${name}: ${control.selectedOptions[0].textContent}` : name;
    details.classList.toggle('is-applied', !!control.value);
    details.querySelector('summary').title = label;
    details.querySelector('summary').setAttribute('aria-label', label);
  }
  updatePaperOptions();
}

function updatePaperOptions(preferredTrack = track.value, preferredVariant = variant.value) {
  const applicable = ['math', 'kor'].includes(group.value);
  const entries = paperOptions.filter((entry) => entry.subject === group.value
    && includesYear(entry.year, yearRange) && (!month.value || entry.month === Number(month.value)));
  const tracks = [...new Set(entries.map((entry) => entry.track))].filter((value) => !['common', 'all'].includes(value));
  const variants = [...new Set(entries.map((entry) => entry.variant))].filter((value) => value && value !== 'single');
  const modern = entries.some((entry) => entry.track === 'common');
  $('#track-filter-control .filter-label').textContent = modern ? '선택과목' : '수학 유형';
  $('#track-filter-control').hidden = !applicable || !tracks.length;
  $('#variant-filter-control').hidden = !applicable || !variants.length;
  $('#profile-all-control').hidden = !applicable;
  track.replaceChildren(new Option(modern ? '선택과목 선택' : '유형 선택', ''));
  for (const value of tracks) track.add(new Option(trackLabels[value] || value, value));
  track.value = tracks.includes(preferredTrack) ? preferredTrack : modern ? '' : tracks[0] || '';
  variant.replaceChildren(...variants.map((value) => new Option(variantLabels[value] || value, value)));
  variant.value = variants.includes(preferredVariant) ? preferredVariant : variants.includes('odd') ? 'odd' : variants[0] || '';
  track.disabled = variant.disabled = allProfiles.checked;
  $('#profile-summary').textContent = !applicable ? '' : allProfiles.checked ? '모든 과목·유형 포함'
    : modern && !track.value ? '공통 문항만 표시 · 전체 변환은 선택과목을 고른 뒤 사용할 수 있습니다.'
      : [trackLabels[track.value], variantLabels[variant.value]].filter(Boolean).join(' · ');
  syncToolbar();
}

function rememberProfile() {
  if (!['math', 'kor'].includes(group.value)) return;
  savedProfiles[group.value] = { track: track.value, variant: variant.value };
  try { localStorage.setItem('exam-paper-profiles', JSON.stringify(savedProfiles)); } catch { /* Storage may be unavailable. */ }
}

function profileParams() {
  const params = new URLSearchParams();
  if (['math', 'kor'].includes(group.value)) {
    if (track.value) params.set('track', track.value);
    if (variant.value) params.set('variant', variant.value);
    if (allProfiles.checked) params.set('allProfiles', '1');
  }
  return params;
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
const restoredSelection = preferences.selection();
const selection = createQuestionSelection(restoredSelection.map(item => item.id));
const selectionLabels = new Map(restoredSelection.map(item => [item.id, item.label]));
let selectionUndo = null;
let selectionStored = true;
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
    const wrapper = checkbox.closest('.question-item');
    const selected = selection.has(wrapper.dataset.id);
    checkbox.checked = selected;
    wrapper.querySelector('.result-card').setAttribute('aria-pressed', String(selected));
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
  const saved = preferences.saveSelection(ids.map(id => ({ id, label: selectionLabels.get(id) || id })));
  selectionStored = saved;
  $('#selection-toggle').title = saved ? '선택한 문항은 이 브라우저에 보관됩니다.' : '이 브라우저에서는 저장할 수 없습니다. 현재 탭에서만 유지됩니다.';
}

function notifySelection(message, undo = null) {
  selectionUndo = undo;
  $('#selection-notice-text').textContent = message;
  $('#selection-undo').hidden = !undo;
  $('#selection-notice').hidden = false;
}
function selectionChanged(id) {
  const before = selection.snapshot();
  const removing = selection.has(id);
  selection.toggle(id);
  renderSelection();
  if (removing) notifySelection('선택에서 문항을 제거했습니다.', before);
  else if (!selectionStored) notifySelection('선택한 문항은 현재 탭에서 유지됩니다. 이 브라우저에 저장하지 못했으므로 새로고침 전에 내려받아 주세요.');
  else { selectionUndo = null; $('#selection-notice').hidden = true; }
}
$('#selection-undo').addEventListener('click', () => {
  if (!selectionUndo) return;
  selection.clear();
  selectionUndo.forEach(id => selection.toggle(id));
  renderSelection();
  notifySelection('선택한 문항을 되돌렸습니다.');
  $('#selection-toggle').focus();
});
$('#selection-notice-close').addEventListener('click', () => { $('#selection-notice').hidden = true; selectionUndo = null; });
renderSelection();
if (restoredSelection.length) notifySelection(`이전에 선택한 ${restoredSelection.length}개 문항을 복원했습니다.`);

function setHelp(message, error = false) {
  help.textContent = message;
  help.classList.toggle('is-error', error);
  if (error) { $('#search-readiness').classList.remove('is-ready'); $('#search-readiness-text').textContent = message; }
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
  input.placeholder = state.tokens.length === 3 ? '최대 3단어' : '키워드 검색';
  input.disabled = false;
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
  preferences.rememberSearch(warmScope(), joined);
  input.value = '';
  $('#search-suggestions').hidden = true;
  renderTokens();
  setHelp(joined.length ? `${joined.length}개 단어를 모두 포함하는 문항을 찾습니다.` : '단어를 입력하고 Enter를 누르세요.');
  return true;
}

function queryUrl(offset) {
  const params = profileParams();
  if (state.tokens.length) params.set('q', state.tokens.join(' '));
  if (group.value) params.set('group', group.value);
  if (subject.value) params.set('subject', subject.value);
  writeYearRange(params, yearRange);
  if (month.value) params.set('month', month.value);
  if (framework.value) params.set('framework', framework.value);
  if (unit.value) params.set('unit', unit.value);
  if (standard.value) params.set('standard', standard.value);
  params.set('offset', String(offset));
  params.set('pageSize', String(state.mode === 'files' ? filePageSize : pageSize));
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

function applySearchAddress(params) {
  const legacySubject = params.get('subject') || '';
  group.value = params.get('group') || availableSubjects.find(entry => entry.value === legacySubject)?.group || '';
  updateSubjectOptions(legacySubject);
  setYearRange(readYearRange(params));
  month.value = params.get('month') || '';
  allProfiles.checked = params.get('allProfiles') === '1';
  const saved = savedProfiles[group.value] || {};
  updatePaperOptions(params.has('track') ? params.get('track') : saved.track || '', params.get('variant') || saved.variant || 'odd');
  updateCurriculumOptions({ framework: params.get('framework') || '', unit: params.get('unit') || '', standard: params.get('standard') || '' });
  state.tokens = (params.get('q') || '').trim().split(/\s+/u).filter(Boolean).slice(0, 3);
  answerToggle.checked = false;
  void renderAnswers();
  renderTokens();
  setResultMode(params.get('mode') === 'files' ? 'files' : 'questions');
}

function rememberResultsPosition(focus) {
  history.replaceState({ ...history.state, library: true, page: state.page, windowY: window.scrollY,
    resultsY: $('.results-pane').scrollTop, focus }, '');
}

window.addEventListener('popstate', async event => {
  if (!catalogData) return;
  const navigation = ++historyNavigation;
  const snapshot = event.state || {};
  const params = new URLSearchParams(location.search);
  restoringHistory = true;
  try {
    sourceController?.abort(); detailController?.abort(); fileRenderController?.abort(); stopFileRendering?.();
    state.selectionRequestId++; state.fileRequestId++;
    shell.classList.remove('is-detail', 'is-split', 'is-file-preview');
    previewToggle.setAttribute('aria-pressed', 'false');
    if (!params.size) {
      searchController?.abort(); state.requestId++; state.searchPending = false; list.inert = false;
      landingOpen = true; $('#library-landing').hidden = false; $('#workspace').hidden = true; story.refresh();
      return;
    }
    applySearchAddress(params);
    for (const key of [...initialParams.keys()]) initialParams.delete(key);
    for (const [key, value] of params) initialParams.set(key, value);
    initialSelectionPending = true;
    pageSize = [6,9,18,36].includes(Number(snapshot.pageSize || params.get('pageSize'))) ? Number(snapshot.pageSize || params.get('pageSize')) : 9;
    $('#page-size').value = String(pageSize);
    historyOffset = Math.max(0, Number(snapshot.page) || 0) * (state.mode === 'files' ? filePageSize : pageSize);
    const request = state.requestId + 1;
    await search(true, { historyNavigation: true });
    if (state.requestId !== request) return;
    window.scrollTo(0, snapshot.windowY || 0);
    $('.results-pane').scrollTop = snapshot.resultsY || 0;
    if (!params.has('id') && !params.has('file')) {
      const target = [...list.querySelectorAll('.result-card, .file-row')].find(card => (card.dataset.id || card.dataset.file) === snapshot.focus);
      (target?.matches('button') ? target : target?.querySelector('button'))?.focus({ preventScroll: true });
    }
  } finally { if (navigation === historyNavigation) { historyOffset = 0; restoringHistory = false; publishEmbeddedAddress(); } }
});

function renderAppliedFilters() {
  const controls = [group, subject, month, track, variant, framework, unit, standard];
  const chips = controls.filter(control => control.value && !control.disabled && !control.closest('[hidden]')).map(control => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'filter-chip';
    const label = document.createElement('span'); label.textContent = control.selectedOptions[0]?.textContent || control.value;
    const close = document.createElement('span'); close.textContent = '×'; close.setAttribute('aria-hidden', 'true');
    button.append(label, close); button.setAttribute('aria-label', `${label.textContent} 조건 해제`);
    // A paper must retain a valid variant. Clearing it selects the default instead.
    if (control === variant) { button.disabled = true; close.hidden = true; button.setAttribute('aria-label', `${label.textContent} 적용`); }
    else button.addEventListener('click', () => { control.value = ''; control.dispatchEvent(new Event('change')); });
    return button;
  });
  if (yearRange.from || yearRange.to) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'filter-chip';
    button.textContent = `${yearRangeLabel(yearRange)} ×`; button.setAttribute('aria-label', '연도 범위 조건 해제');
    button.onclick = () => applyYearRange({ from: '', to: '' }); chips.splice(2, 0, button);
  }
  if (allProfiles.checked) { const label = document.createElement('span'); label.className = 'filter-chip'; label.textContent = '모든 선택과목·유형'; chips.push(label); }
  $('#applied-filters').replaceChildren(...chips); $('#applied-filters').hidden = !chips.length;
}

function emptyResults(filesMode) {
  const box = document.createElement('section'); box.className = 'empty-results';
  const title = document.createElement('h2'); title.textContent = `조건에 맞는 ${filesMode ? '시험지가' : '문항이'} 없습니다.`;
  const description = document.createElement('p'); description.textContent = '조건을 하나씩 넓혀 다시 찾아보세요.';
  const actions = document.createElement('div'); actions.className = 'empty-results-actions';
  function action(text, run) { const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = text; button.addEventListener('click', run); actions.append(button); }
  if (yearRange.from || yearRange.to) action('전체 연도로 찾기', () => applyYearRange({ from: '', to: '' }));
  if (unit.value) action('단원 조건 해제', () => { unit.value = ''; unit.dispatchEvent(new Event('change')); });
  if (state.tokens.length) action(`‘${state.tokens.at(-1)}’ 빼고 찾기`, () => { state.tokens.pop(); renderTokens(); void search(); });
  action('조건 초기화', () => $('#clear-search').click());
  const note = document.createElement('small'); note.textContent = '선택해 둔 문항은 그대로 유지됩니다.';
  box.append(title, description, actions, note); return box;
}

function updateAddress({ push = false } = {}) {
  if (landingOpen || restoringHistory) return;
  const params = profileParams();
  if (pageSize !== 9) params.set('pageSize', String(pageSize));
  if (state.tokens.length) params.set('q', state.tokens.join(' '));
  if (group.value) params.set('group', group.value);
  if (subject.value) params.set('subject', subject.value);
  writeYearRange(params, yearRange);
  if (month.value) params.set('month', month.value);
  if (framework.value) params.set('framework', framework.value);
  if (unit.value) params.set('unit', unit.value);
  if (standard.value) params.set('standard', standard.value);
  if (state.mode === 'files') params.set('mode', 'files');
  if (shell.classList.contains('is-split') || shell.classList.contains('is-file-preview')) params.set('view', 'split');
  if ((shell.classList.contains('is-detail') || shell.classList.contains('is-split')) && state.selectedId) params.set('id', state.selectedId);
  if (shell.classList.contains('is-file-preview') && state.selectedFile) params.set('file', state.selectedFile);
  const address = `${location.pathname}${params.size ? `?${params}` : ''}`;
  const inDetail = shell.classList.contains('is-detail') || shell.classList.contains('is-file-preview');
  const snapshot = { library: true, page: state.page, pageSize, windowY: window.scrollY, resultsY: $('.results-pane').scrollTop,
    detailEntry: inDetail && (push || !!history.state?.detailEntry) };
  if (push && !restoringHistory) history.pushState(snapshot, '', address);
  else history.replaceState(snapshot, '', address);
  publishEmbeddedAddress();
}

function setPreviewMode(open) {
  if (state.mode === 'files') return;
  shell.classList.toggle('is-split', open);
  shell.classList.remove('is-detail');
  previewToggle.setAttribute('aria-pressed', String(open));
  previewToggle.setAttribute('aria-label', open ? '미리보기 닫기' : '미리보기 열기');
  previewToggle.title = open ? '미리보기 닫기' : '미리보기 열기';
  $('#mobile-back').textContent = open ? '← 결과만 보기' : '← 검색 결과';
  updateAddress();
}

function setFilePreviewMode(open, { push = false } = {}) {
  shell.classList.toggle('is-file-preview', open);
  previewToggle.setAttribute('aria-pressed', String(open));
  previewToggle.setAttribute('aria-label', open ? '미리보기 닫기' : '미리보기 열기');
  previewToggle.title = open ? '미리보기 닫기' : '미리보기 열기';
  if (!open) { $('#file-preview').hidden = true; fileRenderController?.abort(); stopFileRendering?.(); stopFileRendering = null; }
  fileTools.hidden = !open;
  $('#file-preview-back').hidden = !open;
  updateAddress({ push });
}

function setResultMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  $('#workspace-mode').value = mode;
  fileTools.hidden = true;
  $('#file-preview-back').hidden = true;
  $('#file-preview-title').textContent = '';
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
  previewToggle.setAttribute('aria-label', '미리보기 열기');
  previewToggle.title = '미리보기 열기';
  $('#result-sort').textContent = mode === 'files' ? '최신순' : '관련도 · 최신순';
  renderTokens();
  updateAddress();
}

function cardUrl(item) {
  if (item.cardPath) return item.cardPath;
  if (cardPreviews.has(item.id)) return cardPreviews.get(item.id);
  // Retain the legacy science path when older detail metadata has no preview entry.
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
  button.setAttribute('aria-pressed', String(selection.has(item.id)));
  button.setAttribute('aria-label', `${labelText} 선택`);
  const meta = document.createElement('span');
  meta.className = 'result-meta';
  meta.textContent = labelText;
  const preview = document.createElement('span');
  preview.className = 'result-preview is-loading';
  const image = document.createElement('img');
  image.loading = 'lazy';
  image.decoding = 'async';
  const thumbnail = cardUrl(item);
  const placeholder = document.createElement('span');
  placeholder.className = 'preview-placeholder';
  placeholder.textContent = thumbnail ? '문항 이미지 불러오는 중…' : '원본 미리보기를 만드는 중…';
  image.alt = `${item.exam} ${item.subjectLabel} ${item.no}번 PDF 원본 문항`;
  if (item.cardWidth && item.cardHeight) {
    image.width = item.cardWidth; image.height = item.cardHeight;
    // WebKit uses the alt-text height until load unless the ratio is explicit.
    image.style.aspectRatio = `${item.cardWidth} / ${item.cardHeight}`;
    preview.style.setProperty('--preview-ratio', `${item.cardWidth} / ${item.cardHeight}`);
    preview.classList.add('has-dimensions');
  }
  image.hidden = !thumbnail;
  preview.append(image, placeholder);
  if (thumbnail) cardPreviews.set(item.id, thumbnail);
  previewLoader.observe({ element: button, image, preview, placeholder, source: thumbnail,
    render: signal => renderQuestion(item, 1.3, { signal }) });
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
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const openPreview = document.createElement('button');
  openPreview.type = 'button';
  openPreview.className = 'card-preview';
  openPreview.dataset.id = item.id;
  openPreview.title = '문항 미리보기';
  openPreview.setAttribute('aria-label', `${labelText} 미리보기`);
  openPreview.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  actions.append(openPreview, label);
  wrapper.append(button, actions);
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
  select.addEventListener('click', () => selectFile(item, { push: !shell.classList.contains('is-file-preview') }));
  const preview = document.createElement('span');
  preview.className = 'file-thumbnail';
  const image = document.createElement('img');
  image.loading = 'lazy';
  image.decoding = 'async';
  image.width = 100;
  image.height = 130;
  const hasStaticThumbnail = /^[pbce][12]_\d{4}_(06|09|11)\.pdf$/u.test(item.pdfFile);
  const thumbnail = item.thumbnailPath || (hasStaticThumbnail ? `./thumbnails/${encodeURIComponent(item.pdfFile.replace(/\.pdf$/u, ''))}.webp` : '');
  image.alt = `${item.pdfFile} 첫 페이지 미리보기`;
  preview.classList.add('is-loading');
  image.hidden = !thumbnail;
  const placeholder = document.createElement('span');
  placeholder.textContent = thumbnail ? '불러오는 중' : '미리보기 생성 중';
  preview.append(image, placeholder);
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
  previewLoader.observe({ element: row, image, preview, placeholder, source: thumbnail,
    render: signal => renderFileThumbnail(item.pdfFile, { signal }) });
  return row;
}

async function selectFile(item, { push = false } = {}) {
  if (push) rememberResultsPosition(item.pdfFile);
  fileRenderController?.abort();
  fileRenderController = new AbortController();
  const fileSignal = fileRenderController.signal;
  const fileRequestId = ++state.fileRequestId;
  fileItems = [];
  fileConversionReady = false;
  activeFilePage = 0;
  $('#file-page-editable').disabled = true;
  $('#file-page-previous').disabled = $('#file-page-next').disabled = true;
  $('#file-page-position').textContent = '—';
  const convert = $('#file-preview-editable');
  convert.disabled = true;
  convert.textContent = '전체 문항 한글로';
  convert.onclick = null;
  const configure = $('#file-preview-profile');
  configure.hidden = !['math', 'kor'].includes(item.subject) || group.value === item.subject;
  configure.onclick = async () => {
    group.value = item.subject;
    setYearRange({ from: String(item.year), to: String(item.year) });
    month.value = String(item.month);
    allProfiles.checked = false;
    updateSubjectOptions();
    const saved = savedProfiles[item.subject] || {};
    updatePaperOptions(saved.track || '', saved.variant || 'odd');
    await search();
    await selectFile(item);
    if (!track.closest('[hidden]')) {
      if (compactToolbar.matches) {
        closeToolbarPopovers();
        toolbar.classList.add('is-filters-open');
        filterToggle.setAttribute('aria-expanded', 'true');
      }
      track.focus();
    }
  };
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
  setFilePreviewMode(true, { push });
  stopFileRendering?.();
  stopFileRendering = null;
  const questionsPromise = getJson(`/api/file-questions?name=${encodeURIComponent(item.pdfFile)}&${profileParams()}`);
  try {
    const { items, pages: chosenPages, label, ready } = await questionsPromise;
    if (fileRequestId !== state.fileRequestId) return;
    fileItems = items;
    fileConversionReady = ready;
    convert.disabled = !ready || !items.length;
    convert.textContent = !ready && items.length ? '선택과목을 먼저 골라주세요' : items.length ? `${label ? `${label} ` : '전체 '}${items.length}문항 한글로` : '색인된 문항 없음';
    convert.title = '전체 문항을 한 문서로 변환합니다. 변환 전에 그림 포함·제외를 선택할 수 있습니다. 본문·수식·보기는 편집 가능한 문서로 만듭니다.';
    convert.onclick = () => { $('#workspace-convert').open = false; void openEditableCollection(items.map((entry) => entry.id)); };
    stopFileRendering = await renderFilePages(item.pdfFile, pages, item.firstMatchPage || 1,
      () => fileRequestId === state.fileRequestId, chosenPages, { signal: fileSignal });
    if (fileRequestId !== state.fileRequestId) return;
    updateFilePageControls();
  } catch (error) {
    if (fileRequestId === state.fileRequestId) { pages.textContent = error.message; updateFilePageControls(); }
  }
}

function updateWorkspaceMode() {
  $('#page-size').closest('label').hidden = state.mode === 'files';
  const picker = $('#workspace-mode');
  picker.options[0].textContent = '문항별';
  picker.options[1].textContent = '시험지별';
  picker.value = state.mode;
}
function updateFilePageControls() {
  const pages = $('#file-preview-pages');
  const sections = [...pages.querySelectorAll('.file-page')];
  const readingLine = pages.getBoundingClientRect().top + Math.min(100, pages.clientHeight / 4);
  const section = sections.find((entry) => entry.getBoundingClientRect().bottom > readingLine) || sections.at(-1);
  const index = sections.indexOf(section);
  activeFilePage = section ? Number(section.dataset.page) : 0;
  const lastPage = sections.at(-1)?.querySelector('.file-page-label')?.textContent.match(/\/\s*(\d+)/u)?.[1];
  $('#file-page-position').textContent = section ? `${activeFilePage} / ${lastPage || sections.length}` : '—';
  $('#file-page-previous').disabled = index <= 0;
  $('#file-page-next').disabled = index < 0 || index >= sections.length - 1;
  const items = fileItems.filter((item) => item.page === activeFilePage);
  const convert = $('#file-page-editable');
  convert.disabled = !fileConversionReady || !items.length;
  convert.textContent = items.length ? `${activeFilePage}쪽 ${items.length}문항 한글로` : '이 쪽에 색인된 문항 없음';
  $('#file-preview-open').href = $('#file-preview-open').href.replace(/#page=\d+/u, `#page=${activeFilePage || 1}`);
}
function moveFilePage(direction) {
  const pages = $('#file-preview-pages');
  const sections = [...pages.querySelectorAll('.file-page')];
  const index = sections.findIndex((section) => Number(section.dataset.page) === activeFilePage);
  const target = sections[index + direction];
  if (!target) return;
  pages.scrollTop += target.getBoundingClientRect().top - pages.getBoundingClientRect().top - 12;
  updateFilePageControls();
}
$('#file-preview-pages').addEventListener('scroll', updateFilePageControls, { passive: true });
$('#file-page-previous').addEventListener('click', () => moveFilePage(-1));
$('#file-page-next').addEventListener('click', () => moveFilePage(1));
$('#file-page-editable').addEventListener('click', () => {
  if (!fileConversionReady) return;
  const ids = fileItems.filter((item) => item.page === activeFilePage).map((item) => item.id);
  $('#workspace-convert').open = false;
  if (ids.length) void openEditableCollection(ids);
});
$('#workspace-mode').addEventListener('change', () => { setResultMode($('#workspace-mode').value); void search(); });
new ResizeObserver(() => { if (!$('#file-preview').hidden) updateFilePageControls(); }).observe($('#file-preview-pages'));

function showPage(page) {
  state.page = page;
  const cards = [...list.querySelectorAll('.result-item')];
  const first = page * (state.mode === 'files' ? filePageSize : pageSize) - state.baseOffset;
  const visible = state.mode === 'files' ? filePageSize : pageSize;
  for (const [index, card] of cards.entries()) card.hidden = index < first || index >= first + visible;
  if (answerToggle.checked) void renderAnswers().catch((error) => setHelp(error.message, true));
  const keepFrom = Math.max(0, first - visible), keepTo = first + visible * 2;
  for (const [index, card] of cards.entries()) {
    if (index >= keepFrom && index < keepTo) continue;
    const preview = card.querySelector('.result-card') || card;
    previewLoader.release(preview); cardLayoutObserver.unobserve(card);
    cardPreviews.delete(card.dataset.id);
    if (card.dataset.id && !selection.has(card.dataset.id)) selectionLabels.delete(card.dataset.id);
    card.remove();
  }
  const remaining = Math.max(0, Math.min(cards.length, keepTo) - keepFrom);
  state.baseOffset += keepFrom;
  state.offset = state.baseOffset + remaining;
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

async function search(reset = true, { historyNavigation: fromHistory = false } = {}) {
  if (restoringHistory && !fromHistory) { restoringHistory = false; historyOffset = 0; initialSelectionPending = false; }
  leaveLanding();
  closeToolbarPopovers();
  $('#search-suggestions').hidden = true;
  renderAppliedFilters();
  const requestId = ++state.requestId;
  searchController?.abort();searchController=new AbortController();
  const signal=searchController.signal;
  if(warmSubject!==warmScope())stopWarmup();
  const filesMode = state.mode === 'files';
  const retained=reset&&!!list.querySelector('.result-card,.file-row');
  state.searchPending=true;list.inert=true;list.setAttribute('aria-busy','true');
  list.classList.toggle('is-refreshing',retained);
  if(reset)$('#result-count').textContent=retained?'갱신 중 · 이전 결과':'검색 중…';
  // Visible feedback is immediate; search input and filters remain operable.
  setReadiness(retained?'새 조건으로 검색 중 · 이전 결과를 표시하고 있습니다':'검색 중…');
  try {
    const data = await getJson(queryUrl(reset ? historyOffset : state.offset),{signal});
    if (requestId !== state.requestId) return;
    if(reset){
      // Replace only when a complete result is ready. A failed search leaves the
      // previous readable results and active document intact.
      const preserveQuestion=data.items.some(item=>item.id===state.selectedId);
      if(!preserveQuestion){
        state.selectionRequestId++;detailController?.abort();sourceController?.abort();
        state.selectedId='';selectedQuestion=null;shell.classList.remove('is-detail');
        $('#detail-content').hidden=true;$('#detail-empty').hidden=false;
      }
      state.fileRequestId++;fileRenderController?.abort();stopFileRendering?.();stopFileRendering=null;
      state.selectedFile='';if(shell.classList.contains('is-file-preview'))setFilePreviewMode(false);
      state.baseOffset=0;state.offset=0;state.page=0;
      clearPreviews();cardLayoutObserver.disconnect();
      list.replaceChildren();
    }
    setReadiness(state.tokens.length ? '본문 검색 완료' : '목록 준비 완료 · 키워드나 단원으로 좁혀 보세요', false, true);
    state.total = data.total;
    updateWorkspaceMode();
    previewToggle.disabled = !data.total;
    $('#result-sort').textContent = filesMode && !state.tokens.length ? '최신순' : '관련도 · 최신순';
    $('#result-count').textContent = `${filesMode ? '시험지' : '검색 결과'} ${data.total.toLocaleString('ko-KR')}개`;
    if (reset && !data.total) {
      if (shell.classList.contains('is-split')) setPreviewMode(false);
      list.append(emptyResults(filesMode));
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
    if(reset){
      if(shell.classList.contains('is-split'))$('.results-pane').scrollTop=0;
      else window.scrollTo(0,0);
    }
    if (reset && filesMode && initialSelectionPending) {
      initialSelectionPending = false;
      const preferred = initialParams.get('file');
      const target = data.items.find((item) => item.pdfFile === preferred)
        || (initialParams.get('view') === 'split' ? data.items[0] : null);
      if (target) void selectFile(target);
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
      if (target && (target!==state.selectedId || restoringHistory)) await selectQuestion(target, !shell.classList.contains('is-split'));
    }
    if (!filesMode) updateNavigation();
    updateAddress();
  } catch (error) {
    if (requestId !== state.requestId || signal.aborted) return;
    if (reset && !retained) {
      if (shell.classList.contains('is-split')) setPreviewMode(false);
      $('#result-count').textContent = '검색할 수 없습니다';
      const failure = document.createElement('p');
      failure.className = 'list-message';
      failure.textContent = error.message;
      list.replaceChildren(failure);
    }
    if(retained)$('#result-count').textContent='검색 실패 · 이전 결과';
    setReadiness(error.message, true);
    setHelp(error.message, true);
  } finally {
    if(requestId===state.requestId){
      state.searchPending=false;list.inert=false;list.setAttribute('aria-busy','false');list.classList.remove('is-refreshing');
      if(!signal.aborted)warmSelectedSubject();
    }
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

async function selectQuestion(id, openDetail = true, { push = false } = {}) {
  if (!id) return;
  if (push) rememberResultsPosition(id);
  const searchRequestId = state.requestId;
  const selectionRequestId = ++state.selectionRequestId;
  detailController?.abort();detailController=new AbortController();
  const detailSignal=detailController.signal;
  try {
    const item = await getJson(`/api/question?id=${encodeURIComponent(id)}`,{signal:detailSignal});
    if (selectionRequestId !== state.selectionRequestId || searchRequestId !== state.requestId) return;
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
    if (activeQuestionObjectUrl && !viewer.open) { URL.revokeObjectURL(activeQuestionObjectUrl); activeQuestionObjectUrl = null; }
    if (imageUrl) image.src = imageUrl;
    else image.removeAttribute('src');
    sourceController?.abort();
    sourceController = new AbortController();
    const signal = sourceController.signal;
    const scroll = $('.detail-scroll');
    const anchor = { top: scroll.scrollTop, left: scroll.scrollLeft };
    const preserve = () => { anchor.top = scroll.scrollTop; anchor.left = scroll.scrollLeft; };
    scroll.addEventListener('scroll', preserve, { passive: true, signal });
    void renderQuestion(item, 3, { signal }).then((highResolutionUrl) => {
      if (selectionRequestId !== state.selectionRequestId) {
        URL.revokeObjectURL(highResolutionUrl);
        return;
      }
      if (activeQuestionObjectUrl) URL.revokeObjectURL(activeQuestionObjectUrl);
      activeQuestionObjectUrl = highResolutionUrl;
      // Ignore automatic scroll clamping while the image geometry is replaced.
      scroll.removeEventListener('scroll', preserve);
      image.onload = () => {
        imageLink.classList.remove('is-loading');
        scroll.scrollTo(anchor.left, anchor.top);
        scroll.removeEventListener('scroll', preserve);
      };
      image.src = highResolutionUrl;
    }).catch((error) => {
      scroll.removeEventListener('scroll', preserve);
      if (selectionRequestId === state.selectionRequestId && !signal.aborted) {
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
    updateAddress({ push });
  } catch (error) {
    if(selectionRequestId===state.selectionRequestId&&!detailSignal.aborted)setHelp(error.message, true);
  }
}

async function loadPrevious() {
  if (state.baseOffset === 0) return false;
  const from = Math.max(0, state.baseOffset - Math.ceil(40 / (state.mode === 'files' ? filePageSize : pageSize)) * (state.mode === 'files' ? filePageSize : pageSize));
  const requestId = ++state.requestId;
  const data = await getJson(queryUrl(from));
  if (requestId !== state.requestId) return false;
  const preceding = data.items.slice(0, state.baseOffset - from);
  list.prepend(...preceding.map(state.mode === 'files' ? fileRowFor : cardFor));
  state.baseOffset = from;
  // The caller selects the destination page before pruning its neighbors.
  return preceding.length > 0;
}

async function navigateQuestion(direction) {
  if (state.navigating || state.searchPending) return;
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
  if(state.searchPending)return;
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
function renderSearchSuggestions() {
  const suggestions = $('#search-suggestions');
  const draft = input.value.trim();
  const recent = preferences.searches(warmScope()).filter(row => !draft || row.words.join(' ').includes(draft));
  suggestions.replaceChildren();
  const heading = document.createElement('strong'); heading.textContent = '이 과목에서 최근 검색'; suggestions.append(heading);
  for (const row of recent) {
    const button = document.createElement('button'); button.type = 'button';
    const label = document.createElement('span'); label.textContent = row.words.join(' · ');
    const caption = document.createElement('small'); caption.textContent = '다시 찾기'; button.append(label, caption);
    button.addEventListener('click', () => { state.tokens = [...row.words]; input.value = ''; renderTokens(); void search(); });
    suggestions.append(button);
  }
  suggestions.hidden = !recent.length;
}
input.addEventListener('focus', renderSearchSuggestions);
input.addEventListener('input',()=>{ if(input.value.trim())warmSelectedSubject({intent:true}); renderSearchSuggestions(); });
input.addEventListener('keydown', event => {
  if (event.key === 'Escape') $('#search-suggestions').hidden = true;
  if (event.key === 'ArrowDown' && !$('#search-suggestions').hidden) { event.preventDefault(); $('#search-suggestions button')?.focus(); }
});
$('#search-form').addEventListener('focusout', () => queueMicrotask(() => {
  if (!$('#search-form').contains(document.activeElement)) $('#search-suggestions').hidden = true;
}));
tokensNode.addEventListener('click', (event) => {
  const word = event.target.closest('button')?.dataset.word;
  if (!word) return;
  state.tokens = state.tokens.filter((token) => token !== word);
  renderTokens();
  search();
});
$('#clear-search').addEventListener('click', () => {
  closeToolbarPopovers();
  state.tokens = [];
  input.value = '';
  group.value = '';
  updateSubjectOptions();
  subject.value = '';
  setYearRange({ from: '', to: '' });
  month.value = '';
  allProfiles.checked = false;
  framework.value = '';
  unit.value = '';
  standard.value = '';
  updatePaperOptions('', 'odd');
  updateCurriculumOptions({framework:'',unit:'',standard:''});
  renderTokens();
  setHelp(state.mode === 'files' ? '모든 시험지를 표시합니다.' : '모든 문항을 표시합니다.');
  search();
});
function restoreFilterFocus(control) {
  const opener = compactToolbar.matches && control.closest('#basic-filters') ? filterToggle
    : control.closest('details')?.querySelector('summary');
  opener?.focus({ preventScroll: true });
}
group.addEventListener('change', () => { updateSubjectOptions(); allProfiles.checked = false;
  const saved = savedProfiles[group.value] || {}; updatePaperOptions(saved.track || '', saved.variant || 'odd'); updateCurriculumOptions({ framework: '', unit: '', standard: '' }); search(); restoreFilterFocus(group); });
for (const select of [subject, month, framework, unit, standard, track, variant, allProfiles]) select.addEventListener('change', () => {
  if (select === subject) updateYearOptions();
  if (select === subject) { framework.value = ''; unit.value = ''; standard.value = ''; }
  updatePaperOptions(); updateCurriculumOptions(); rememberProfile(); search(); restoreFilterFocus(select);
});
for (const control of [yearFrom, yearTo]) control.addEventListener('change', validateYearDraft);
$('#year-apply').addEventListener('click', () => { if (validateYearDraft()) applyYearRange({ from: yearFrom.value, to: yearTo.value }); });
$('#year-all').addEventListener('click', () => { yearFrom.value = ''; yearTo.value = ''; validateYearDraft(); });
$('#year-recent').addEventListener('click', () => {
  const years = [...(catalogData?.status.years || [])].sort((a, b) => b - a).slice(0, 5);
  if (years.length) { yearFrom.value = String(years.at(-1)); yearTo.value = String(years[0]); validateYearDraft(); }
});
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
  const preview = event.target.closest('.card-preview');
  if (preview) {
    selectQuestion(preview.dataset.id, !shell.classList.contains('is-split'), { push: !shell.classList.contains('is-split') && !shell.classList.contains('is-detail') });
    return;
  }
  const card = event.target.closest('.result-card');
  if (card) selectionChanged(card.dataset.id);
});
list.addEventListener('change', (event) => {
  const wrapper = event.target.closest('.question-item');
  if (!wrapper || !event.target.matches('.question-selection input')) return;
  selectionChanged(wrapper.dataset.id);
});
$('#detail-selection').addEventListener('change', () => {
  if (!selectedQuestion) return;
  selectionChanged(selectedQuestion.id);
});
$('#selection-toggle').addEventListener('click', () => {
  const expanded = $('#selection-toggle').getAttribute('aria-expanded') === 'true';
  $('#selection-toggle').setAttribute('aria-expanded', String(!expanded));
  $('#selection-tray').hidden = expanded;
});
$('#selection-clear').addEventListener('click', () => {
  const before = selection.snapshot();
  selection.clear();
  renderSelection();
  notifySelection('선택한 문항을 모두 해제했습니다.', before);
  $('#selection-undo').focus();
});
$('#selection-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('li');
  const id = row.dataset.id;
  const action = button.dataset.action;
  const index = selection.snapshot().indexOf(id);
  if (action === 'remove') { const before = selection.snapshot(); selection.remove(id); notifySelection('선택에서 문항을 제거했습니다.', before); }
  else { selection.move(id, action === 'up' ? -1 : 1); selectionUndo = null; $('#selection-notice').hidden = true; }
  renderSelection();
  const rows = [...$('#selection-list').children];
  const target = action === 'remove' ? rows[Math.min(index, rows.length - 1)] : rows.find((item) => item.dataset.id === id);
  const sameAction = target?.querySelector(`[data-action="${action}"]:not(:disabled)`);
  (sameAction || target?.querySelector('button:not(:disabled)') || $('#selection-undo')).focus();
});
$('#selection-open').addEventListener('click', () => {
  const ids = selection.snapshot();
  if (ids.length) document.dispatchEvent(new CustomEvent('open-editable-collection', { detail: { ids } }));
});
loadMore.addEventListener('click', () => changePage(1));
$('#previous-page').addEventListener('click', () => changePage(-1));
$('#mobile-back').addEventListener('click', () => {
  if (history.state?.detailEntry && shell.classList.contains('is-detail')) { history.back(); return; }
  if (shell.classList.contains('is-split')) setPreviewMode(false);
  else shell.classList.remove('is-detail');
  updateAddress();
  const card = [...list.querySelectorAll('.result-card')].find((entry) => entry.dataset.id === state.selectedId);
  card?.scrollIntoView({ block: 'nearest' });
  card?.focus({ preventScroll: true });
});
$('#file-preview-back').addEventListener('click', () => {
  if (history.state?.detailEntry) { history.back(); return; }
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
    catalogData = await browserCatalog();
    const status = catalogData.status;
    setReadiness('과목을 고르면 바로 시작할 수 있습니다', false, true);
    const issues = status.incomplete.length;
    const missingPdfs = status.incomplete.filter((issue) => issue.pdfFile);
    const unverifiedCandidates = status.incomplete.filter((issue) => issue.reason === 'new_candidates_unverified');
    const degraded = status.degradedPdfCount || 0;
    const mismatched = status.curriculumYearMismatchCount || 0;
    $('#source-status').textContent = `${status.pdfCount.toLocaleString('ko-KR')}개 시험지 · ${status.questionCount.toLocaleString('ko-KR')}개 문항`;
    if (issues || degraded || mismatched) {
      $('#index-issues').hidden = false;
      $('#toolbar-alert').hidden = false;
      $('#toolbar-menu > summary').title = `추가 검색 설정 · 색인 점검 ${issues + degraded + mismatched}개`;
      $('#issues-count').textContent = String(issues + degraded + mismatched);
      $('#issues-description').textContent = [
        missingPdfs.length ? `누락 ${missingPdfs.length}개 시험지` : '',
        unverifiedCandidates.length ? `확장 문항 검토 필요 ${unverifiedCandidates.reduce((sum, issue) => sum + issue.questionCount, 0).toLocaleString('ko-KR')}개` : '',
        degraded ? `본문 글꼴 추출 주의 ${degraded}개` : '',
        mismatched ? `교육과정 연도 불일치 ${mismatched}문항` : '',
      ].filter(Boolean).join(' · ');
      const issueList = $('#issues-list');
      for (const issue of status.incomplete) {
        const line = document.createElement('li');
        if (issue.reason === 'new_candidates_unverified') {
          line.textContent = `확장 문항 ${issue.questionCount.toLocaleString('ko-KR')}개는 원본 대조 전이며, ${issue.unreadableQuestionCount.toLocaleString('ko-KR')}개는 본문 검색이 되지 않습니다.`;
        } else if (issue.pdfFile) {
          line.textContent = `${issue.pdfFile}: ${issue.found === 0 ? '문항 추출 불가' : issue.reason || `${issue.missing.length}개 문항 누락`}`;
        } else {
          line.textContent = issue.reason || '색인 검토 필요';
        }
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
    availableSubjects = status.subjects || [];
    paperOptions = status.paperOptions || [];
    for (const { value, label } of status.groups || []) group.add(new Option(label, value));
    for (const value of status.frameworks || []) framework.add(new Option(value, value));
    for (const value of status.units || []) unit.add(new Option(value, value));
    for (const { value, label } of status.standards || []) standard.add(new Option(`${value} ${label}`, value));
    // Search words entered while the catalog was loading are retained.
    const legacySubject = initialParams.get('subject') || '';
    group.value = initialParams.get('group') || availableSubjects.find((entry) => entry.value === legacySubject)?.group || '';
    updateSubjectOptions(legacySubject);
    setYearRange(readYearRange(initialParams));
    month.value = initialParams.get('month') || '';
    framework.value = initialParams.get('framework') || '';
    unit.value = initialParams.get('unit') || '';
    standard.value = initialParams.get('standard') || '';
    allProfiles.checked = initialParams.get('allProfiles') === '1';
    const saved = savedProfiles[group.value] || {};
    updatePaperOptions(initialParams.has('track') ? initialParams.get('track') : saved.track || '',
      initialParams.get('variant') || saved.variant || 'odd');
    // Answer visibility is never restored from URL, history, or persistent storage.
    answerToggle.checked = false;
    if (initialParams.get('mode') === 'files') {
      setResultMode('files');
    }
    updateCurriculumOptions({framework: initialParams.get('framework') || '', unit: initialParams.get('unit') || '', standard: initialParams.get('standard') || ''});
    renderTokens();
    document.documentElement.dataset.catalogReady = 'true';
    {
      $('#workspace').hidden = landingOpen;
      $('#library-landing').hidden = !landingOpen;
      $('#landing-stats').textContent = `${status.pdfCount.toLocaleString('ko-KR')}개 시험지 · ${status.questionCount.toLocaleString('ko-KR')}개 문항`;
      $('#landing-subjects').replaceChildren(...status.groups.map(entry => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'landing-subject';
        const label = document.createElement('strong'); label.textContent = entry.label;
        const count = document.createElement('span'); count.textContent = `${entry.count.toLocaleString('ko-KR')}문항`;
        button.append(label, count);
        button.onclick = () => { group.value = entry.value; updateSubjectOptions(); updatePaperOptions(); updateCurriculumOptions({framework:'',unit:'',standard:''}); void search(); if (!subject.disabled) subject.focus(); };
        return button;
      }));
    }
    if (!landingOpen) await search();
  } catch (error) {
    $('#source-status').textContent = 'PDF 색인을 불러오지 못했습니다';
    setReadiness(error.message, true);
    setHelp(error.message, true);
  }
}

$('#landing-browse').addEventListener('click', () => { setResultMode('files'); void search(); });
$('.brand').addEventListener('click', () => {
  if (!catalogData) return;
  searchController?.abort();detailController?.abort();stopWarmup();
  state.searchPending=false;list.inert=false;list.setAttribute('aria-busy','false');list.classList.remove('is-refreshing');
  sourceController?.abort(); fileRenderController?.abort(); stopFileRendering?.(); clearPreviews();
  state.requestId++; state.selectionRequestId++; state.fileRequestId++;
  shell.classList.remove('is-detail', 'is-split', 'is-file-preview');
  landingOpen = true; $('#library-landing').hidden = false; $('#workspace').hidden = true;
  story.refresh();
  history.replaceState(null, '', location.pathname); publishEmbeddedAddress();
});
start();
