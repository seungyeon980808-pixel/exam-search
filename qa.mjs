import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8768/';
const evidence = '/tmp/exam-search-qa';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];

try {
  for (const width of [1280, 768, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', (error) => failures.push(`${width}px JS: ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${width}px HTTP ${response.status()}: ${response.url()}`);
    });
    await page.goto(`${base}?q=${encodeURIComponent('빛 간섭 경로차')}&view=split&id=p2_2018_06_15`);
    await page.waitForFunction(() => document.querySelector('#result-count')?.textContent.includes('검색 결과'),
      { timeout: 30_000 });
    assert.match(await page.locator('#result-count').innerText(), /6개/);
    await page.locator('#source-image').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#source-image')?.src.startsWith('blob:'));
    await page.screenshot({ path: `${evidence}/questions-${width}.png`, fullPage: false });

    if (width <= 900) await page.locator('#mobile-back').click();
    await page.locator('#mode-files').click();
    await page.locator('.file-row').first().waitFor();
    await page.locator('.file-row .file-select').first().click();
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
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
