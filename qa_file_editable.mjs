import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const evidence = '/tmp/exam-search-file-conversion-qa';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 768, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(120000);
    await page.goto('http://127.0.0.1:8813/?subject=p1&mode=files&view=split&file=p1_2027_06.pdf');
    await page.locator('.file-page-label button').first().waitFor();
    await page.locator('.file-page-canvas[data-rendered="true"]').first().waitFor();
    assert.equal(await page.locator('#file-preview-editable').textContent(), '전체 20문항 한글로');
    assert.equal(await page.locator('.file-page-label button').first().textContent(), '이 쪽 6문항 한글로');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${evidence}/file-${width}.png` });
    if (width === 1280) {
      await page.locator('.file-page-label button').first().click();
      await page.waitForFunction(() => !document.querySelector('#editable-download').disabled || !document.querySelector('#editable-partial').hidden);
      assert.equal(await page.locator('#editable-title').textContent(), '선택 문항 6개');
      await page.screenshot({ path: `${evidence}/page-conversion.png` });
      console.log('PAGE RESULT:', await page.locator('#editable-status').textContent());
      await page.locator('#editable-close').click();
      await page.locator('#file-preview-editable').click();
      await page.waitForFunction(() => !document.querySelector('#editable-download').disabled || !document.querySelector('#editable-partial').hidden);
      assert.equal(await page.locator('#editable-title').textContent(), '선택 문항 20개');
      console.log('WHOLE RESULT:', await page.locator('#editable-status').textContent());
      assert.equal(await page.locator('#editable-download').isEnabled(), true);
      const downloadEvent = page.waitForEvent('download');
      await page.locator('#editable-download').click();
      const download = await downloadEvent;
      const path = `${evidence}/whole-paper.hwpx`;
      await download.saveAs(path);
      const xml = execFileSync('unzip', ['-p', path, 'Contents/section0.xml'], { encoding: 'utf8' });
      const equations = (xml.match(/<hp:equation\b/gu) || []).length;
      assert.ok(equations > 0);
      console.log('DOWNLOADED EDITABLE EQUATIONS:', equations);
      await page.screenshot({ path: `${evidence}/whole-conversion.png` });
    }
    await page.close();
  }
} finally { await browser.close(); }
