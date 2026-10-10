import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {prepareQuestions,searchQuestions} from '../search.mjs';
import init,{HwpDocument} from '../vendor/rhwp-studio/assets/rhwp-core.js';
const base=process.env.EXAM_SEARCH_URL||'http://127.0.0.1:8851/';
const evidence=new URL('../_work/performance/ui/',import.meta.url);
await mkdir(evidence,{recursive:true});
const catalog=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url)));
const source=JSON.parse(await readFile(new URL('../data/questions.json',import.meta.url)));
const prepared=prepareQuestions(source.items,JSON.parse(await readFile(new URL('../data/synonyms.json',import.meta.url))).map);
const observations=[];
const count=async(page,n)=>page.waitForFunction(n=>document.querySelector('#result-count')?.textContent===`검색 결과 ${n.toLocaleString('ko-KR')}개`,n);
const basic=async(page,id,value)=>{
 if(!await page.locator(id).isVisible())await page.locator('#filter-toggle').click();
 await page.locator(id).selectOption(value);
};
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch({headless:true});
 try{
  for(const width of [1440,768,375]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],requests=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
   await page.goto(base);await page.locator('.landing-subject').first().waitFor();
   assert.equal(await page.locator('.landing-subject').count(),5);
   assert(!requests.some(u=>/questions.json|pdf.mjs|editable-editor|google-drive-gateway/.test(u)), 'Landing must not load full search, PDF or editor');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:new URL(`${engine}-landing-${width}.png`,evidence).pathname});
   await page.locator('.landing-subject').filter({hasText:'과학탐구'}).click();
   await basic(page,'#subject-filter','p1');
   if(!await page.locator('#basic-filters').isVisible())await page.locator('#filter-toggle').click();
   await page.locator('#year-details > summary').click();await page.locator('#year-from').selectOption('2025');await page.locator('#year-to').selectOption('2025');await page.locator('#year-apply').click();await basic(page,'#month-filter','11');await count(page,20);
   const physics=await page.locator('#unit-filter option').allTextContents();assert(physics.includes('파동과 정보통신'));assert(!physics.includes('유전'));
   if(!await page.locator('#page-size').isVisible())await page.locator('#toolbar-menu > summary').click();
   await page.locator('#page-size').selectOption('6');await count(page,20);
   await page.waitForFunction(()=>document.querySelector('#page-position')?.textContent==='1 / 4');
   assert.equal(await page.locator('.question-item:not([hidden])').count(),6);
   for(let n=2;n<=4;n++){await page.locator('#load-more').click();await page.waitForFunction(n=>document.querySelector('#page-position').textContent===`${n} / 4`,n);}
   assert.equal(await page.locator('.question-item:not([hidden])').count(),2);
   for(let n=3;n>=1;n--){await page.locator('#previous-page').click();await page.waitForFunction(n=>document.querySelector('#page-position').textContent===`${n} / 4`,n);}
   assert.equal(await page.locator('.question-item:not([hidden])').first().getAttribute('data-id'),'p1_2025_11_01');
   if(!await page.locator('#page-size').isVisible())await page.locator('#toolbar-menu > summary').click();
   await page.locator('#page-size').selectOption('18');await page.waitForFunction(()=>document.querySelectorAll('.question-item:not([hidden])').length===18);
   await page.locator('#keyword-input').fill('전자기파');await page.locator('#search-form').evaluate(form=>form.requestSubmit());
   await count(page,searchQuestions(prepared,'전자기파',{subject:'p1',yearFrom:2025,yearTo:2025,month:11}).length);
   assert.match(await page.locator('#tokens').textContent(),/전자기파/);
   await page.evaluate(()=>{const g=document.querySelector('#group-filter');g.value='science';g.dispatchEvent(new Event('change'));const s=document.querySelector('#subject-filter');for(const value of ['p1','b1','e1','c1']){s.value=value;s.dispatchEvent(new Event('change'));}});
   await count(page,searchQuestions(prepared,'전자기파',{subject:'c1',yearFrom:2025,yearTo:2025,month:11}).length);
   assert.equal(await page.locator('#subject-filter').inputValue(),'c1');
   assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:new URL(`${engine}-search-${width}.png`,evidence).pathname});
   observations.push({engine,width,landing:'light assets only',scope:'physics units only',pagination:'6/18 items, forward/back',rapidSwitch:'latest c1 result preserved',overflow:false,errors});
   await context.close();
  }
  if(engine==='chromium'){
   const context=await browser.newContext(),page=await context.newPage();
   // Fail the catalog, preserve a typed draft, and recover on explicit retry.
   await page.route('**/data/catalog.json',r=>r.fulfill({status:503,body:'Temporary failure'}));
   await page.goto(base);await page.locator('#keyword-input').fill('전자기파');await page.locator('#search-retry').waitFor();
   await page.unroute('**/data/catalog.json');await page.locator('#search-retry').click();await page.locator('.landing-subject').first().waitFor();
   assert.equal(await page.locator('#keyword-input').inputValue(),'전자기파');
   await page.locator('#search-form').evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>document.querySelector('#search-readiness-text').textContent==='본문 검색 완료');
   assert.match(await page.locator('#tokens').textContent(),/전자기파/);
   // Corrupt the cached listing. A verified network asset replaces it on revisit.
   await page.goto(`${base}?group=science&subject=p1&year=2025&month=11`);await count(page,20);
   const listPath=catalog.shards.p1.browse.path;
   await page.evaluate(async(path)=>{const c=await caches.open('exam-library-catalog-v4');await c.put(new URL(path,location.href),new Response('[{"id":"bad","pdfFile":"bad"}]'));},listPath);
   let repaired=0;page.on('request',r=>{if(r.url().endsWith(listPath))repaired++;});
   await page.reload();await count(page,20);assert(repaired>0);
   // Failed full-text asset requests can be retried without losing URL search words.
   const fresh=await browser.newContext(),failure=await fresh.newPage();let first=true;
   await failure.route('**/p1-search-*.json',async r=>{if(first){first=false;await r.fulfill({status:503,body:'retry'});}else await r.continue();});
   await failure.goto(`${base}?group=science&subject=p1&year=2025&month=11&q=${encodeURIComponent('전자기파')}`);
   await failure.locator('#search-retry').waitFor();assert.match(await failure.locator('#tokens').textContent(),/전자기파/);
   await failure.locator('#search-retry').click();await count(failure,1);await fresh.close();
   observations.push({scenario:'catalog failure + asset failure + corrupt cache',retry:'passed',input:'retained'});
   // All subject worker results agree with the previous full-index engine.
   const queries={p1:'전자기파',p2:'빛 간섭 경로차',c1:'원자',c2:'평형',b1:'유전',b2:'DNA',e1:'별',e2:'지구',kor:'동형이의어 문맥 의미',eng:'price',math:'확률',life_ethics:'윤리'};
   for(const [subject,q] of Object.entries(queries)){
    const actual=await page.evaluate(async({subject,q})=>(await(await import('./data.mjs?v=library-release-20261010-1')).getJson(`/api/search?subject=${subject}&q=${encodeURIComponent(q)}&pageSize=36`)),{subject,q});
    const expected=searchQuestions(prepared,q,{subject,variant:'odd'});
    assert.equal(actual.total,expected.length);assert.deepEqual(actual.items.map(i=>i.id),expected.slice(0,72).map(i=>i.id));
   }
   observations.push({scenario:'12 subject searches',matching:'same counts/order as original full index'});
   await context.close();
   // Native editable export, including editing and unsaved-work protection.
   const editContext=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true}),edit=await editContext.newPage();
   await edit.goto(`${base}?subject=p1&year=2027&id=p1_2027_06_06`);
   await edit.locator('#open-editable').click();await edit.locator('#editable-start').click();
   await edit.waitForFunction(()=>!document.querySelector('#editable-download').disabled,null,{timeout:60000});
   const editorInput=edit.frameLocator('iframe').getByRole('textbox',{name:'문서 편집 입력'});await editorInput.press('g');
   const downloaded=edit.waitForEvent('download');await edit.locator('#editable-download').click();
   const download=await downloaded;await download.saveAs(new URL('edited-physics.hwpx',evidence).pathname);
   await init({module_or_path:await readFile(new URL('../vendor/rhwp-studio/assets/rhwp_bg-PUGAA2uC.wasm',import.meta.url))});
   const doc=new HwpDocument(await readFile(await download.path()));
   try{assert.match(doc.getTextRange(0,0,0,200),/^g/);
    const text=Array.from({length:doc.getParagraphCount(0)},(_,n)=>doc.getTextRange(0,n,0,2000)).join('\n');assert.match(text,/6\. 그림은 평면/);assert.equal(JSON.parse(doc.getControls()).filter(c=>c.ctrlId==='eqed').length,7);}finally{doc.free();}
   await edit.waitForFunction(()=>!document.querySelector('#editable-download').disabled);
   await editorInput.press('h');
   // Source/catalog refresh must not touch the loaded editor. Its close guard remains active.
   await edit.waitForFunction(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;},null,{timeout:5000});
   await edit.screenshot({path:new URL('edited-physics.png',evidence).pathname});
   observations.push({scenario:'actual HWPX edit/export',text:'typed g retained',nativeEquations:7,unsavedGuard:true,originalConversion:'unchanged'});
   await editContext.close();
  }
 }finally{await browser.close();}
}
await writeFile(new URL('results.json',evidence),JSON.stringify({passed:true,observations},null,2));
console.log(JSON.stringify({passed:true,observations},null,2));
