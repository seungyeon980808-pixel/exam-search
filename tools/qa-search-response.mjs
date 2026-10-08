import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const base=process.env.EXAM_SEARCH_URL||'http://127.0.0.1:8851/';
const root=new URL('../',import.meta.url),catalog=JSON.parse(await readFile(new URL('data/catalog.json',root))),rows=[];
const asset=async path=>readFile(new URL(path,root));
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/p1-search-*.json',async route=>{await gate;await route.fulfill({body:await asset(catalog.shards.p1.search.path),contentType:'application/json'});});
  await page.goto(`${base}?group=science&subject=p1&year=2025&month=11`);
  await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='검색 결과 20개');
  const oldIds=await page.locator('.result-card').evaluateAll(cards=>cards.map(c=>c.dataset.id));
  await page.locator('#keyword-input').fill('전자기파');
  await page.evaluate(()=>{
   window.blank=0;window.observer=new MutationObserver(()=>{if(!document.querySelector('.result-card'))window.blank++;});
   window.observer.observe(document.querySelector('#result-list'),{childList:true});document.querySelector('#search-form').requestSubmit();
  });
  await page.waitForFunction(()=>document.querySelector('#result-list').getAttribute('aria-busy')==='true');
  assert.deepEqual(await page.locator('.result-card').evaluateAll(cards=>cards.map(c=>c.dataset.id)),oldIds);
  assert.match(await page.locator('#result-count').textContent(),/이전 결과/);
  await page.locator('#keyword-input').fill('작성 중인 검색어');
  assert.equal(await page.locator('#keyword-input').inputValue(),'작성 중인 검색어');
  release();await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='검색 결과 1개');
  assert.equal(await page.evaluate(()=>window.blank),0);assert.equal(await page.locator('#keyword-input').inputValue(),'작성 중인 검색어');
  assert.equal(await page.locator('#result-list').getAttribute('aria-busy'),'false');
  const matched=await page.locator('.result-card').first().getAttribute('data-id');
  await page.route('**/b1-search-*.json',r=>r.fulfill({status:503,body:'retry'}));
  await page.locator('#subject-filter').selectOption('b1');await page.locator('#search-retry').waitFor();
  assert.equal(await page.locator('.result-card').first().getAttribute('data-id'),matched);
  assert.equal(await page.locator('#result-count').textContent(),'검색 실패 · 이전 결과');
  assert.equal(await page.locator('#keyword-input').inputValue(),'작성 중인 검색어');
  await page.unroute('**/b1-search-*.json');await page.locator('#search-retry').click();
  await page.waitForFunction(()=>document.querySelector('#search-readiness-text').textContent==='본문 검색 완료');
  rows.push({engine,scenario:'delayed search and failure',previousResultsRetained:true,blankFrames:0,draftPreserved:true,retry:true});
  await page.unrouteAll({behavior:'ignoreErrors'});await context.close();

  const fastContext=await browser.newContext(),fast=await fastContext.newPage();
  let releaseOld;const held=new Promise(resolve=>releaseOld=resolve);let blocked=0;
  const aborted=[];fast.on('requestfailed',r=>{if(/-search-/.test(r.url()))aborted.push(r.url());});
  await fast.route('**/data/browser/*-search-*.json',async route=>{
   if(!route.request().url().includes('/c1-search-')){blocked++;await held;}
   const path=new URL(route.request().url()).pathname.slice(1);
   await route.fulfill({body:await asset(path),contentType:'application/json'});
  });
  await fast.goto(base);await fast.locator('.landing-subject').first().waitFor();
  await fast.locator('#keyword-input').fill('전자기파');await fast.locator('#search-form').evaluate(f=>f.requestSubmit());
  await fast.waitForFunction(()=>document.querySelector('#search-readiness-text').textContent==='검색 중…');
  for(let n=0;n<100&&blocked<2;n++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(blocked,2,'whole-library downloads remain bounded');
  const start=Date.now();
  await fast.evaluate(()=>{const g=document.querySelector('#group-filter');g.value='science';g.dispatchEvent(new Event('change'));
   const s=document.querySelector('#subject-filter');s.value='c1';s.dispatchEvent(new Event('change'));});
  await fast.waitForFunction(()=>document.querySelector('#search-readiness-text').textContent==='본문 검색 완료',null,{timeout:3000});
  const latestMs=Date.now()-start;assert(latestMs<1000,`latest search waited for abandoned downloads: ${latestMs}`);
  assert.equal(await fast.locator('#subject-filter').inputValue(),'c1');
  const finalCount=await fast.locator('#result-count').textContent();releaseOld();await fast.waitForTimeout(150);
  assert.equal(await fast.locator('#result-count').textContent(),finalCount);assert(aborted.length>=1);
  rows.push({engine,scenario:'latest search bypasses held old downloads',blockedDownloads:blocked,abortedDownloads:aborted.length,latestMs,lateResponseIgnored:true});
  await fast.unrouteAll({behavior:'ignoreErrors'});await fastContext.close();
 }finally{await browser.close();}
}
await mkdir('_work/performance/ui',{recursive:true});
await writeFile('_work/performance/ui/search-response-results.json',JSON.stringify({passed:true,rows},null,2));console.log(JSON.stringify(rows,null,2));
