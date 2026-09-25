export function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko');
}

export function parseTokens(query) {
  const tokens = normalize(query).trim().split(/[#，,\s]+/u).filter(Boolean);
  if (tokens.length > 3) throw new RangeError('검색어는 최대 3개까지 입력할 수 있습니다.');
  return [...new Set(tokens)];
}

function searchableText(item, synonyms = {}) {
  const related = [...(item.tags || []), ...(item.parts || [])]
    .flatMap((name) => synonyms[name] || []);
  const curriculum = item.curriculum || {};
  const standards = (curriculum.standards || [])
    .map((standard) => `${standard.code || ''} ${standard.subject || ''} ${standard.unit || ''} ${standard.text || ''}`);
  return normalize([
    item.id, item.title, item.textQuality === 'unreadable' ? '' : item.text,
    ...(item.tags || []), ...(item.parts || []), ...related,
    curriculum.framework, curriculum.subject, curriculum.unit,
    curriculum.explanation, ...standards,
  ].join(' '));
}

export function prepareQuestions(items, synonyms = {}) {
  return items.map((item) => {
    const hay = searchableText(item, synonyms);
    return { ...item, _hay: hay, _hayNs: hay.replace(/\s+/gu, '') };
  });
}

export function searchQuestions(items, query, filters = {}) {
  const tokens = parseTokens(query);
  const prepared = items[0]?._hay === undefined ? prepareQuestions(items) : items;
  const yearFrom = Number(filters.yearFrom) || 0;
  const yearTo = Number(filters.yearTo) || Infinity;
  const month = Number(filters.month) || 0;
  const hits = prepared.filter((item) => {
    if (filters.subject && item.subject !== filters.subject) return false;
    if (item.year < yearFrom || item.year > yearTo) return false;
    if (month && item.month !== month) return false;
    return tokens.every((token) => item._hay.includes(token) || item._hayNs.includes(token));
  });
  const score = (item) => tokens.reduce((sum, token) => {
    const title = normalize(item.title);
    const tags = normalize((item.tags || []).join(' '));
    return sum + (title.includes(token) ? 8 : 0) + (tags.includes(token) ? 5 : 0)
      + (normalize(item.text).includes(token) ? 1 : 0);
  }, 0);
  return hits.sort((a, b) => score(b) - score(a)
    || b.year - a.year || b.month - a.month || a.no - b.no);
}

const namePattern = /^([pbce][12])_(\d{4})_(06|09|11)\.pdf$/u;
const subjects = {
  p1: '물리학Ⅰ', p2: '물리학Ⅱ', c1: '화학Ⅰ', c2: '화학Ⅱ',
  b1: '생명과학Ⅰ', b2: '생명과학Ⅱ', e1: '지구과학Ⅰ', e2: '지구과학Ⅱ',
};

export function catalogFiles(names, questions) {
  const counts = new Map();
  for (const item of questions) counts.set(item.pdfFile, (counts.get(item.pdfFile) || 0) + 1);
  return names.flatMap((pdfFile) => {
    const match = namePattern.exec(pdfFile);
    if (!match) return [];
    const [, subject, yearText, monthText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    return [{ pdfFile, subject, subjectLabel: subjects[subject], year, month,
      exam: `${year}학년도 ${month === 11 ? '수능' : `${month}월 모평`}`,
      questionCount: counts.get(pdfFile) || 0 }];
  }).sort((a, b) => b.year - a.year || b.month - a.month || a.subject.localeCompare(b.subject));
}

export function searchFiles(files, questions, query, filters = {}) {
  const tokens = parseTokens(query);
  const yearFrom = Number(filters.yearFrom) || 0;
  const yearTo = Number(filters.yearTo) || Infinity;
  const month = Number(filters.month) || 0;
  const eligible = files.filter((file) => (!filters.subject || file.subject === filters.subject)
    && file.year >= yearFrom && file.year <= yearTo && (!month || file.month === month));
  if (!tokens.length) return eligible.map((file) => ({ ...file, matchedCount: file.questionCount, firstMatchPage: 1 }));
  const byName = new Map(eligible.map((file) => [file.pdfFile, file]));
  const matches = new Map();
  for (const item of searchQuestions(questions, query, filters)) {
    if (!byName.has(item.pdfFile)) continue;
    const current = matches.get(item.pdfFile);
    if (current) current.matchedCount += 1;
    else matches.set(item.pdfFile, { matchedCount: 1, firstMatchPage: item.page || 1 });
  }
  return [...matches].map(([name, match]) => ({ ...byName.get(name), ...match }));
}
