import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validCatalog} from './catalog-cache.mjs';
import {curriculumOptions,listFiles} from './catalog-filters.mjs';
import {searchQuestions,searchFiles,catalogFiles,prepareQuestions,normalize,attachSearchRecord} from './search.mjs';
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const catalog=read('./data/catalog.json'),index=read('./data/questions.json'),files=read('./data/files.json'),synonyms=read('./data/synonyms.json');
const hash=value=>createHash('sha256').update(value).digest('hex');
const browse=[],detail=[],searchRecords=[];
for(const shard of Object.values(catalog.shards))for(const kind of ['browse','detail','search']){
 const a=shard[kind],bytes=readFileSync(new URL(a.path,import.meta.url));
 assert.equal(bytes.length,a.bytes);assert.equal(hash(bytes),a.sha256);
 (kind==='browse'?browse:kind==='detail'?detail:searchRecords).push(...JSON.parse(bytes));
}
test('generated assets match the full source revision and all original detail fields',()=>{
 assert(validCatalog(catalog));assert(!validCatalog({schema:'exam-browser-v1'}));
 assert.equal(catalog.sourceRevision,hash(JSON.stringify([index,files,synonyms])));
 const {revision,...contents}=catalog;assert.equal(revision,hash(JSON.stringify(contents)));
 assert.equal(detail.length,index.items.length);
 const byId=new Map(detail.map(q=>[q.id,q]));for(const q of index.items)assert.deepEqual(byId.get(q.id),q);
 assert.equal(catalog.files.length,files.length);
 assert(browse.every(q=>!Object.hasOwn(q,'text')));
});
test('lightweight browsing retains exact profile, year and unit filtering',()=>{
 const scenarios=[{}, {subject:'math',yearFrom:2021,yearTo:2021,track:'ga',variant:'odd'},
 {subject:'math',yearFrom:2025,yearTo:2025,track:'calculus',variant:'odd'},
 {subject:'kor',yearFrom:2025,yearTo:2025,track:'language_media'},
 {subject:'p1',yearFrom:2025,yearTo:2025,unit:'파동과 정보통신'}, {subject:'b1'}, {group:'social'}, {allProfiles:'1'}];
 for(const filters of scenarios){
  assert.deepEqual(searchQuestions(browse,'',filters).map(q=>q.id),searchQuestions(index.items,'',filters).map(q=>q.id));
  assert.deepEqual(searchFiles(catalog.files,browse,'',filters).map(f=>[f.pdfFile,f.questionCount]),
    searchFiles(catalogFiles(files,index.items),index.items,'',filters).map(f=>[f.pdfFile,f.questionCount]));
 }
});
test('subject/year/framework facets never include another subject and empty scopes stay empty',()=>{
 for(const subject of catalog.status.subjects){
  const options=curriculumOptions(catalog,{subject:subject.value,year:2025});
  const rows=catalog.facets.filter(f=>f.subject===subject.value&&f.year===2025);
  for(const unit of options.units)assert(rows.some(f=>f.unit.split(/\s*·\s*/u).includes(unit)||f.standards.some(s=>s.unit===unit)));
 }
 assert.deepEqual(curriculumOptions(catalog,{subject:'missing'}),{frameworks:[],units:[],standards:[]});
 const physics=curriculumOptions(catalog,{group:'science',subject:'p1',year:2025});
 assert(physics.units.includes('파동과 정보통신'));assert(!physics.units.includes('유전'));
 const biology=curriculumOptions(catalog,{subject:'b1',year:2025});assert(!biology.units.includes('파동과 정보통신'));
});
test('full-text synonym ranking is unchanged across subject shards',()=>{
 const byId=new Map(searchRecords.map(q=>[q[0],q]));
 const original=prepareQuestions(index.items,synonyms.map),sharded=browse.map(q=>attachSearchRecord(q,byId.get(q.id)));
 assert.equal(sharded.length,original.length);
 const expected=new Map(original.map(q=>[q.id,q]));
 for(const q of sharded){const source=expected.get(q.id);
  assert.equal(q._hay,source._hay);assert.equal(q._hayNs,source._hayNs);
  assert.equal(q._scoreText,normalize(source.text));assert.equal(q._scoreTitle,normalize(source.title));assert.equal(q._scoreTags,normalize((source.tags||[]).join(' ')));
 }
 for(const [q,filters] of [['빛 간섭 경로차',{subject:'p2'}],['동형이의어 문맥 의미',{subject:'kor'}],['유전',{subject:'b1'}],['확률',{subject:'math'}],['price',{subject:'eng'}],['전자기파',{}],['DNA',{group:'science'}],['매매 계약',{subject:'kor'}],['일',{}],['2025',{allProfiles:'1'}]])
  assert.deepEqual(searchQuestions(sharded,q,filters).map(i=>i.id),searchQuestions(original,q,filters).map(i=>i.id));
 assert(searchRecords.every(row=>Array.isArray(row)&&!Object.hasOwn(row,'pdfFile')));
 assert(Object.values(catalog.shards).reduce((n,s)=>n+s.search.bytes,0)<26000000);
});

test('curriculum choices follow common/elective tracks and preserve compound-unit bookmarks',()=>{
 for(const subject of ['math','kor'])for(const track of ['', 'calculus','geometry','probability_statistics','hwajak','eonmae']){
  const filters={subject,year:2025,track,variant:'odd'};
  const options=curriculumOptions(catalog,filters);
  for(const unit of options.units)assert(searchQuestions(browse,'',{subject,yearFrom:2025,yearTo:2025,track,variant:'odd',unit}).length>0);
 }
 const compound=catalog.facets.find(f=>f.subject==='p1'&&f.year===2025&&f.unit.includes(' · ')).unit;
 assert(curriculumOptions(catalog,{subject:'p1',year:2025,preserveUnit:compound}).units.includes(compound));
});

test('light paper catalog preserves profile counts and first pages without loading question indexes',()=>{
 for(const filters of [{},{subject:'p1',yearFrom:2025,yearTo:2025},{subject:'math',track:'ga',yearFrom:2021,yearTo:2021},
 {subject:'math',track:'calculus',variant:'even',yearFrom:2025,yearTo:2025},{subject:'kor',track:'eonmae'}, {allProfiles:'1'}]){
  const actual=listFiles(catalog,filters);
  const expected=searchFiles(catalogFiles(files,index.items),index.items,'',filters);
  assert.deepEqual(actual.map(f=>[f.pdfFile,f.questionCount,f.firstMatchPage]),expected.map(f=>[f.pdfFile,f.questionCount,f.firstMatchPage]));
 }
});
