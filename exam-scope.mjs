// OmO 작성. 월 코드와 출처를 함께 해석하여 기존 링크의 범위를 유지한다.
const hakpyeongMonths = new Set([3, 4, 5, 7, 10]);
export function isHakpyeong(item) {
  if (isImyong(item)) return false;
  return item.source === 'hakpyeong' || hakpyeongMonths.has(Number(item.month));
}
export function isImyong(item) {
  return item.source === 'imyong' || /^t_(?:physics|chemistry|biology|earth)(?:_|$)/u.test(item.subject || item.id || item.pdfFile || '');
}
export function needsImyong(filters = {}) {
  return filters.group === 'imyong' || !!filters.domain || filters.month === 'all'
    || String(filters.month || '').startsWith('imyong')
    || /^t_(?:physics|chemistry|biology|earth)(?:_|$)/u.test(filters.subject || filters.id || filters.name || filters.focus || '');
}
export function needsHakpyeong(filters = {}) {
  return ['all', 'hakpyeong'].includes(filters.month) || hakpyeongMonths.has(Number(filters.month))
    || /^[pbce][12]_\d{4}_(03|04|05|07|10)(?:_|\.pdf$)/u.test(filters.id || filters.name || filters.focus || '');
}
export function matchesExam(item, filters = {}) {
  if (isImyong(item)) {
    if (!needsImyong(filters)) return false;
    if (filters.domain && item.domain !== undefined && item.domain !== filters.domain) return false;
    const paper = /^imyong-(A|B|single)$/u.exec(filters.month || '');
    return !paper || item.paper === paper[1];
  }
  if (filters.group === 'imyong' || filters.domain || String(filters.month || '').startsWith('imyong')) return false;
  const month = Number(filters.month) || 0;
  if (month) return item.month === month;
  if (filters.month === 'all') return true;
  return isHakpyeong(item) === (filters.month === 'hakpyeong');
}
export function mergeCatalogs(base, extra) {
  const counted = key => [...new Map([...base.status[key], ...extra.status[key]].map(item => [item.value, item])).values()]
    .map(item => ({...item, count: (base.status[key].find(row => row.value === item.value)?.count || 0)
      + (extra.status[key].find(row => row.value === item.value)?.count || 0)}));
  return {
    ...base, revision: `${base.revision}:${extra.revision}`,
    status: {...base.status, pdfCount: base.status.pdfCount + extra.status.pdfCount,
      questionCount: base.status.questionCount + extra.status.questionCount,
      subjects: counted('subjects'), groups: counted('groups'),
      incomplete: [...(base.status.incomplete || []), ...(extra.status.incomplete || [])],
      degradedPdfCount: (base.status.degradedPdfCount || 0) + (extra.status.degradedPdfCount || 0),
      years: [...new Set([...base.status.years, ...extra.status.years])].sort((a,b)=>b-a)},
    files: [...base.files, ...extra.files].sort((a,b)=>b.year-a.year || b.month-a.month || a.subject.localeCompare(b.subject)),
    facets: [...base.facets, ...extra.facets],
    shards: {...base.shards, ...extra.shards},
  };
}
