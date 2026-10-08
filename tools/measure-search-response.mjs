import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const name=process.argv[2]||'after';
const typing=process.argv[3]==='typing';
const base=process.env.EXAM_SEARCH_URL||'http://127.0.0.1:8851/';
const browser=await chromium.launch({headless:true}),rows=[];
await mkdir('_work/performance',{recursive:true});
try{
 for(const scope of ['subject','all'])for(let run=1;run<=5;run++){
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  for(const visit of ['first','revisit']){
   const page=await context.newPage();let bytes=0;
   page.on('response',r=>{if(/\/data\/browser\//.test(r.url()))bytes+=Number(r.headers()['content-length'])||0;});
   await page.goto(base+(scope==='subject'?'?group=science&subject=p1&year=2025&month=11':''));
   await page.waitForFunction(()=>document.documentElement.dataset.catalogReady==='true');
   if(scope==='subject')await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='검색 결과 20개');
   if(typing)await page.locator('#keyword-input').pressSequentially('전자기파',{delay:150});
   else await page.locator('#keyword-input').fill('전자기파');
   await page.evaluate(()=>{
    window.responseMeasure={start:performance.now(),blank:0,oldCount:document.querySelectorAll('.result-card').length};
    window.blankObserver=new MutationObserver(()=>{
     if(window.responseMeasure.oldCount&&!document.querySelector('.result-card'))window.responseMeasure.blank++;
    });window.blankObserver.observe(document.querySelector('#result-list'),{childList:true});
    document.querySelector('#search-form').requestSubmit();
   });
   await page.waitForFunction(()=>document.querySelector('#search-readiness-text').textContent==='본문 검색 완료',null,{timeout:15000});
   const result=await page.evaluate(()=>{window.blankObserver.disconnect();return{elapsed:performance.now()-window.responseMeasure.start,blankFrames:window.responseMeasure.blank,count:document.querySelector('#result-count').textContent};});
   rows.push({scope,run,visit,...result,assetBytes:bytes});await page.close();
  }await context.close();
 }
 const report={conditions:{browser:browser.version(),viewport:'1440x900',base,runs:5,keyword:'전자기파',typing:typing?'150ms per character':'fill then immediate submit',revisit:'new page, same browser context'},rows};
 await writeFile(`_work/performance/search-${name}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
