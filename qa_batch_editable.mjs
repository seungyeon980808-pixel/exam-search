import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import init, { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';
import { verifyExportRace } from './qa_export_race.mjs';

const base = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8770/';
const evidence = process.env.EVIDENCE_DIR || '.omo/evidence/multi-question-rhwp';
await mkdir(evidence, { recursive: true });
await init({ module_or_path: await readFile(new URL('./vendor/rhwp-studio/assets/rhwp_bg-PUGAA2uC.wasm', import.meta.url)) });
const browser = await chromium.launch({ headless: true });
const results = [];
const ids = ['p1_2027_06_06', 'p2_2018_06_06', 'p1_2027_06_18'];
async function open(page, selected = ids) {
  await page.evaluate((values) => { document.dispatchEvent(new CustomEvent('open-editable-collection', { detail: { ids: values } })); }, selected);
}
async function loaded(page) {
  await page.waitForFunction(() => !document.querySelector('#editable-download').disabled);
  await page.frameLocator('iframe').getByRole('textbox', { name: '문서 편집 입력' }).waitFor();
}
try {
  results.push(await verifyExportRace(browser, base, `${evidence}/export-race`));
  for (const width of [1280, 768, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
    page.setDefaultTimeout(60000);
    await page.goto(base);
    await page.locator('.result-card').first().waitFor();
    await open(page);
    await loaded(page);
    assert.equal(await page.locator('#editable-title').textContent(), '선택 문항 3개');
    await page.locator('#editable-sources summary').click();
    assert.deepEqual(await page.locator('#editable-items li').evaluateAll((rows) => rows.map((row) => row.dataset.id)), ids);
    for (const id of ids) {
      assert.match(await page.locator(`#editable-items li[data-id="${id}"] a`).last().getAttribute('href'), new RegExp(`${id}\\.webp$`));
      assert.match(await page.locator(`#editable-items li[data-id="${id}"] a`).first().getAttribute('href'), /#page=\d+$/u);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${evidence}/task-5-editor-${width}.png` });
    await page.locator('#editable-sources summary').click();
    if (width === 1280) {
      const input = page.frameLocator('iframe').getByRole('textbox', { name: '문서 편집 입력' });
      await input.press('g');
      const confirmation = page.waitForEvent('dialog');
      page.once('dialog', async (dialog) => { await dialog.dismiss(); });
      await page.locator('#editable-close').click();
      assert.match((await confirmation).message(), /내려받지 않은/u, 'dirty state is checked immediately before close');
      assert.equal(await page.locator('#editable-dialog').isVisible(), true);
      const event = page.waitForEvent('download');
      await page.locator('#editable-download').click();
      const download = await event;
      assert.match(download.suggestedFilename(), /^선택문항-3개-\d{8}-edited\.hwpx$/u);
      const path = `${evidence}/edited-collection.hwpx`;
      await download.saveAs(path);
      const doc = new HwpDocument(await readFile(path));
      try {
        const equations = JSON.parse(doc.getControls()).filter((control) => control.ctrlId === 'eqed');
        assert.ok(equations.length > 23);
        assert.match(doc.getTextRange(0, 0, 0, 200), /g/u);
        const xml = execFileSync('unzip', ['-p', path, 'Contents/section0.xml'], { encoding: 'utf8' });
        assert.ok(xml.indexOf('2027') < xml.indexOf('2018'));
        await writeFile(`${evidence}/editor-roundtrip.json`, JSON.stringify({ filename: download.suggestedFilename(), equations: equations.length, ids, editedText: doc.getTextRange(0, 0, 0, 200) }, null, 2));
      } finally { doc.free(); }
    }
    await page.locator('#editable-close').click();
    results.push(`${width}px: ordered three-question real rhwp, metadata links, no document overflow, screenshot captured`);
    await page.close();
  }
  const page = await browser.newPage({ acceptDownloads: true });
  page.setDefaultTimeout(60000);
  await page.goto(base);
  await page.locator('.result-card').first().waitFor();
  await open(page, [ids[0], 'not-a-question']);
  await page.locator('#editable-partial').waitFor();
  assert.equal(await page.locator('#editable-download').isDisabled(), true);
  await page.locator('#editable-retry').click();
  await page.locator('#editable-partial').waitFor();
  await page.screenshot({ path: `${evidence}/task-5-partial-error.png` });
  await page.locator('#editable-partial').click();
  await loaded(page);
  assert.match(await page.locator('#editable-items').textContent(), /문서에서 제외/u);
  assert.equal(await page.locator('#editable-retry').isHidden(), true);
  await page.locator('#editable-close').click();
  await open(page, ['not-a-question']);
  await page.locator('#editable-retry').waitFor();
  assert.equal(await page.locator('#editable-partial').isHidden(), true);
  assert.equal(await page.locator('#editable-download').isDisabled(), true);
  await page.locator('#editable-close').click();
  results.push('Partial failure: no automatic omission; retry; explicit subset; exclusion retained; all-error download disabled');
  await page.close();

  const delayed = await browser.newPage();
  delayed.setDefaultTimeout(60000);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let requested;
  const requestSeen = new Promise((resolve) => { requested = resolve; });
  await delayed.route('**/data/editable/prepared/p1_2027_06_06.json', async (route) => { requested(); await gate; await route.continue(); });
  await delayed.goto(base);
  await delayed.locator('.result-card').first().waitFor();
  await open(delayed, [ids[0]]);
  await requestSeen;
  await delayed.locator('#editable-close').click();
  await open(delayed, [ids[2]]);
  release();
  await loaded(delayed);
  assert.deepEqual(await delayed.locator('#editable-items li').evaluateAll((rows) => rows.map((row) => row.dataset.id)), [ids[2]]);
  results.push('Delayed prepared response: close cancels old session; immediate reopen loads only new selection');
  await delayed.screenshot({ path: `${evidence}/task-5-cancel-reopen.png` });
  await delayed.close();
  const recovery = await browser.newPage();
  recovery.setDefaultTimeout(60000);
  let attempts = 0;
  await recovery.route('**/data/editable/prepared/p1_2027_06_06.json', (route) => ++attempts === 1
    ? route.fulfill({ status: 503, body: 'temporary QA failure' }) : route.continue());
  await recovery.goto(base);
  await recovery.locator('.result-card').first().waitFor();
  await open(recovery, [ids[0], ids[2]]);
  await recovery.locator('#editable-retry').waitFor();
  await recovery.locator('#editable-retry').click();
  await loaded(recovery);
  assert.equal(attempts, 2);
  assert.equal(await recovery.locator('#editable-items li').count(), 2);
  results.push('Transient prepared-source 503: explicit retry succeeds and opens complete two-question collection');
  await recovery.close();

  const timeout = await browser.newPage();
  timeout.setDefaultTimeout(60000);
  await timeout.route('**/vendor/rhwp-editor/transport.js', async (route) => {
    const source = await readFile(new URL('./vendor/rhwp-editor/transport.js', import.meta.url), 'utf8');
    await route.fulfill({ contentType: 'text/javascript', body: source.replace('request(method, params = {}) {', `request(method, params = {}) {
      if (method === 'loadFile' && !window.__qaTimedOut) {
        window.__qaTimedOut = true;
        return new Promise((resolve, reject) => setTimeout(() => reject(new Error('Request timeout: loadFile')), 50));
      }`) });
  });
  await timeout.goto(base);
  await timeout.locator('.result-card').first().waitFor();
  await open(timeout, [ids[0]]);
  await timeout.locator('#editable-status').getByText('Request timeout: loadFile', { exact: true }).waitFor();
  assert.equal(await timeout.locator('#editable-host iframe').count(), 0);
  assert.equal(await timeout.locator('#editable-download').isDisabled(), true);
  await timeout.locator('#editable-close').click();
  await open(timeout, [ids[2]]);
  await loaded(timeout);
  assert.equal(await timeout.locator('#editable-host iframe').count(), 1);
  results.push('Injected bridge loadFile timeout: iframe destroyed, download disabled; next open creates one healthy editor');
  await timeout.close();

  const single = await browser.newPage({ acceptDownloads: true });
  single.setDefaultTimeout(60000);
  await single.goto(`${base}?subject=p1&year=2027&id=p1_2027_06_06`);
  await single.locator('#open-editable').click();
  await loaded(single);
  const singleDownload = single.waitForEvent('download');
  await single.locator('#editable-download').click();
  const singleFile = await singleDownload;
  assert.equal(singleFile.suggestedFilename(), 'p1_2027_06_06-edited.hwpx');
  await singleFile.saveAs(`${evidence}/single-regression.hwpx`);
  const singleDoc = new HwpDocument(await readFile(`${evidence}/single-regression.hwpx`));
  try { assert.equal(JSON.parse(singleDoc.getControls()).filter((control) => control.ctrlId === 'eqed').length, 7); }
  finally { singleDoc.free(); }
  results.push('Single prepared-question regression: original filename and all seven native equation controls preserved');
  await single.close();
  const draft = await browser.newPage();
  draft.setDefaultTimeout(60000);
  await draft.route('https://5e-google-drive-gateway.5e-desktop.workers.dev/**', (route) => route.abort());
  await draft.goto(base);
  await draft.locator('.result-card').first().waitFor();
  await open(draft, ['p1_2027_06_01']);
  await loaded(draft);
  assert.match(await draft.locator('#editable-status').textContent(), /색인 텍스트로 만든 편집 초안/u);
  assert.match(await draft.locator('#editable-items').textContent(), /색인 초안/u);
  await draft.locator('#editable-sources summary').click();
  await draft.screenshot({ path: `${evidence}/task-5-index-draft.png` });
  results.push('Injected PDF transport failure: safe index draft loads with persistent modal and per-item warnings');
  await draft.close();
  await writeFile(`${evidence}/task-5-editor.txt`, `Invocation: EXAM_SEARCH_URL=${base} npm run qa:batch\nPASS\n${results.join('\n')}\nArtifacts: task-5-editor-{1280,768,375}.png, task-5-partial-error.png, task-5-cancel-reopen.png, edited-collection.hwpx, editor-roundtrip.json\n`);
  console.log(results.join('\n'));
} finally { await browser.close(); }
