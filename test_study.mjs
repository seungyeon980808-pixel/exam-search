import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {readProgress,filterStudy} from './study-state.mjs';
import {selectImyong,stableHash} from './imyong-topics.mjs';
const items=JSON.parse(gunzipSync(readFileSync(new URL('./data/imyong/study.json.gz',import.meta.url)))).items;
const empty={schema:1,items:{}};
test('학습 색인은 기존 임용 문항을 모두 보존하고 총배점 근거와 원문을 연결한다',()=>{
 assert.equal(items.length,2588);assert.equal(new Set(items.map(q=>q.id)).size,2588);
 for(const q of items){assert(q.cardPath);assert(q.publicPath);assert(q.regions.length);assert(q._search);if(q.points)assert(q.pointsEvidence);}
 assert.equal(filterStudy(items,{points:'2'},empty).length,440);
 assert.equal(filterStudy(items,{points:'4'},empty).length,891);
 const hits=filterStudy(items,{subject:'t_physics',q:'전자기 유도',yearFrom:2014,yearTo:2026},empty);
 assert(hits.length);assert(hits.every(q=>q.subject==='t_physics'&&q.year>=2014&&q._search.includes('전자기')&&q._search.includes('유도')));
 assert(filterStudy(items,{domain:'pedagogy'},empty).length>200);
 assert.throws(()=>filterStudy(items,{yearFrom:2026,yearTo:2020},empty));assert.throws(()=>filterStudy(items,{q:'하나 둘 셋 넷'},empty));
});
test('주제 복수 선택은 합집합이며 문항 수와 무작위 설정을 실제 수록 범위에 적용한다',()=>{
 const topics=['t_physics.quantum.operators','t_physics.quantum.applications'];
 const filters={subject:'t_physics',yearFrom:2017,yearTo:2026,topics,excludeKeywords:'섭동',sortMode:'random',seed:'양자1',questionLimit:12};
 const hits=selectImyong(items,filters);assert.equal(hits.length,12);assert.equal(new Set(hits.map(q=>q.id)).size,12);
 assert(hits.every(q=>q.topicIds.some(t=>topics.includes(t))&&!q._search.includes('섭동')));
 assert.deepEqual(hits,selectImyong(items,filters));assert.notDeepEqual(hits,selectImyong(items,{...filters,seed:'양자2'}));
 const study=filterStudy(items,{topics},empty);assert(study.length>=hits.length);assert(study.every(q=>q.topicIds.some(t=>topics.includes(t))));
 assert.equal(stableHash('hello'),0x4f9f2cab);
});
test('학습 기록을 복원하되 임의 ID·잘못된 상태는 저장 상태로 받아들이지 않는다',()=>{
 const q=items[0],value={schema:1,last:q.id,items:{[q.id]:{status:'review',note:'패러데이 법칙'},bad:{status:'done'},[items[1].id]:{status:'bogus',note:5}}};
 const read=readProgress({getItem:()=>JSON.stringify(value)});assert.equal(read.items[q.id].note,'패러데이 법칙');assert.equal(read.items.bad,undefined);assert.equal(read.items[items[1].id].status,'');
 assert.deepEqual(filterStudy(items,{status:'review'},read).map(q=>q.id),[q.id]);
 assert(!filterStudy(items,{status:'new'},read).some(x=>x.id===q.id));
 assert.deepEqual(readProgress({getItem:()=>'{"schema":2,"items":{}}'}),empty);
 assert.throws(()=>readProgress({getItem:()=>'{broken'}));assert.throws(()=>readProgress({getItem:()=>{throw new Error('blocked')}}));
});
