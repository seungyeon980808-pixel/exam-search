import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { searchQuestions } from '../search.mjs';

const base = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8813/';
const evidence = new URL('../_work/toolbar-20261009/', import.meta.url);
await mkdir(evidence, {recursive:true});
const source = JSON.parse(await readFile(new URL('../data/questions.json', import.meta.url))).items;
const results = [];
let maximumShiftPx = 0;
const done = page => page.waitForFunction(() => document.querySelector('#result-list').getAttribute('aria-busy') === 'false');
const boxes = page => page.evaluate(() => Object.fromEntries(['.topbar', '.search-form', '.search-box', '#search-form > button', '#year-details > summary', '#unit-details > summary', '#framework-details > summary', '#standard-details > summary', '#workspace-mode'].map(selector => {
  const r = document.querySelector(selector).getBoundingClientRect();
  return [selector, {x:r.x,y:r.y,width:r.width,height:r.height}];
})));
function stable(before, after, message, visibleToolbarOnly = false) {
  for (const selector of Object.keys(before).filter(selector => !visibleToolbarOnly || !selector.includes('-details'))) for (const key of ['x','y','width','height']) {
    const shift = Math.abs(before[selector][key]-after[selector][key]);
    maximumShiftPx = Math.max(maximumShiftPx, shift);
    assert(shift<0.1, `${message}: ${selector} ${key} moved ${shift}px`);
  }
}
async function scopePanel(page) {
  if (!await page.locator('#basic-filters').isVisible()) await page.locator('#filter-toggle').click();
}
async function yearPanel(page) {
  await scopePanel(page);
  if (!await page.locator('#year-from').isVisible()) await page.locator('#year-details > summary').click();
}
async function count(page, expected) {
  await page.waitForFunction(expected => document.querySelector('#result-count').textContent === `검색 결과 ${expected.toLocaleString('ko-KR')}개`, expected);
  await done(page);
}
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  maximumShiftPx = 0;
  const browser = await type.launch();
  try {
    const context = await browser.newContext({viewport:{width:1440,height:960}}), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}?group=science&subject=p1&year=2025&month=11`);
    await count(page, 20);
    assert.equal(await page.locator('#year-from').inputValue(), '2025');
    assert.equal(await page.locator('#year-to').inputValue(), '2025');
    assert.match(page.url(), /yearFrom=2025&yearTo=2025/);
    const initial = await boxes(page), button = page.locator('#search-form > button'), b = await button.boundingBox();
    const releasedColor = await button.evaluate(e=>getComputedStyle(e).backgroundColor);
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2); await page.mouse.down();
    assert.notEqual(await button.evaluate(e=>getComputedStyle(e).backgroundColor), releasedColor, 'immediate press feedback');
    stable(initial, await boxes(page), 'pointer down');
    await page.waitForTimeout(170); stable(initial, await boxes(page), 'held press');
    await page.mouse.up(); await done(page);

    await page.locator('#keyword-input').fill('작성 중인 검색어');
    await yearPanel(page); stable(initial, await boxes(page), 'opening range menu');
    const oldUrl = page.url();
    await page.evaluate(() => {
      window.toolbarBusy = [];
      new MutationObserver(records => window.toolbarBusy.push(...records.map(record=>record.oldValue))).observe(document.querySelector('#result-list'), {attributes:true, attributeFilter:['aria-busy'], attributeOldValue:true});
    });
    await page.locator('#year-from').selectOption('2025'); await page.locator('#year-to').selectOption('2024');
    assert(await page.locator('#year-apply').isDisabled());
    assert.match(await page.locator('#year-error').textContent(), /시작 학년도/);
    assert.equal(page.url(), oldUrl); assert.deepEqual(await page.evaluate(()=>window.toolbarBusy), []);
    await page.locator('#year-from').selectOption('2024'); await page.locator('#year-to').selectOption('2025');
    await page.locator('#year-apply').click();
    const expected = searchQuestions(source, '', {subject:'p1', yearFrom:2024,yearTo:2025,month:11}).length;
    await count(page, expected);
    assert.equal(await page.locator('#keyword-input').inputValue(), '작성 중인 검색어');
    assert.equal((await page.evaluate(()=>window.toolbarBusy)).filter(old=>old==='false').length, 1, 'one search at apply');
    stable(initial, await boxes(page), 'committed year range');
    assert.equal(await page.locator('#year-summary').textContent(), '2024–2025');
    await page.reload(); await count(page, expected);
    assert.equal(await page.locator('#year-from').inputValue(), '2024'); assert.equal(await page.locator('#year-to').inputValue(), '2025');
    await yearPanel(page); await page.locator('#year-from').selectOption('2021');
    await page.locator('#toolbar-menu > summary').click();
    await yearPanel(page); assert.equal(await page.locator('#year-from').inputValue(), '2024', 'cancelled draft is discarded');
    await page.keyboard.press('Escape');

    for (const [id, filter] of [['framework','framework'], ['unit','unit'], ['standard','standard']]) {
      const before = await boxes(page);
      await page.locator(`#${id}-details > summary`).click();
      const options = await page.locator(`#${filter}-filter option`).evaluateAll(options=>options.filter(option=>option.value).map(option=>({value:option.value,text:option.textContent})));
      assert(options.length, `${id} has scoped values`);
      const longest = options.sort((a,b)=>b.text.length-a.text.length)[0];
      await page.locator(`#${filter}-filter`).selectOption(longest.value); await done(page);
      stable(before, await boxes(page), `selected ${id}`);
      assert.match(await page.locator(`#${id}-details > summary`).getAttribute('title'), new RegExp(longest.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
      assert((await page.locator('#applied-filters').textContent()).includes(longest.text));
      await page.keyboard.press('Escape');
    }
    assert(await page.evaluate(()=>['framework-details','unit-details','standard-details'].every(id=>document.getElementById(id).getBoundingClientRect().right<=document.querySelector('.search-form').getBoundingClientRect().left)));
    assert(await page.evaluate(()=>document.getElementById('standard-details').compareDocumentPosition(document.getElementById('keyword-input')) & Node.DOCUMENT_POSITION_FOLLOWING));
    results.push({engine, scenario:'range and stable toolbar', legacy:true, rangeCount:expected, draftSearches:0, applySearches:1, maximumShiftPx, scopedFacets:true});
    await page.screenshot({path:new URL(`${engine}-desktop.png`,evidence).pathname});

    await page.goto(`${base}?group=science&subject=p1&yearFrom=2024&yearTo=2025&month=11`); await count(page,expected);
    await page.locator('.card-preview').first().click(); await page.waitForFunction(()=>document.querySelector('.app-shell').classList.contains('is-detail'));
    await page.goBack(); await count(page,expected); assert.equal(await page.locator('#year-summary').textContent(), '2024–2025');
    await page.goForward(); await page.waitForFunction(()=>document.querySelector('.app-shell').classList.contains('is-detail'));
    assert.equal(await page.locator('#year-summary').textContent(), '2024–2025');
    results.push({engine, scenario:'range history', back:true,forward:true});

    for (const width of [320,375,768,1280,1440,1920]) {
      await page.setViewportSize({width,height:960});
      await page.goto(`${base}?group=math&yearFrom=2024&yearTo=2025&month=11&track=calculus&variant=odd`); await done(page);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), `${width}px overflow`);
      if (width <= 1360) {
        const before = await boxes(page); await scopePanel(page); stable(before, await boxes(page), 'scope opens', true);
        await yearPanel(page);
        assert(await page.locator('#year-from').isVisible()); assert(await page.locator('#year-to').isVisible());
        assert(await page.evaluate(()=>document.querySelector('#year-to').getBoundingClientRect().right<=innerWidth), 'range fits viewport');
        await page.locator('#year-apply').click();
        assert(await page.locator('#filter-toggle').evaluate(e=>e===document.activeElement), 'apply restores focus to a visible control');
        assert.equal(await page.locator('#filter-toggle').getAttribute('aria-expanded'), 'false');
        await yearPanel(page);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#filter-toggle').getAttribute('aria-expanded'), 'false');
      }
      const filter = page.locator('#filter-toggle');
      if (await filter.isVisible()) assert((await filter.boundingBox()).x<(await page.locator('.search-form').boundingBox()).x);
      await page.screenshot({path:new URL(`${engine}-${width}.png`,evidence).pathname});
      results.push({engine,width,scenario:'responsive math controls',overflow:false});
    }
    await page.setViewportSize({width:1440,height:960});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(`${base}?group=science&subject=p1&yearFrom=2024&yearTo=2025&month=11`); await done(page);
    await yearPanel(page);
    assert.equal(await page.locator('.year-panel').evaluate(e=>getComputedStyle(e).animationName), 'none');
    await page.keyboard.press('Escape');
    for (let i=0;i<10;i++) { await page.locator('#year-details > summary').click(); await page.locator('#year-details > summary').click(); }
    assert(!await page.locator('#year-details').evaluate(e=>e.open));
    const sourceWarnings = errors.filter(error => /google-drive-gateway.*due to access control checks/u.test(error));
    const unexpectedErrors = errors.filter(error => !sourceWarnings.includes(error));
    assert.deepEqual(unexpectedErrors, []);
    assert(await page.locator('.result-card img').first().isVisible(), 'prebuilt cards remain usable');
    results.push({engine,scenario:'reduced motion and repeated clicks',reducedMotion:true,unblocked:true,maximumShiftPx,errors:unexpectedErrors,sourceWarnings});
    await context.close();
  } finally { await browser.close(); }
}
await writeFile(new URL('results.json', evidence),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
