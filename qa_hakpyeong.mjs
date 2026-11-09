// OmO 작성. 로컬 검수 때만 미푸시 카드와 읽기 전용 PDF를 네트워크 경계에서 제공한다.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';
const root=fileURLToPath(new URL('./',import.meta.url));
const base=process.env.EXAM_SEARCH_URL||'http://127.0.0.1:18873/';
const output=process.env.EXAM_QA_OUTPUT;
if(!output)throw new Error('EXAM_QA_OUTPUT에 검사 산출물 폴더를 지정하세요.');
await mkdir(output,{recursive:true});
const catalog=JSON.parse(await readFile(new URL('data/hakpyeong/catalog.json',import.meta.url)));
const files=new Map(catalog.files.map(file=>[file.pdfFile,file]));
const rows=[];
for(const [engine,type] of Object.entries({chromium,webkit})) {
 const browser=await type.launch({headless:true});
 try {
  for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:1000}});
   const page=await context.newPage(),errors=[],requests=[];
   page.on('pageerror',error=>errors.push(error.message));
   page.on('request',request=>requests.push(request.url()));
   if(process.env.EXAM_LOCAL_CARDS==='1')await page.route('https://raw.githubusercontent.com/seungyeon980808-pixel/exam-search/main/cards/**',
    route=>route.fulfill({path:join(root,'cards',new URL(route.request().url()).pathname.split('/').at(-1)),contentType:'image/webp'}));
   if(process.env.EXAM_SHARED_ROOT)await page.route('https://5e-google-drive-gateway.5e-desktop.workers.dev/**',async route=>{
    const name=decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)),file=files.get(name);
    assert(file,`예상하지 않은 원본 요청: ${name}`);
    await route.fulfill({path:join(process.env.EXAM_SHARED_ROOT,file.publicPath),contentType:'application/pdf',headers:{'access-control-allow-origin':'*'}});
   });
   await page.goto(base);
   await page.waitForFunction(()=>document.documentElement.dataset.catalogReady==='true');
   assert(!requests.some(url=>url.includes('/data/hakpyeong/')),'첫 화면은 학평 자료를 읽지 않아야 합니다.');
   await page.goto(base+'?group=science&subject=p1&year=2027&month=3');
   await page.waitForFunction(()=>document.querySelector('#result-count')?.textContent==='검색 결과 20개');
   assert.equal(await page.locator('#month-filter').inputValue(),'3');
   assert.match(await page.locator('.result-meta').first().textContent(),/2027학년도 3월 학평/u);
   await page.waitForFunction(()=>[...document.querySelectorAll('.result-card img')].filter(i=>{
    const box=i.getBoundingClientRect();return box.width>0&&box.top<innerHeight;
   }).every(i=>i.complete&&i.naturalWidth>0));
   await page.locator('.result-card img').evaluateAll(images=>Promise.all(images.filter(i=>{
    const box=i.getBoundingClientRect();return box.width>0&&box.top<innerHeight;
   }).map(i=>i.decode())));
   for(const theme of ['light','dark']) {
    await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
    await page.screenshot({path:join(output,`hakpyeong-${engine}-${width}-${theme}.png`),animations:'disabled'});
   }
   if(width===390)await page.locator('#filter-toggle').click();
   await page.locator('#month-filter').focus();
   await page.screenshot({path:join(output,`hakpyeong-filter-${engine}-${width}.png`),animations:'disabled'});
   const control=await page.locator('#month-filter').evaluate(el=>{
    const box=el.getBoundingClientRect(),style=getComputedStyle(el);
    return {width:box.width,height:box.height,outline:style.outline,background:style.backgroundColor,color:style.color};
   });
   const start=performance.now();
   await page.locator('#month-filter').selectOption('hakpyeong');
   await page.waitForFunction(()=>document.querySelector('#result-count')?.textContent==='검색 결과 80개');
   const lazyBrowseMs=performance.now()-start;
   const metrics=await page.evaluate(async()=>{
    const data=await import('./data.mjs?v=imyong-20261109-1'),rows=[];
    for(const query of ['전자기파','파동','힘','에너지','전기']) {
     const start=performance.now(),value=await data.getJson(`/api/search?subject=p1&month=hakpyeong&q=${encodeURIComponent(query)}`);
     rows.push({query,ms:performance.now()-start,total:value.total});
    }
    const mixed=await data.getJson('/api/search?subject=p1&month=all&yearFrom=2027&yearTo=2027');
    const base=await data.getJson('/api/search?subject=p1&yearFrom=2027&yearTo=2027');
    const hp=await data.getJson('/api/search?subject=p1&month=hakpyeong&yearFrom=2027&yearTo=2027');
    return {rows,mixed:mixed.total,base:base.total,hp:hp.total};
   });
   assert.equal(metrics.mixed,metrics.base+metrics.hp);
   assert.equal(metrics.hp,80);
   // 원래 선택으로 돌아가 실제 상세 PDF와 시험지별 보기를 연다.
   if(width===390)await page.locator('#filter-toggle').click();
   await page.locator('#month-filter').selectOption('3');
   await page.waitForFunction(()=>document.querySelector('#result-count')?.textContent==='검색 결과 20개');
   await page.locator('.card-preview').first().click();
   await page.waitForFunction(()=>document.querySelector('#source-image')?.src.startsWith('blob:')&&document.querySelector('#source-image')?.naturalWidth>0);
   assert.match(decodeURIComponent(await page.locator('#open-pdf').getAttribute('href')),/학력평가\/물리1\/문제\/p1_2027_03.pdf#page=1/u);
   await page.screenshot({path:join(output,`hakpyeong-detail-${engine}-${width}.png`)});
   await page.locator('#mobile-back').click();
   // 기존 820px 이하 화면은 결과 단위 선택을 숨기므로 시험지 주소로 같은 흐름을 검수한다.
   if(width<=820)await page.goto(base+'?group=science&subject=p1&year=2027&month=3&mode=files');
   else await page.locator('#workspace-mode').selectOption('files');
   await page.waitForFunction(()=>document.querySelector('#result-count')?.textContent==='시험지 1개');
   assert.equal(await page.locator('.file-row').count(),1);
   await page.locator('.file-row img').first().evaluate(i=>i.decode());
   await page.screenshot({path:join(output,`hakpyeong-files-${engine}-${width}.png`)});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.goto(base+'?group=math&year=2025&month=all&track=calculus');
   await page.waitForFunction(()=>document.querySelector('#result-count')?.textContent.includes('검색 결과'));
   assert.equal(await page.locator('#track-filter').inputValue(),'calculus','모든 시험에서도 수학 선택과목을 유지해야 합니다.');
   assert.equal(await page.locator('#variant-filter').inputValue(),'odd');
   rows.push({engine,width,lazyBrowseMs,searches:metrics.rows,control,errors,
    hakpyeongRequests:requests.filter(url=>url.includes('/data/hakpyeong/')).length,
    rawCardRequests:requests.filter(url=>url.includes('raw.githubusercontent.com')).length});
   assert.deepEqual(errors,[]);
   await context.close();
  }
  const context=await browser.newContext(),page=await context.newPage();
  await page.route('**/data/hakpyeong/catalog.json',route=>route.fulfill({status:503,body:'검사 중 읽기 실패'}));
  await page.goto(base+'?group=science&subject=p1&month=hakpyeong');
  await page.locator('#search-retry').waitFor({state:'visible'});
  assert.equal(await page.locator('.result-card').count(),0);
  await page.unroute('**/data/hakpyeong/catalog.json');
  if(process.env.EXAM_LOCAL_CARDS==='1')await page.route('https://raw.githubusercontent.com/**',route=>route.fulfill({
   path:join(root,'cards',new URL(route.request().url()).pathname.split('/').at(-1)),contentType:'image/webp'}));
  await page.locator('#search-retry').click();
  await page.waitForFunction(()=>document.querySelector('#result-count')?.textContent==='검색 결과 1,600개');
  rows.push({engine,errorRetry:'통과'});
  await context.close();
 } finally {await browser.close();}
}
await writeFile(join(output,'hakpyeong-qa.json'),JSON.stringify({author:'OmO 작성',rows},null,2));
console.log(JSON.stringify({author:'OmO 작성',rows},null,2));
