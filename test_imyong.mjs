import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {validCatalog} from './catalog-cache.mjs';
import {mergeCatalogs,needsImyong} from './exam-scope.mjs';
import {searchQuestions,searchFiles,attachSearchRecord} from './search.mjs';
import {listFiles} from './catalog-filters.mjs';
import {questionSubject} from './question-id.mjs';
const bytes=p=>readFileSync(new URL(p,import.meta.url));
const read=p=>JSON.parse(p.endsWith('.gz')?gunzipSync(bytes(p)):bytes(p));
const base=read('data/catalog.json'),extra=read('data/imyong/catalog.json');
const questions=Object.values(extra.shards).flatMap(s=>read(s.detail.path));

test('공식 임용 152개 시험지와 모든 문항·검색 색인·원본 영역이 연결된다',()=>{
 assert(validCatalog(extra));assert.equal(extra.files.length,152);
 assert.equal(extra.status.incomplete.length,0);
 assert.equal(new Set(questions.map(q=>q.id)).size,questions.length);
 assert.deepEqual(extra.status.years,Array.from({length:25},(_,i)=>2026-i));
 for(const file of extra.files){
  assert.equal(questions.filter(q=>q.pdfFile===file.pdfFile).length,file.questionCount);
  assert.match(file.publicPath,/^기출문제\/임용기출\/(물리|화학|생물|지구과학)\/t_.*\.pdf$/u);
  assert.equal(new URL(file.sourceUrl).hostname,'www.kice.re.kr');
 }
 for(const shard of Object.values(extra.shards))for(const asset of Object.values(shard)){
  assert.equal(bytes(asset.path).length,asset.bytes);
  assert.equal(createHash('sha256').update(bytes(asset.path)).digest('hex'),asset.sha256);
 }
 for(const q of questions){
  assert.equal(questionSubject(q.id,extra.status.subjects),q.subject);
  assert(q.text.length>10,q.id);assert(q.regions.length>0,q.id);
  assert(existsSync(new URL(q.cardPath,import.meta.url)),q.id);
  const file=extra.files.find(f=>f.pdfFile===q.pdfFile);
  for(const r of q.regions){assert(r.page>=1&&r.page<=file.pageCount);assert(r.box[2]>r.box[0]&&r.box[3]>r.box[1]);}
 }
});
test('과학교육론·과목·전공 A/B·학년도 필터는 본문 검색과 시험지 검색에 동일하게 적용된다',()=>{
 const all={group:'imyong',month:'imyong'},ped={...all,domain:'pedagogy'};
 const pedagogy=searchQuestions(questions,'',ped);
 assert(pedagogy.length>200);
 assert.equal(searchQuestions(questions,'',all).length,questions.length);
 assert.equal(searchQuestions(questions,'').length,0);
 for(const word of ['개념변화','순환학습','과학의본성','교육과정']){
  const found=searchQuestions(questions,word,ped);assert(found.length>0,word);
  const papers=searchFiles(extra.files,questions,word,ped);
  assert.deepEqual(new Set(papers.map(f=>f.pdfFile)),new Set(found.map(q=>q.pdfFile)));
 }
 for(const subject of extra.status.subjects){
  const f={...all,subject:subject.value,month:'imyong-B',yearFrom:2025,yearTo:2026};
  assert.equal(searchQuestions(questions,'',f).length,22);
  assert.equal(listFiles(extra,f).length,2);
 }
 const sample=searchQuestions(questions,'전자기 유도',all);assert(sample.length>0);
 assert(sample.every(q=>q.text.replace(/\s/g,'').includes('전자기')&&q.text.replace(/\s/g,'').includes('유도')));
 const records=Object.values(extra.shards).flatMap(s=>{const byId=new Map(read(s.search.path).map(r=>[r[0],r]));return read(s.browse.path).map(q=>attachSearchRecord(q,byId.get(q.id)));});
 assert.deepEqual(searchQuestions(records,'개념변화',ped).map(q=>q.id).sort(),searchQuestions(questions,'개념변화',ped).map(q=>q.id).sort());
});
test('기존 수능 범위와 학평 합계, 임용 상세 주소와 번호 재시작을 보존한다',()=>{
 const merged=mergeCatalogs(base,extra);
 assert.deepEqual(listFiles(merged),listFiles(base));
 assert.equal(merged.status.questionCount,base.status.questionCount+questions.length);
 assert(needsImyong({id:'t_physics_2026_A_01'}));assert(needsImyong({month:'imyong-B'}));
 const old=questions.filter(q=>q.pdfFile==='t_physics_2014_B.pdf');
 assert.equal(old.length,4);assert.deepEqual(old.map(q=>q.no),[1,2,1,2]);
 assert.equal(new Set(old.map(q=>q.id)).size,4);
 assert(questions.filter(q=>q.textQuality==='ocr').length>300);
 assert(questions.some(q=>new Set(q.regions.map(r=>r.page)).size>1));
});
