import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.EXAM_SEARCH_URL||'http://127.0.0.1:8851/';
const root=new URL('../',import.meta.url),evidence=new URL('_work/performance/ui/',root);
await mkdir(evidence,{recursive:true});
const catalog=JSON.parse(await readFile(new URL('data/catalog.json',root)));
const browser=await chromium.launch({headless:true}),rows=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:500}}),page=await context.newPage();
 let releaseSource;const sourceGate=new Promise(resolve=>releaseSource=resolve);
 await page.route('https://5e-google-drive-gateway.5e-desktop.workers.dev/**',async route=>{
  const response=await route.fetch({timeout:45000});await sourceGate;await route.fulfill({response});
 });
 await page.goto(`${base}?group=science&subject=p1&year=2025&month=11&view=split`);
 await page.waitForFunction(()=>document.querySelector('#detail-heading')?.textContent==='물리학Ⅰ 1번');
 await page.locator('.result-card[data-id="p1_2025_11_02"]').click();
 await page.waitForFunction(()=>document.querySelector('#detail-heading')?.textContent==='물리학Ⅰ 2번'&&document.querySelector('#source-image')?.naturalWidth>0);
 await page.locator('#open-viewer').click();await page.locator('#zoom-in').click();
 const zoom=await page.locator('#zoom-level').textContent();
 await page.locator('.detail-scroll').evaluate(e=>e.scrollTop=60);
 const scroll=await page.locator('.detail-scroll').evaluate(e=>({top:e.scrollTop,left:e.scrollLeft}));
 assert.equal(scroll.top,60);
 releaseSource();await page.waitForFunction(()=>document.querySelector('#source-image')?.src.startsWith('blob:')&&document.querySelector('#source-image')?.complete&&document.querySelector('#source-image')?.naturalWidth>0,null,{timeout:60000});
 assert.equal(await page.locator('#detail-heading').textContent(),'물리학Ⅰ 2번');
 assert.equal(await page.locator('#zoom-level').textContent(),zoom);
 const after=await page.locator('.detail-scroll').evaluate(e=>({top:e.scrollTop,left:e.scrollLeft}));assert.deepEqual(after,scroll);
 await page.locator('#close-viewer').click();await page.screenshot({path:new URL('source-replacement.png',evidence).pathname});
 rows.push({scenario:'late original after selection change',selected:'question 2',zoom,scroll,after,passed:true});
 await page.unrouteAll({behavior:'ignoreErrors'});await context.close();
 const switchContext=await browser.newContext({viewport:{width:1440,height:900}}),files=await switchContext.newPage();
 let releaseDownloads;const downloadGate=new Promise(resolve=>releaseDownloads=resolve);let begun=0;
 await files.route('https://5e-google-drive-gateway.5e-desktop.workers.dev/**',async route=>{
  begun++;await downloadGate;const response=await route.fetch({timeout:45000});await route.fulfill({response});
 });
 await files.goto(`${base}?group=science&subject=p1&mode=files`);
 await files.locator('.file-row').first().waitFor();
 const selected=await files.evaluate(async()=>{
  const rows=[...document.querySelectorAll('.file-row')].slice(0,8);
  for(const row of rows){row.querySelector('.file-select').click();await new Promise(resolve=>setTimeout(resolve,100));}
  return rows.at(-1).dataset.file;
 });
 const pendingDownloads=begun;
 assert(begun<=2,`Too many concurrent source downloads: ${begun}`);
 releaseDownloads();await files.waitForFunction(()=>[...document.querySelectorAll('.file-page-canvas')].some(c=>c.dataset.rendered==='true'),null,{timeout:60000});
 assert.equal(await files.locator('#file-preview-title').textContent(),selected);
 rows.push({scenario:'8 rapid file selections',pendingDownloads,limit:2,latestFile:selected,passed:true});
 await files.unrouteAll({behavior:'ignoreErrors'});await switchContext.close();
 const editContext=await browser.newContext(),edit=await editContext.newPage();
 await edit.goto(base);await edit.locator('.landing-subject').first().waitFor();
 let releaseCatalog;const catalogGate=new Promise(resolve=>releaseCatalog=resolve);
 await edit.route('**/data/catalog.json',async route=>{
  await catalogGate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...catalog,revision:'f'.repeat(64)})});
 });
 await edit.goto(`${base}?subject=p1&year=2027&id=p1_2027_06_06`);
 await edit.locator('#open-editable').click();await edit.locator('#editable-start').click();
 await edit.waitForFunction(()=>!document.querySelector('#editable-download').disabled,null,{timeout:60000});
 await edit.frameLocator('iframe').getByRole('textbox',{name:'문서 편집 입력'}).press('z');
 await edit.locator('#editable-zoom').fill('90');await edit.locator('#editable-zoom').press('Enter');
 releaseCatalog();await edit.locator('#catalog-update').waitFor();
 assert.equal(await edit.locator('#editable-dialog').isVisible(),true);
 assert.equal(await edit.locator('#editable-zoom').inputValue(),'90');
 await edit.waitForFunction(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;},null,{timeout:5000});
 assert.equal(await edit.locator('#detail-heading').textContent(),'물리학Ⅰ 6번');
 rows.push({scenario:'changed catalog during real editing',reloadOffered:true,editorPreserved:true,zoom:90,unsavedGuard:true,passed:true});
 await edit.unrouteAll({behavior:'ignoreErrors'});await editContext.close();
 // Storage denial is a supported fallback, not a startup failure.
 const noStorage=await browser.newContext(),plain=await noStorage.newPage();
 await plain.addInitScript(()=>Object.defineProperty(globalThis,'caches',{get(){throw new Error('Storage denied');}}));
 await plain.goto(`${base}?group=science&subject=p1&year=2025&month=11`);
 await plain.waitForFunction(()=>document.querySelector('#result-count')?.textContent==='검색 결과 20개');
 rows.push({scenario:'persistent cache unavailable',networkFallback:true,passed:true});await noStorage.close();
 await writeFile(new URL('state-results.json',evidence),JSON.stringify({passed:true,rows},null,2));console.log(JSON.stringify(rows,null,2));
}finally{await browser.close();}
