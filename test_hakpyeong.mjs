// OmO 작성. 출처별 검색 범위, 전송 압축, 실제 배포 자료의 연결을 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {validCatalog,loadAsset} from './catalog-cache.mjs';
import {mergeCatalogs,needsHakpyeong} from './exam-scope.mjs';
import {searchQuestions,searchFiles,attachSearchRecord} from './search.mjs';
import {listFiles} from './catalog-filters.mjs';
const bytes=path=>readFileSync(new URL(path,import.meta.url));
const read=path=>JSON.parse(path.endsWith('.gz')?gunzipSync(bytes(path)):bytes(path));
const base=read('data/catalog.json'),extra=read('data/hakpyeong/catalog.json');
const catalog=mergeCatalogs(base,extra);
const hash=value=>createHash('sha256').update(value).digest('hex');
const questions=Object.values(extra.shards).flatMap(shard=>read(shard.detail.path));

test('시험 출처와 월 조건은 문항 검색과 시험지 검색에서 같은 범위를 유지한다',()=>{
 const make=(id,month)=>({id,month,subject:'p1',year:2027,no:1,page:1,pdfFile:id+'.pdf',title:'파동',text:'파동 전자기파'});
 const items=[make('모평',6),make('수능',11),make('학평3',3),make('학평7',7)];
 const files=items.map(q=>({...q,questionCount:1,profiles:[{track:'all',variant:'single',questionCount:1,firstMatchPage:1}]}));
 for(const [month,expected] of [['',['수능','모평']],['hakpyeong',['학평7','학평3']],['3',['학평3']],['all',['수능','학평7','모평','학평3']]]) {
  assert.deepEqual(searchQuestions(items,'파동',{month}).map(q=>q.id),expected);
  assert.deepEqual(searchFiles(files,items,'파동',{month}).map(f=>f.id),expected);
  assert.deepEqual(listFiles({files}, {month}).map(f=>f.id).sort(),[...expected].sort());
 }
});
test('학평 상세 주소만으로도 추가 색인을 요청하며 기존 주소는 추가하지 않는다',()=>{
 for(const filters of [{month:'hakpyeong'},{month:'all'},{month:'5'},{id:'p1_2027_03_01'},{name:'b2_2015_07.pdf'}])assert.equal(needsHakpyeong(filters),true);
 for(const filters of [{},{month:'6'},{id:'p1_2027_06_01'},{name:'b2_2015_11.pdf'}])assert.equal(needsHakpyeong(filters),false);
});
test('560개 시험지의 11200문항과 모든 압축 색인·카드가 손실 없이 연결된다',()=>{
 assert(validCatalog(extra));
 assert.equal(extra.files.length,560);
 assert.equal(questions.length,11200);
 assert.equal(new Set(questions.map(q=>q.id)).size,11200);
 for(const file of extra.files) {
  assert.equal(questions.filter(q=>q.pdfFile===file.pdfFile).length,20);
  assert.match(file.publicPath,/^학력평가\/[^/]+\/문제\/[pbce][12]_\d{4}_\d{2}\.pdf$/u);
  assert(bytes(file.thumbnailPath).length>0);
 }
 for(const shard of Object.values(extra.shards))for(const asset of Object.values(shard)){
  assert.equal(bytes(asset.path).length,asset.bytes);
  assert.equal(hash(bytes(asset.path)),asset.sha256);
 }
 for(const q of questions) {
  const url=new URL(q.cardPath),card=bytes(`cards/${q.id}.webp`);
  assert.equal(url.hostname,'raw.githubusercontent.com');
  assert.equal(url.pathname,`/seungyeon980808-pixel/exam-search/main/cards/${q.id}.webp`);
  assert.equal(url.searchParams.get('v'),hash(card).slice(0,16));
  assert.equal(card.toString('ascii',0,4),'RIFF');
  assert.equal(card.toString('ascii',8,12),'WEBP');
 }
});
test('학평 본문은 과목별 압축 검색 기록으로 검색되고 기존 목록과 합쳐진다',()=>{
 const shard=extra.shards.hp_p1,records=new Map(read(shard.search.path).map(row=>[row[0],row]));
 const items=read(shard.browse.path).map(q=>attachSearchRecord(q,records.get(q.id)));
 assert(searchQuestions(items,'전자기파',{month:'3',yearFrom:2027,yearTo:2027}).some(q=>q.id==='p1_2027_03_01'));
 assert.equal(searchQuestions(items,'',{month:'hakpyeong'}).length,1600);
 assert.equal(searchQuestions(items,'').length,0);
 assert.equal(catalog.status.questionCount,30960);
 assert.equal(listFiles(catalog,{month:'hakpyeong'}).length,560);
 assert.equal(listFiles(catalog,{month:'all',allProfiles:'1'}).length,1382);
 assert.deepEqual(listFiles(catalog),listFiles(base));
});
test('브라우저 자료 읽기는 gzip 전송 바이트를 검증한 뒤 문항 배열을 복원한다',async()=>{
 const asset=extra.shards.hp_p1.browse,original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(bytes(asset.path));
 try {assert.deepEqual(await loadAsset(asset),read(asset.path));}
 finally {globalThis.fetch=original;}
});
