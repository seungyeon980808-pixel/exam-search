import assert from 'node:assert/strict';
import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8794/';
const directPrivate = process.env.EXAM_QA_DIRECT_PRIVATE === '1';
const publicDrive = process.env.EXAM_QA_PUBLIC_DRIVE === '1';
const preview = process.env.EXAM_PREVIEW_OUTPUT;
const manifestPath = process.env.EXAM_STAGE_MANIFEST;
const evidence = process.env.EXAM_QA_EVIDENCE || '/private/tmp/exam-search-hierarchy-qa';
if (!preview || !manifestPath) throw new Error('EXAM_PREVIEW_OUTPUT과 EXAM_STAGE_MANIFEST가 필요합니다.');
const manifest = JSON.parse(await readFile(manifestPath));
const stageFiles = new Map(manifest.files.map((file) => [file.flatRelativePath, file]));
const indexed = JSON.parse(await readFile(path.join(preview, 'data/questions.json')));
const indexedFiles = JSON.parse(await readFile(path.join(preview, 'data/files.json')));
const expansionFiles = indexedFiles.filter((file) => file.sourceSha256);
assert.equal(expansionFiles.length, 401, 'new problem PDF count');
for (const file of expansionFiles) {
  const relative = file.publicPath.replace(/^기출문제\/기출확장_국영수사탐\//u, '');
  const source = stageFiles.get(relative);
  assert(source && source.kind === '문제지', `missing staged PDF: ${file.pdfFile}`);
  assert.equal(source.sha256, file.sourceSha256, file.pdfFile);
  assert.equal((await stat(path.join(manifest.root, relative))).size, source.bytes, file.pdfFile);
}
const samples = ['kor', 'eng', 'math', 'life_ethics'].map((subject) => {
  const item = indexed.items.find((entry) => entry.subject === subject && entry.year === 2026
    && entry.page && entry.box?.length === 4);
  assert(item, `missing ${subject} sample`);
  return item;
});
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
let servedPdfs = 0;
try {
  for (const width of [1280, 768, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', (error) => failures.push(`${width}px JS: ${error.message}`));
    if (!directPrivate && !publicDrive) await page.route('**/data/*.json', async (route) => {
      const name = path.basename(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: await readFile(path.join(preview, 'data', name)) });
    });
    if (!directPrivate && !publicDrive) await page.route('https://5e-google-drive-gateway.5e-desktop.workers.dev/**', async (route) => {
      const url = new URL(route.request().url());
      const relative = url.pathname.split('/public/')[1]?.split('/').map(decodeURIComponent).join('/');
      const record = stageFiles.get(relative);
      if (!record) return route.fulfill({ status: 404, body: 'Not in private stage' });
      servedPdfs += 1;
      return route.fulfill({ status: 200, contentType: 'application/pdf',
        headers: { 'access-control-allow-origin': '*' },
        body: await readFile(path.join(manifest.root, relative)) });
    });
    await page.goto(base);
    await page.waitForFunction(() => document.querySelectorAll('#group-filter option').length === 6);
    assert.deepEqual(await page.locator('#group-filter option').allTextContents(),
      ['전과목', '국어', '영어', '수학', '과학탐구', '사회탐구']);
    await page.locator('#group-filter').selectOption('science');
    assert.equal(await page.locator('#subject-filter option').count(), 9);
    await page.locator('#subject-filter').selectOption('p1');
    await page.locator('#group-filter').selectOption('social');
    assert.equal(await page.locator('#subject-filter').inputValue(), '');
    assert.equal(await page.locator('#subject-filter option').count(), 11);
    await page.locator('#subject-filter').selectOption('life_ethics');
    if (!await page.locator('#basic-filters').isVisible()) await page.locator('#filter-toggle').click();
    await page.locator('#year-details > summary').click();
    await page.locator('#year-from').selectOption('2026');
    await page.locator('#year-to').selectOption('2026');
    await page.locator('#year-apply').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.result-card:not([hidden])')]
      .slice(0, innerWidth >= 1000 ? 3 : innerWidth >= 600 ? 2 : 1).every((card) => {
        const image = card.querySelector('img');
        return image?.src.startsWith('blob:') && image.complete && image.naturalWidth > 0;
      }), { timeout: 30_000 });
    await page.screenshot({ path: path.join(evidence, `social-results-${width}.png`) });
    for (const sample of samples) {
      const group = sample.subject === 'life_ethics' ? 'social' : sample.subject;
      await page.goto(`${base}?group=${group}&subject=${sample.subject}&year=2026&id=${sample.id}`);
      await page.locator('#source-image').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('#source-image')?.src.startsWith('blob:'),
        { timeout: 30_000 });
      assert.equal(await page.locator('#group-filter').inputValue(), group);
      assert.equal(await page.locator('#subject-filter-control').evaluate((element) => !element.hidden), group === 'social');
      assert.equal(await page.locator('#detail-heading').innerText(), `${sample.subjectLabel} ${sample.no}번`);
      assert.match(await page.locator('#open-pdf').getAttribute('href'), /#page=\d+$/u);
      if (group === 'social') {
        assert.equal(await page.locator('#subject-filter').inputValue(), sample.subject);
        await page.screenshot({ path: path.join(evidence, `social-question-${width}.png`) });
      }
    }
    await page.goto(`${base}?group=social&subject=life_ethics&year=2026&mode=files`);
    await page.locator('.file-row .file-select').first().click();
    await page.waitForFunction(() => [...document.querySelectorAll('.file-page-canvas')]
      .some((canvas) => canvas.dataset.rendered === 'true'), { timeout: 30_000 });
    assert.ok(await page.locator('.file-page').count() > 1);
    await page.locator('#file-preview-pages').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction(() => document.querySelector('.file-page:last-child canvas')?.dataset.rendered === 'true',
      { timeout: 30_000 });
    await page.screenshot({ path: path.join(evidence, `social-file-${width}.png`) });
    const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('*')].filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 8).map((element) => `${element.tagName}.${element.className}`) }));
    assert.equal(overflow.document > overflow.width, false, `${width}px horizontal overflow: ${JSON.stringify(overflow)}`);
    await page.close();
  }
  if (!directPrivate && !publicDrive) assert.ok(servedPdfs >= 8, `expected private PDF loads, got ${servedPdfs}`);
  assert.deepEqual(failures, []);
  console.log(`4 new subjects × 3 viewports, original question PDF and file preview verified; ${publicDrive ? 'anonymous public Drive' : directPrivate ? 'direct private localhost' : `private PDF loads ${servedPdfs}`}`);
} finally {
  await browser.close();
}
