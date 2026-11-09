import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {searchQuestions} from '../search.mjs';
import {fileURLToPath} from 'node:url';
const base=process.env.EXAM_SEARCH_URL||'http://127.0.0.1:8851/';
const output=process.env.EXAM_QA_OUTPUT||fileURLToPath(new URL('../../qa/',import.meta.url));
await mkdir(output,{recursive:true});
const {items}=JSON.parse(await readFile(new URL('../data/imyong/questions.json',import.meta.url)));
const observations=[];
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch({headless:true});
 try{
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:960}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base);
   await page.locator('.landing-subject').filter({hasText:'중등 임용'}).click();
   await page.waitForFunction(n=>document.querySelector('#result-count')?.textContent===`검색 결과 ${n.toLocaleString('ko-KR')}개`,items.length);
   if(!await page.locator('#domain-filter').isVisible())await page.locator('#filter-toggle').click();
   await page.locator('#domain-filter').selectOption('pedagogy');
   await page.locator('#keyword-input').fill('개념변화');
   await page.locator('#search-form').evaluate(f=>f.requestSubmit());
   const expected=searchQuestions(items,'개념변화',{group:'imyong',domain:'pedagogy'}).length;
   await page.waitForFunction(n=>document.querySelector('#result-count')?.textContent===`검색 결과 ${n.toLocaleString('ko-KR')}개`,expected);
   await page.waitForFunction(()=>{const i=document.querySelector('.question-item:not([hidden]) .result-card img');return i?.complete&&i.naturalWidth>0;});
   await page.locator('.question-item:not([hidden]) .result-card img').first().evaluate(i=>i.decode());
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`${output}/${engine}-${width}-search.png`});
   await page.reload();await page.locator('.result-card').first().waitFor();
   assert.equal(await page.locator('#group-filter').inputValue(),'imyong');
   assert.equal(await page.locator('#domain-filter').inputValue(),'pedagogy');
   await page.locator('.card-preview').first().click();
   await page.waitForFunction(()=>document.querySelector('#source-image')?.src.startsWith('blob:')&&document.querySelector('#source-image').naturalWidth>0,{timeout:60000});
   assert.match(decodeURIComponent(await page.locator('#open-pdf').getAttribute('href')),/기출문제\/임용기출/u);
   await page.screenshot({path:`${output}/${engine}-${width}-detail.png`});
   const metrics=await page.evaluate(async()=>{
    const {getJson}=await import('./data.mjs?v=imyong-20261109-1');
    const rows=[];
    for(const q of ['전자기유도','산화환원','유전','판구조론','개념변화','POE']){
     const t=performance.now(),result=await getJson(`/api/search?group=imyong&q=${encodeURIComponent(q)}`);
     rows.push({q,total:result.total,ms:Math.round(performance.now()-t)});
    }
    return rows;
   });
   assert(metrics.every(r=>r.total>0));assert.deepEqual(errors,[]);
   await page.goto(base+'?group=science&subject=p1&year=2025&month=11');
   await page.waitForFunction(()=>document.querySelector('#result-count')?.textContent==='검색 결과 20개');
   observations.push({engine,width,expected,metrics,errors});await page.close();
  }
 }finally{await browser.close();}
}
await writeFile(`${output}/result.json`,JSON.stringify(observations,null,2));
console.log(JSON.stringify(observations,null,2));
