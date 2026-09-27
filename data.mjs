import { catalogFiles, prepareQuestions, searchFiles, searchQuestions } from './search.mjs';

let catalogPromise;
let publicPaths = new Map();

async function catalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.all(['questions', 'files', 'synonyms'].map(async (name) => {
      const response = await fetch(new URL(`./data/${name}.json`, import.meta.url));
      if (!response.ok) throw new Error(`${name} 색인을 불러오지 못했습니다.`);
      return response.json();
    })).then(([index, sourceFiles, synonyms]) => {
      const questions = prepareQuestions(index.items, synonyms.map || {});
      publicPaths = new Map(sourceFiles.map((file) => [file.pdfFile, file.publicPath]));
      return { index, questions, files: catalogFiles(sourceFiles.map((file) => file.pdfFile), questions),
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
    return { pdfCount: index.pdfCount, questionCount: index.questionCount,
      incomplete: index.incomplete, degradedPdfCount: index.degradedPdfCount,
      years: [...new Set(questions.map((item) => item.year))].sort((a, b) => b - a) };
  }
  if (url.pathname === '/api/question') {
    const item = byId.get(params.get('id'));
    if (!item) throw new Error('문항을 찾을 수 없습니다.');
    return item;
  }
  if (url.pathname === '/api/file-pages') {
    const pageCount = pageCounts.get(params.get('name'));
    if (!pageCount) throw new Error('시험지를 찾을 수 없습니다.');
    return { pageCount };
  }
  if (url.pathname === '/api/search' || url.pathname === '/api/files') {
    const filters = { subject: params.get('subject') || '',
      yearFrom: params.get('yearFrom') || '', yearTo: params.get('yearTo') || '',
      month: params.get('month') || '' };
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
