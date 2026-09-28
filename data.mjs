import { catalogFiles, curriculumYearMismatch, prepareQuestions, searchFiles, searchQuestions, subjectGroup, fileQuestions } from './search.mjs';

let catalogPromise;
let answersPromise;
let publicPaths = new Map();

// A separate, optional answer index is fetched only after the user turns answers on.
async function answers() {
  if (!answersPromise) answersPromise = fetch(new URL('./data/answers.json', import.meta.url))
    .then(async (response) => response.status === 404 ? { items: [] }
      : response.ok ? response.json() : Promise.reject(new Error('정답 색인을 불러오지 못했습니다.')))
    .then((index) => new Map((index.items || []).map((entry) => [entry.questionId, entry])))
    .catch((error) => { answersPromise = null; throw error; });
  return answersPromise;
}

async function catalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.all(['questions', 'files', 'synonyms'].map(async (name) => {
      const response = await fetch(new URL(`./data/${name}.json`, import.meta.url));
      if (!response.ok) throw new Error(`${name} 색인을 불러오지 못했습니다.`);
      return response.json();
    })).then(([index, sourceFiles, synonyms]) => {
      const questions = prepareQuestions(index.items, synonyms.map || {});
      publicPaths = new Map(sourceFiles.map((file) => [file.pdfFile, file.publicPath]));
      return { index, questions, files: catalogFiles(sourceFiles, questions),
        pageCounts: new Map(sourceFiles.map((file) => [file.pdfFile, file.pageCount])),
        byId: new Map(questions.map((item) => [item.id, item])) };
    });
  }
  return catalogPromise;
}

export function driveFilePath(name) {
  return publicPaths.get(name) || '';
}

export async function getJson(path) {
  const { index, questions, files, pageCounts, byId } = await catalog();
  const url = new URL(path, location.href);
  const params = url.searchParams;
  if (url.pathname === '/api/status') {
    const subjects = [...new Map(questions.map((item) => [item.subject, item.subjectLabel || item.subject])).entries()]
      .map(([value, label]) => ({ value, label, group: subjectGroup(value).value }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    const availableGroups = new Map(subjects.map(({ value }) => {
      const entry = subjectGroup(value);
      return [entry.value, entry];
    }));
    const groups = ['kor', 'eng', 'math', 'science', 'social', 'other']
      .filter((value) => availableGroups.has(value)).map((value) => availableGroups.get(value));
    const applicable = questions.filter((item) => !curriculumYearMismatch(item));
    const curriculumYearMismatchCount = questions.length - applicable.length;
    const frameworks = [...new Set(applicable.map((item) => item.curriculum?.framework).filter(Boolean))].sort();
    const units = [...new Set(applicable.flatMap((item) => [item.curriculum?.unit,
      ...(item.curriculum?.standards || []).map((standard) => standard.unit)].filter(Boolean)))].sort();
    const standards = [...new Map(applicable.flatMap((item) => (item.curriculum?.standards || [])
      .filter((standard) => standard.code).map((standard) => [standard.code, standard.text || standard.code]))).entries()]
      .map(([value, label]) => ({ value, label })).sort((a, b) => a.value.localeCompare(b.value));
    return { pdfCount: index.pdfCount, questionCount: index.questionCount,
      incomplete: index.incomplete || [], degradedPdfCount: index.degradedPdfCount,
      years: [...new Set(questions.map((item) => item.year))].sort((a, b) => b - a),
      groups, subjects, frameworks, units, standards, curriculumYearMismatchCount };
  }
  if (url.pathname === '/api/question') {
    const item = byId.get(params.get('id'));
    if (!item) throw new Error('문항을 찾을 수 없습니다.');
    return item;
  }
  if (url.pathname === '/api/answer') {
    const entry = (await answers()).get(params.get('id'));
    // Candidate and unverified entries never acquire a displayable answer by accident.
    return entry?.verificationStatus === 'verified' ? entry : null;
  }
  if (url.pathname === '/api/file-questions') {
    return { items: fileQuestions(questions, params.get('name')) };
  }
  if (url.pathname === '/api/file-pages') {
    const pageCount = pageCounts.get(params.get('name'));
    if (!pageCount) throw new Error('시험지를 찾을 수 없습니다.');
    return { pageCount };
  }
  if (url.pathname === '/api/search' || url.pathname === '/api/files') {
    const filters = { group: params.get('group') || '', subject: params.get('subject') || '',
      yearFrom: params.get('yearFrom') || '', yearTo: params.get('yearTo') || '',
      month: params.get('month') || '', framework: params.get('framework') || '',
      unit: params.get('unit') || '', standard: params.get('standard') || '' };
    const query = params.get('q') || '';
    const fileMode = url.pathname === '/api/files';
    const found = fileMode ? searchFiles(files, questions, query, filters)
      : searchQuestions(questions, query, filters);
    const focus = params.get('focus');
    const focusIndex = focus ? found.findIndex((item) => fileMode
      ? item.pdfFile === focus : item.id === focus) : -1;
    const pageSize = Math.max(1, Math.min(100, Number(params.get('pageSize')) || (fileMode ? 12 : 9)));
    const requested = Math.max(0, Math.min(100_000, Number(params.get('offset')) || 0));
    const offset = focusIndex < 0 ? requested : Math.floor(focusIndex / pageSize) * pageSize;
    return { total: found.length, offset, limit: 40, items: found.slice(offset, offset + 40) };
  }
  throw new Error('지원하지 않는 요청입니다.');
}
