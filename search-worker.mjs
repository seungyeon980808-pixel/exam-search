import {loadAsset,pruneAssets} from './catalog-cache.mjs?v=library-release-20261010-1';
import {searchFiles,searchQuestions,attachSearchRecord,fileQuestions} from './search.mjs?v=library-release-20261010-1';
import {paperLabel,paperPages,paperReady} from './paper-profile.mjs';
let catalog,running=0;
const loaded=new Map(),loading=new Map(),results=new Map(),indexes=new Map(),indexing=new Map(),active=new Map(),queue=[];
const abortError=()=>new DOMException('새 검색으로 대체되었습니다.','AbortError');
const yieldQueue=[],yieldChannel=new MessageChannel();
yieldChannel.port1.onmessage=()=>yieldQueue.shift()?.();
const tick=()=>new Promise(resolve=>{yieldQueue.push(resolve);yieldChannel.port2.postMessage(null);});
const guard=ctx=>{if(ctx.cancelled)throw abortError();};
const rank=job=>Math.max(-Infinity,...[...job.users].filter(ctx=>!ctx.cancelled).map(ctx=>ctx.priority*1e6+ctx.id));
function pump(){
 while(running<2&&queue.length){
  queue.sort((a,b)=>rank(b)-rank(a));const job=queue.shift();
  if(job.controller.signal.aborted||!job.users.size){job.reject(abortError());continue;}
  running++;
  job.work().then(job.resolve,job.reject).finally(()=>{running--;pump();});
 }
}
function release(ctx){
 for(const build of indexing.values()){
  build.users.delete(ctx);
  if(!build.users.size&&!build.ctx.cancelled){build.ctx.cancelled=true;release(build.ctx);}
 }
 for(const job of loading.values()){
  job.users.delete(ctx);
  if(!job.users.size)job.controller.abort();
 }
 pump();
}
async function items(subject,kind,ctx){
 guard(ctx);const key=`${subject}:${kind}`;
 if(loaded.has(key)){const value=loaded.get(key);loaded.delete(key);loaded.set(key,value);return value;}
 let job=loading.get(key);
 if(job&&!job.controller.signal.aborted){job.users.add(ctx);return job.promise;}
 job={users:new Set([ctx]),controller:new AbortController()};
 job.promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});
 job.work=async()=>{
  const value=await loadAsset(catalog.shards[subject][kind],{signal:job.controller.signal});
  job.controller.signal.throwIfAborted();loaded.set(key,value);
  const details=[...loaded.keys()].filter(k=>k.endsWith(':detail'));
  if(details.length>4)loaded.delete(details[0]);return value;
 };
 loading.set(key,job);queue.push(job);pump();
 try{return await job.promise;}finally{if(loading.get(key)===job)loading.delete(key);}
}
function scope(filters){return catalog.status.subjects.filter(s=>(!filters.subject||s.value===filters.subject)
 &&(!filters.group||s.group===filters.group)).map(s=>s.value);}
const clean=item=>{const {_hay,_hayNs,_sourceOrder,_scoreText,_scoreTitle,_scoreTags,...value}=item;return value;};
async function searchItems(subject,ctx){
 guard(ctx);if(indexes.has(subject))return indexes.get(subject);
 let build=indexing.get(subject);
 if(!build||build.ctx.cancelled){
  build={users:new Set([ctx]),ctx:{id:ctx.id,priority:ctx.priority,cancelled:false}};
  const own=build;
  build.promise=(async()=>{
   const [records,browse]=await Promise.all([items(subject,'search',own.ctx),items(subject,'browse',own.ctx)]);
   guard(own.ctx);const byId=new Map(records.map(row=>[row[0],row])),value=[];
   for(let from=0;from<browse.length;from+=256){
    for(const item of browse.slice(from,from+256)){
     const record=byId.get(item.id);if(!record)throw new Error('검색 자료에 문항이 누락되었습니다.');
     value.push(attachSearchRecord(item,record));
    }
    await tick();guard(own.ctx);
   }
   indexes.set(subject,value);loaded.delete(`${subject}:search`);return value;
  })().finally(()=>{if(indexing.get(subject)===own)indexing.delete(subject);release(own.ctx);});
  indexing.set(subject,build);
 }else{
  build.users.add(ctx);build.ctx.priority=Math.max(build.ctx.priority,ctx.priority);build.ctx.id=Math.max(build.ctx.id,ctx.id);
 }
 const value=await build.promise;guard(ctx);return value;
}
async function request(path,ctx){
 const url=new URL(path,'https://exam.local/'),p=url.searchParams;
 const filters=Object.fromEntries(['group','subject','yearFrom','yearTo','month','framework','unit','standard','track','allProfiles'].map(k=>[k,p.get(k)||'']));filters.variant=p.get('variant')||'odd';
 if(url.pathname==='/api/question'){
  const id=p.get('id'),subject=catalog.status.subjects.find(s=>id.startsWith(`${s.value}_`))?.value;
  if(!subject)throw new Error('문항을 찾을 수 없습니다.');
  const item=(await items(subject,'detail',ctx)).find(q=>q.id===id);guard(ctx);
  if(!item)throw new Error('문항을 찾을 수 없습니다.');return clean(item);
 }
 if(url.pathname==='/api/file-questions'){
  const file=catalog.files.find(f=>f.pdfFile===p.get('name'));if(!file)throw new Error('시험지를 찾을 수 없습니다.');
  const questions=await items(file.subject,'detail',ctx);guard(ctx);
  const all=fileQuestions(questions,file.pdfFile),found=fileQuestions(questions,file.pdfFile,null,filters);
  return {items:found.map(clean),pages:['math','kor'].includes(file.subject)?paperPages(all,found):null,label:paperLabel(found,filters),ready:paperReady(found,filters)};
 }
 if(!['/api/search','/api/files'].includes(url.pathname))throw new Error('지원하지 않는 요청입니다.');
 const query=p.get('q')||'',fileMode=url.pathname==='/api/files',key=JSON.stringify([fileMode,query,filters]);
 let found=results.get(key);
 if(!found){
  const questions=(await Promise.all(scope(filters).map(s=>query?searchItems(s,ctx):items(s,'browse',ctx)))).flat();guard(ctx);
  found=fileMode?searchFiles(catalog.files,questions,query,filters):searchQuestions(questions,query,filters);
  results.set(key,found);if(results.size>8)results.delete(results.keys().next().value);
 }
 guard(ctx);
 const focus=p.get('focus'),at=focus?found.findIndex(q=>(fileMode?q.pdfFile:q.id)===focus):-1;
 const pageSize=Math.max(1,Math.min(100,Number(p.get('pageSize'))||(fileMode?12:9)));
 const requested=Math.max(0,Math.min(100000,Number(p.get('offset'))||0));
 const offset=at<0?requested:Math.floor(at/pageSize)*pageSize;
 const limit=Math.ceil(40/pageSize)*pageSize;
 return {total:found.length,offset,limit,items:found.slice(offset,offset+limit).map(clean)};
}
self.onmessage=async({data})=>{
 if(data.type==='cancel'){
  const ctx=active.get(data.id);if(ctx){ctx.cancelled=true;release(ctx);}return;
 }
 const ctx={id:data.id,priority:data.priority==='background'?0:1,cancelled:false};active.set(data.id,ctx);
 try{
  let value;
  if(data.type==='init'){catalog=data.catalog;void pruneAssets(catalog);value=true;}
  else if(data.type==='prepare'){
   let done=0;const subjects=scope(data.filters||{});
   await Promise.all(subjects.map(async s=>{await searchItems(s,ctx);guard(ctx);
    if(ctx.priority)self.postMessage({type:'progress',id:ctx.id,done:++done,total:subjects.length});}));
   value={subjects:subjects.length};
  }else value=await request(data.path,ctx);
  guard(ctx);self.postMessage({id:data.id,value});
 }catch(error){if(!ctx.cancelled)self.postMessage({id:data.id,error:error.message});}
 finally{active.delete(ctx.id);release(ctx);}
};
