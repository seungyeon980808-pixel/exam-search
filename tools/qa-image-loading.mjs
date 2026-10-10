import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const sourceRoot=process.env.EXAM_SOURCE_ROOT;
if(!sourceRoot)throw new Error('Set EXAM_SOURCE_ROOT to the retained local PDF folder for original-quality checks.');
const base=process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8813/';
const evidence=new URL('../_work/image-performance/ui/',import.meta.url);
await mkdir(evidence,{recursive:true});
const rows=[];
const done=page=>page.waitForFunction(()=>document.querySelector('#result-list')?.getAttribute('aria-busy')==='false');
const loaded=page=>page.waitForFunction(()=>{
 const cards=[...document.querySelectorAll('.question-item:not([hidden]) .result-card')];
 const visible=cards.filter(c=>{const r=c.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;});
 return visible.length&&visible.every(c=>c.querySelector('img').naturalWidth>0&&!c.querySelector('.result-preview').classList.contains('is-loading'));
});
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]) {
 const browser=await type.launch({headless:true});
 try {
  for(const width of [1440,375]) {
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
   let original=0;const errors=[];
   page.on('request',r=>{if(r.url().includes('google-drive-gateway'))original++;});
   page.on('pageerror',e=>errors.push(e.message));
   await page.route(/google-drive-gateway/u,r=>r.abort());
   for(const scene of ['group=science&subject=p1&year=2025&month=11','group=social&year=2026&month=11',
     'group=math&subject=math&year=2025&month=11','group=kor&subject=kor&year=2025&month=11','group=eng&subject=eng&year=2025&month=11']) {
    await page.goto(base+'?'+scene+'&pageSize=36');await done(page);await loaded(page);
    const state=await page.locator('#result-list').evaluate(list=>{
     const cards=[...list.querySelectorAll('.question-item:not([hidden])')];
     const visible=cards.filter(c=>{const r=c.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;});
     return {count:cards.length,requested:cards.filter(c=>c.querySelector('img').hasAttribute('src')).length,
      visible:visible.length,allDimensions:cards.every(c=>c.querySelector('img').width>0&&c.querySelector('img').height>0),
      high:visible.filter(c=>c.querySelector('img').fetchPriority==='high').length};
    });
    assert(state.visible>0);assert(state.allDimensions);assert(state.requested<state.count,`${engine}/${width}/${scene}: off-screen images must stay deferred (${state.requested}/${state.count})`);
    assert.equal(original,0,'listing does not need a PDF download, including non-science subjects');
    const card=page.locator('.question-item:not([hidden]) .result-card').first();
    await card.locator('img').click();assert.equal(await card.getAttribute('aria-pressed'),'true');
    await card.locator('img').click();assert.equal(await card.getAttribute('aria-pressed'),'false');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    rows.push({engine,width,scene,...state,originalRequests:original,selectionWorks:true});
   }
   await page.screenshot({path:new URL(`${engine}-${width}.png`,evidence).pathname});
   // Scrolling loads the next visible group without fetching the whole result page.
   await page.locator('.question-item:not([hidden])').nth(20).scrollIntoViewIfNeeded();await loaded(page);
   assert.equal(original,0);assert.deepEqual(errors,[]);
   await page.goto(base+'?group=social&year=2026&month=11&mode=files');await done(page);
   await page.waitForFunction(()=>{
    const visible=[...document.querySelectorAll('.file-row')].filter(e=>{const r=e.getBoundingClientRect();return !e.closest('[hidden]')&&r.bottom>0&&r.top<innerHeight;});
    return visible.length&&visible.every(e=>e.querySelector('img').naturalWidth>0);
   });
   assert.equal(original,0);rows.push({engine,width,scene:'files',staticThumbnails:true,originalRequests:0});
   await context.close();
  }
  // Slow images: reserve their exact final geometry, cancel stale selection work.
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  let unblock;const gate=new Promise(resolve=>unblock=resolve);
  await page.route('**/*.webp',async r=>{await gate;await r.continue().catch(()=>{});});
  await page.goto(base+'?group=social&year=2026&month=11&pageSize=36',{waitUntil:'domcontentloaded'});await done(page);
  const before=await page.locator('.question-item').evaluateAll(es=>es.slice(0,6).map(e=>e.getBoundingClientRect().height));
  const queued=await page.locator('.question-item img[src]').count();assert(queued<=4,'static image concurrency stays bounded');
  const card=page.locator('.result-card').first();
  await card.click({position:{x:8,y:20}});
  assert.equal(await card.getAttribute('aria-pressed'),'true','selection works while display images wait');
  await page.locator('.question-item:not([hidden])').nth(20).scrollIntoViewIfNeeded();
  await card.scrollIntoViewIfNeeded();
  unblock();await loaded(page);
  const after=await page.locator('.question-item').evaluateAll(es=>es.slice(0,6).map(e=>e.getBoundingClientRect().height));
  assert.deepEqual(after,before,'loading images must not move cards');
  rows.push({engine,scene:'delayed display',concurrency:queued,stableGeometry:true,rapidScrollReturns:true});
  await page.locator('#subject-filter').selectOption('life_ethics');await done(page);await loaded(page);
  assert((await page.locator('.result-meta').allTextContents()).every(t=>t.includes('생활과 윤리')));
  rows.push({engine,scene:'rapid filter',correctCurrentResults:true});
  await context.close();
  const switching=await browser.newContext({viewport:{width:1440,height:900}}),s=await switching.newPage();
  let releaseOld;const oldGate=new Promise(resolve=>releaseOld=resolve);
  await s.route('**/*.webp',async r=>{await oldGate;await r.continue().catch(()=>{});});
  await s.goto(base+'?group=social&year=2026&month=11&pageSize=36',{waitUntil:'domcontentloaded'});await done(s);
  await s.waitForFunction(()=>document.querySelector('.question-item img[src]'));
  await s.locator('#subject-filter').selectOption('life_ethics');await done(s);
  const current=await s.locator('.result-meta').allTextContents();
  assert(current.length&&current.every(t=>t.includes('생활과 윤리')));
  releaseOld();await loaded(s);
  assert.deepEqual(await s.locator('.result-meta').allTextContents(),current,'late old images cannot replace current results');
  assert((await s.locator('.question-item:not([hidden]) img[src]').evaluateAll(es=>es.map(e=>e.src))).every(src=>src.includes('life_ethics')));
  rows.push({engine,scene:'switch before old images finish',lateResponsesIgnored:true});
  await switching.close();
  // A damaged static image falls back to the real, unchanged original PDF renderer.
  const fallback=await browser.newContext({viewport:{width:1440,height:900}}),p=await fallback.newPage();
  await p.route('**/cards/p1_2025_11_01.webp',r=>r.fulfill({status:404,body:'missing preview'}));
  let localOriginalRequests=0;
  await p.route(/google-drive-gateway/u,async r=>{localOriginalRequests++;await r.fulfill({status:200,contentType:'application/pdf',body:await readFile(join(sourceRoot,'pdfs','p1_2025_11.pdf'))});});
  await p.goto(base+'?group=science&subject=p1&year=2025&month=11&pageSize=6');await done(p);
  await p.waitForFunction(()=>{const img=document.querySelector('.question-item img');return img?.src.startsWith('blob:')&&img.naturalWidth>0;});
  const preview=await p.locator('.question-item img').first().getAttribute('src');assert(preview.startsWith('blob:'));
  await p.locator('.card-preview').first().click();
  await p.waitForFunction(()=>document.querySelector('#source-image')?.src.startsWith('blob:')&&document.querySelector('#source-image').naturalWidth>900);
  assert(localOriginalRequests>0,'fallback is tested using the actual retained PDF');
  rows.push({engine,scene:'fallback and original',missingAssetFallback:true,highResolutionOriginal:true});
  await fallback.close();
  const failed=await browser.newContext({viewport:{width:1440,height:900}}),f=await failed.newPage();
  await f.route('**/cards/p1_2025_11_01.webp',r=>r.fulfill({status:404,body:'missing preview'}));
  let unavailableOriginalRequests=0;
  let releaseFailure,sourceRequested;
  const failureGate=new Promise(resolve=>releaseFailure=resolve),requested=new Promise(resolve=>sourceRequested=resolve);
  await f.route(/google-drive-gateway/u,async r=>{unavailableOriginalRequests++;sourceRequested();await failureGate;await r.fulfill({status:404,body:'missing PDF'});});
  await f.goto(base+'?group=science&subject=p1&year=2025&month=11&pageSize=6');await done(f);
  await requested;
  const pendingHeight=await f.locator('.question-item .result-preview').first().evaluate(e=>e.getBoundingClientRect().height);
  releaseFailure();
  await f.locator('.question-item .result-preview.is-error').first().waitFor();
  const height=await f.locator('.question-item .result-preview').first().evaluate(e=>e.getBoundingClientRect().height);
  assert(height>200,'a failed preview retains its paper geometry and visible error message');
  assert.equal(height,pendingHeight,'failure must not move the reserved image frame');
  await f.locator('.result-card').first().click({position:{x:8,y:20}});
  assert.equal(await f.locator('.result-card').first().getAttribute('aria-pressed'),'true');
  assert.equal(unavailableOriginalRequests,1,'a missing PDF is actually blocked and does not retry');
  rows.push({engine,scene:'unavailable source',visibleError:true,selectionPreserved:true,height});
  await failed.close();
 } finally {await browser.close();}
}
await writeFile(new URL('results.json',evidence),JSON.stringify({passed:true,rows},null,2));
console.log(JSON.stringify({passed:true,rows},null,2));
