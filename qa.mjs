import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8768/';
const pdfDirectory = process.env.EXAM_PDF_DIR;
const evidence = '/tmp/exam-search-qa';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const sourceFiles = JSON.parse(await readFile(new URL('./data/files.json', import.meta.url)));
const pdfByPath = new Map(sourceFiles.map((file) => [file.publicPath, file.pdfFile]));
const driveLoads = [];

try {
  for (const width of [1280, 768, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    if (pdfDirectory) {
      await page.route('https://5e-google-drive-gateway.5e-desktop.workers.dev/**', async (route) => {
        const publicPath = new URL(route.request().url()).pathname.split('/public/')[1]
          ?.split('/').map(decodeURIComponent).join('/');
        const name = pdfByPath.get(publicPath);
        if (!name) return route.fulfill({ status: 404, body: 'Unknown public file' });
        const body = await readFile(join(pdfDirectory, name));
        return route.fulfill({ status: 200, contentType: 'application/pdf', body,
          headers: { 'access-control-allow-origin': '*' } });
      });
    }
    page.on('pageerror', (error) => failures.push(`${width}px JS: ${error.message}`));
    page.on('request', (request) => {
      if (request.url().includes('/pdfs/')) failures.push(`${width}px copied PDF requested: ${request.url()}`);
      if (request.url().startsWith('https://5e-google-drive-gateway.5e-desktop.workers.dev/')) {
        driveLoads.push(request.url());
        if (request.headers().authorization) failures.push(`${width}px authenticated PDF request`);
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${width}px HTTP ${response.status()}: ${response.url()}`);
    });
    await page.goto(`${base}?q=${encodeURIComponent('빛 간섭 경로차')}&view=split&id=p2_2018_06_15`);
    await page.waitForFunction(() => document.querySelector('#result-count')?.textContent.includes('검색 결과'),
      { timeout: 30_000 });
    assert.match(await page.locator('#result-count').innerText(), /6개/);
    await page.locator('#source-image').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#source-image')?.src.startsWith('blob:'));
    assert.match(await page.locator('#open-pdf').getAttribute('href'), /#page=3$/u);
    await page.screenshot({ path: `${evidence}/questions-${width}.png`, fullPage: false });

    if (width <= 900) await page.locator('#mobile-back').click();
    await page.locator('#mode-files').click();
    await page.locator('.file-row').first().waitFor();
    await page.locator('.file-row .file-select').first().click();
    assert.match(await page.locator('#file-preview-open').getAttribute('href'), /#page=\d+$/u);
    await page.locator('.file-page-canvas').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.file-page-canvas')]
      .some((canvas) => canvas.dataset.rendered === 'true'));
    const pages = await page.locator('.file-page').count();
    assert.ok(pages > 1, `expected scrollable file preview, got ${pages} page`);
    await page.locator('#file-preview-pages').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction(() => document.querySelector('.file-page:last-child canvas')?.dataset.rendered === 'true');
    await page.screenshot({ path: `${evidence}/files-${width}.png`, fullPage: false });
    console.log(`${width}px: six search hits, high-resolution question, ${pages} PDF pages, scroll OK`);
    await page.close();
  }
  assert.ok(driveLoads.length >= 6, `expected public PDF requests, got ${driveLoads.length}`);
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
