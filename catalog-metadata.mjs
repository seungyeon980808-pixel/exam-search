import {curriculumYearMismatch,subjectGroup} from './search.mjs';
export function createCatalogMetadata(index) {
const subjects = [...new Map(index.items.map(q => [q.subject, q.subjectLabel || q.subject]))]
  .map(([value,label])=>({value,label,group:subjectGroup(value).value, count:index.items.filter(q=>q.subject===value).length}))
  .sort((a,b)=>a.label.localeCompare(b.label,'ko'));
const groups = ['kor','eng','math','science','social','other'].filter(g=>subjects.some(s=>s.group===g))
  .map(value=>({...subjectGroup(subjects.find(s=>s.group===value).value),count:index.items.filter(q=>subjectGroup(q.subject).value===value).length}));
const applicable=index.items.filter(q=>!curriculumYearMismatch(q));
const facets=[...new Map(applicable.filter(q=>q.curriculum).map(q=>{
 const value={subject:q.subject,year:q.year,month:q.month,track:q.track||'all',variant:q.variant||'single',framework:q.curriculum.framework||'',unit:q.curriculum.unit||'',
 standards:(q.curriculum.standards||[]).map(s=>({value:s.code,unit:s.unit||''}))};
 return [JSON.stringify(value),value];
})).values()];
const status={pdfCount:index.pdfCount,questionCount:index.questionCount,incomplete:index.incomplete||[],degradedPdfCount:index.degradedPdfCount,
 years:[...new Set(index.items.map(q=>q.year))].sort((a,b)=>b-a),subjects,groups,
 frameworks:[...new Set(facets.map(f=>f.framework).filter(Boolean))].sort(),
 units:[...new Set(facets.flatMap(f=>[f.unit,...f.standards.map(s=>s.unit)]).filter(Boolean))].sort(),
 standards:[...new Map(applicable.flatMap(q=>(q.curriculum?.standards||[]).filter(s=>s.code).map(s=>[s.code,{value:s.code,label:s.text||s.code}]))).values()],
 curriculumYearMismatchCount:index.items.length-applicable.length,
 paperOptions:[...new Map(index.items.filter(q=>['math','kor'].includes(q.subject)).map(q=>[`${q.subject}:${q.year}:${q.month}:${q.track}:${q.variant}`,
 {subject:q.subject,year:q.year,month:q.month,track:q.track,variant:q.variant}])).values()]};
return {subjects,groups,facets,status};
}
