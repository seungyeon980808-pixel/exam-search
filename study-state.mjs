export const STORAGE_KEY = '5e-imyong-study-v1';
export function readProgress(storage) {
  const value = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
  if (value.schema !== 1 || !value.items || typeof value.items !== 'object' || Array.isArray(value.items)) return {schema:1, items:{}};
  const items = Object.fromEntries(Object.entries(value.items).filter(([id,v]) => /^t_(physics|chemistry|biology|earth)_\d{4}_(A|B|single)_\d+$/.test(id) && v && typeof v === 'object').map(([id,v]) => [id, {status:['done','review'].includes(v.status)?v.status:'', note:typeof v.note==='string'?v.note.slice(0,20000):''}]));
  return {schema:1, items, last:typeof value.last==='string'?value.last:''};
}
export function filterStudy(items, filters, progress) {
  const tokens = (filters.q || '').normalize('NFKC').toLocaleLowerCase('ko').trim().split(/[\s,，#]+/u).filter(Boolean);
  if (tokens.length > 3) throw new Error('검색어는 세 단어까지 입력해 주세요.');
  if (+filters.yearFrom > +filters.yearTo) throw new Error('시작 학년도를 끝 학년도보다 작게 골라 주세요.');
  const topics=Array.isArray(filters.topics)?filters.topics:String(filters.topics||'').split(',').filter(Boolean);
  return items.filter(q => (!filters.subject || q.subject===filters.subject)
    && (!filters.domain || q.domain===filters.domain)
    && (!filters.points || q.points===Number(filters.points))
    && (!topics.length || topics.some(id=>q.topicIds?.includes(id)))
    && q.year>=Number(filters.yearFrom || 2002) && q.year<=Number(filters.yearTo || 2026)
    && (!filters.status || (filters.status==='new'?!progress.items[q.id]?.status:progress.items[q.id]?.status===filters.status))
    && tokens.every(t => (q._search || '').includes(t.replace(/\s/gu,''))));
}
