// OmO 작성. 월 코드와 출처를 함께 해석하여 기존 링크의 범위를 유지한다.
const hakpyeongMonths = new Set([3, 4, 5, 7, 10]);
export function isHakpyeong(item) {
  return item.source === 'hakpyeong' || hakpyeongMonths.has(Number(item.month));
}
export function needsHakpyeong(filters = {}) {
  return ['all', 'hakpyeong'].includes(filters.month) || hakpyeongMonths.has(Number(filters.month))
    || /^[pbce][12]_\d{4}_(03|04|05|07|10)(?:_|\.pdf$)/u.test(filters.id || filters.name || filters.focus || '');
}
export function matchesExam(item, filters = {}) {
  const month = Number(filters.month) || 0;
  if (month) return item.month === month;
  if (filters.month === 'all') return true;
  return isHakpyeong(item) === (filters.month === 'hakpyeong');
}
export function mergeCatalogs(base, extra) {
  const counted = key => base.status[key].map(item => ({
    ...item, count: item.count + (extra.status[key].find(row => row.value === item.value)?.count || 0),
  }));
  return {
    ...base, revision: extra.revision,
    status: {...base.status, pdfCount: base.status.pdfCount + extra.status.pdfCount,
      questionCount: base.status.questionCount + extra.status.questionCount,
      subjects: counted('subjects'), groups: counted('groups'),
      years: [...new Set([...base.status.years, ...extra.status.years])].sort((a,b)=>b-a)},
    files: [...base.files, ...extra.files].sort((a,b)=>b.year-a.year || b.month-a.month || a.subject.localeCompare(b.subject)),
    facets: [...base.facets, ...extra.facets],
    shards: {...base.shards, ...extra.shards},
  };
}
