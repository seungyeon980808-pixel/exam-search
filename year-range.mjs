const yearValue = value => /^\d{4}$/.test(String(value ?? '')) && Number(value) >= 1000 ? String(value) : '';

export function readYearRange(params) {
  const legacy = yearValue(params.get('year'));
  const explicit = params.has('yearFrom') || params.has('yearTo');
  const from = yearValue(explicit ? params.get('yearFrom') : legacy);
  const to = yearValue(explicit ? params.get('yearTo') : legacy);
  return from && to && Number(from) > Number(to) ? { from: to, to: from } : { from, to };
}

export function validYearRange({ from, to }) {
  return (!from || !!yearValue(from)) && (!to || !!yearValue(to)) && (!from || !to || Number(from) <= Number(to));
}

export function writeYearRange(params, { from, to }) {
  params.delete('year'); params.delete('yearFrom'); params.delete('yearTo');
  if (from) params.set('yearFrom', from);
  if (to) params.set('yearTo', to);
  return params;
}

export function yearRangeLabel({ from, to }) {
  if (from && to) return from === to ? `${from}학년도` : `${from}–${to}`;
  return from ? `${from} 이후` : to ? `${to} 이전` : '전체 연도';
}

export function includesYear(year, { from, to }) {
  return Number(year) >= (Number(from) || 0) && Number(year) <= (Number(to) || Infinity);
}
