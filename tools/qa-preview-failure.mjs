import {webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8813/';
const evidence=new URL('../_work/compact-toolbar/',import.meta.url);
await mkdir(evidence,{recursive:true});
const b=await webkit.launch();
try {
 const page=await b.newPage({viewport:{width:375,height:900}});
 await page.route(/\.pdf(?:\?|$)/,route=>route.abort());
 await page.goto(base+'?group=science&id=b1_2027_06_01');
 await page.waitForFunction(()=>document.querySelector('#source-note').textContent.includes('문항 미리보기입니다.'),null,{timeout:90000});
 assert(await page.locator('#source-image').evaluate(i=>i.complete&&i.naturalWidth>0));
 assert(!await page.locator('#source-image-link').evaluate(i=>i.classList.contains('is-loading')));
 assert(!await page.locator('body').innerText().then(t=>t.includes('Rendering cancelled')));
 await page.screenshot({path:new URL('pdf-failure-fallback.png',evidence).pathname});
 await page.locator('#mobile-back').click();
 await page.setViewportSize({width:1440,height:900});
 await page.locator('#preview-toggle:not([disabled])').click();
 assert.equal(await page.locator('#mobile-back svg').count(),1);
 console.log('PDF failure retains usable preview without technical error.');
}finally{await b.close();}
