import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const phase = process.argv[2] || 'after';
const base = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8813/';
const browser = await chromium.launch({ headless: true });
const rows = [];
const scenes = { science: 'group=science&subject=p1&year=2025&month=11', social: 'group=social&year=2026&month=11' };
try {
 for (const [scene, query] of Object.entries(scenes)) {
  for (let run=1; run<=5; run++) {
   const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
   for (const visit of ['first','revisit']) {
    const page = await context.newPage();
    let originalRequests=0, imageRequests=0;
    const errors=[],failures=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('requestfailed',r=>failures.push({url:r.url(),reason:r.failure()?.errorText}));
    page.on('request', r => { if (r.url().includes('google-drive-gateway')) originalRequests++; if (/\.(webp|png)(\?|$)/.test(r.url())) imageRequests++; });
    await page.addInitScript(() => {
     window.imageMeasure={};
     const tick=() => {
      const m=window.imageMeasure;
      if (!m.shell && document.querySelector('#keyword-input')) m.shell=performance.now();
      const cards=[...document.querySelectorAll('.question-item:not([hidden]) .result-card')];
      if (!m.list && cards.length && document.querySelector('#result-list').getAttribute('aria-busy')==='false') m.list=performance.now();
      const visible=cards.filter(c=>{const r=c.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;});
      const loaded=visible.filter(c=>{const img=c.querySelector('img');return img?.naturalWidth>0&&!img.hidden&&!c.querySelector('.result-preview').classList.contains('is-loading');});
      if (!m.firstImage && loaded.length) m.firstImage=performance.now();
      if (!m.visibleImages && visible.length && loaded.length===visible.length) {m.visibleImages=performance.now();m.visibleCount=visible.length;}
      requestAnimationFrame(tick);
     };requestAnimationFrame(tick);
    });
    await page.goto(base+'?'+query+'&pageSize=36',{waitUntil:'domcontentloaded'});
    try {await page.waitForFunction(()=>window.imageMeasure.list);}
    catch(error) {
     const state=await page.evaluate(()=>({measure:window.imageMeasure,count:document.querySelector('#result-count')?.textContent,
      help:document.querySelector('#search-help')?.textContent,readiness:document.querySelector('#search-readiness')?.textContent,
      cards:document.querySelectorAll('.question-item').length,busy:document.querySelector('#result-list')?.getAttribute('aria-busy')}));
     await mkdir('_work/image-performance',{recursive:true});
     await writeFile(`_work/image-performance/${phase}-failure.json`,JSON.stringify({scene,run,visit,state,errors,failures},null,2));
     throw error;
    }
    let timeout=false;
    try { await page.waitForFunction(()=>window.imageMeasure.visibleImages,null,{timeout:15000}); } catch {timeout=true;}
    const metrics=await page.evaluate(()=>({...window.imageMeasure,visibleLoaded:[...document.querySelectorAll('.question-item:not([hidden]) .result-card')].filter(c=>{const r=c.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0&&c.querySelector('img')?.naturalWidth>0;}).length,longTasks:performance.getEntriesByType('longtask').length,imageBytes:performance.getEntriesByType('resource').filter(r=>/\.(webp|png)(\?|$)/.test(r.name)).reduce((n,r)=>n+r.transferSize,0)}));
    const row={scene,run,visit,...metrics,timeout,originalRequests,imageRequests};rows.push(row);console.log(JSON.stringify(row));
    await page.close();
   }
   await context.close();
  }
 }
} finally {await browser.close();}
const summary=[];
for (const scene of Object.keys(scenes)) for(const visit of ['first','revisit']) {
 const group=rows.filter(r=>r.scene===scene&&r.visit===visit),metric={};
 for(const key of ['shell','list','firstImage','visibleImages']) {const v=group.map(r=>r[key]).filter(Number.isFinite).sort((a,b)=>a-b);metric[key]=v.length?{median:v[Math.floor(v.length/2)],max:v.at(-1),completed:v.length}:null;}
 summary.push({scene,visit,...metric,timeouts:group.filter(r=>r.timeout).length,originalRequests:group.reduce((n,r)=>n+r.originalRequests,0)});
}
await mkdir('_work/image-performance',{recursive:true});
await writeFile(`_work/image-performance/${phase}.json`,JSON.stringify({conditions:{base,browser:browser.version(),viewport:'1440x900',runs:5,timeout:15000,network:'Actual local server and public PDF gateway; no throttling or stub; revisit same context/new page'},rows,summary},null,2));
console.log(JSON.stringify({phase,summary}));
