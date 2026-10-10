import { chromium } from 'playwright';
import {writeFile} from 'node:fs/promises';
const output=process.argv[2] || 'after';
const base=process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8851/';
const browser=await chromium.launch({headless:true});
const rows=[];
for(let run=0;run<5;run++) {
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 for(const visit of ['first','revisit']) {
  const page=await context.newPage();
  await page.addInitScript(()=>{
   window.measure={longTasks:[],sourceRequests:0};
   new PerformanceObserver(l=>window.measure.longTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
   const observer=new MutationObserver(()=>{
    if(!window.measure.interactive && document.querySelector('#group-filter')?.options.length>1) window.measure.interactive=performance.now();
    if(!window.measure.list && document.querySelectorAll('.result-card').length && /검색 결과/.test(document.querySelector('#result-count')?.textContent)) window.measure.list=performance.now();
   });observer.observe(document,{childList:true,subtree:true,attributes:true,characterData:true});
  });
  let originals=0;page.on('request',r=>{if(r.url().includes('5e-google-drive-gateway'))originals++;});
  await page.goto(`${base}?group=science&subject=p1&year=2025&month=11`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.measure.list,null,{timeout:90000});
  const ready=await page.evaluate(async()=>{
   const data=await import(document.documentElement.dataset.catalogReady ? './data.mjs?v=library-release-20261010-1' : './data.mjs');
   if(data.prepareSearch) await data.prepareSearch();
   else await data.getJson('/api/search?q=전자기파&group=science&subject=p1');
   return performance.now();
  });
  const interaction=await page.evaluate(async()=>{const start=performance.now(); const d=await import(document.documentElement.dataset.catalogReady ? './data.mjs?v=library-release-20261010-1' : './data.mjs');await d.getJson('/api/search?q=전자기파&group=science&subject=p1&yearFrom=2025&yearTo=2025');return performance.now()-start;});
  const before=await page.evaluate(()=>performance.now());
  await page.locator('.result-card').first().click();
  let source=null,sourceError='';
  try {await page.waitForFunction(()=>document.querySelector('#source-image')?.src.startsWith('blob:') && document.querySelector('#source-image')?.naturalWidth>0,null,{timeout:45000}); source=await page.evaluate(()=>performance.now());}catch(e){sourceError='original timeout';}
  const metrics=await page.evaluate(()=>({...window.measure,paint:performance.getEntriesByType('paint').map(e=>({name:e.name,time:e.startTime})),resources:performance.getEntriesByType('resource').filter(e=>/questions.json|pdf.mjs|editable-editor|files.json/.test(e.name)).map(e=>({name:e.name.split('/').at(-1),duration:e.duration,size:e.transferSize})),longTaskTotal:window.measure.longTasks.reduce((s,e)=>s+e.duration,0),longTaskMax:Math.max(0,...window.measure.longTasks.map(e=>e.duration))}));
  const row={run:run+1,visit,...metrics,fullSearch:ready,query:interaction,original:source?source-before:null,sourceError,originalRequests:originals};rows.push(row);console.log(JSON.stringify(row));
  await page.close();
 }
 await context.close();
}
await browser.close();
await writeFile(`_work/performance/${output}.json`,JSON.stringify({conditions:{browser:browser.version(),node:process.version,viewport:'1440x900',server:base,data:'real catalog, actual public gateway PDFs',revisit:'same browser context, new page',runs:5},rows},null,2));
