import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const base = process.env.EXAM_SEARCH_URL || 'http://localhost:8813/';
const output = resolve(process.env.EXAM_UI_EVIDENCE || '.omo/evidence/1004-readability/ui');
await mkdir(output, { recursive: true });
const records = [];
const fallbackSource = await readFile(new URL('../figure-fallback.mjs', import.meta.url), 'utf8');
for (const [browserName, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const scenario of ['included', 'excluded', 'failed-image']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
      page.setDefaultTimeout(60000);
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      if (scenario === 'failed-image') {
        assert.ok(fallbackSource.includes('const parent = validateFigureBox(figure, question);'));
        const fault = fallbackSource.replace('const parent = validateFigureBox(figure, question);',
          "if (question.id === 'b2_2025_11_18' && index === 0) throw new Error('QA image renderer unavailable');\n      const parent = validateFigureBox(figure, question);");
        await page.route(/\/figure-fallback\.mjs(?:\?.*)?$/, (route) => route.fulfill({ contentType: 'text/javascript', body: fault }));
      }
      await page.goto(`${base}?group=science&subject=b2&year=2025&month=11&id=b2_2025_11_18`);
      await page.locator('#open-editable').click();
      await page.locator('#editable-image-mode').selectOption(scenario === 'excluded' ? 'exclude' : 'include');
      await page.locator('#editable-start').click();
      await page.waitForFunction(() => !document.querySelector('#editable-download').disabled);
      const record = { browser: browserName, scenario, label: await page.locator('#editable-status-label').textContent(),
        message: await page.locator('#editable-status').textContent(), warnings: await page.locator('#editable-items').textContent() };
      if (scenario === 'failed-image') {
        assert.match(record.label, /복원 확인 1개/u);
        assert.match(record.warnings, /QA image renderer unavailable/u);
        assert.equal(await page.locator('#editable-information').getAttribute('open'), '');
        await page.locator('#editable-review-issues').click();
        assert.equal(await page.locator('#editable-more').getAttribute('open'), '');
        assert.equal(await page.locator('#editable-sources').getAttribute('open'), '');
      } else if (scenario === 'excluded') {
        assert.match(record.label, /그림 제외/u);
        assert.doesNotMatch(record.label, /복원 확인/u);
      } else {
        assert.doesNotMatch(record.label, /복원 확인|그림 제외/u);
        assert.match(record.label, /원본 대조/u);
      }
      const downloadEvent = page.waitForEvent('download');
      await page.locator('#editable-download').click();
      const download = await downloadEvent;
      const path = join(output, `${browserName}-${scenario}.hwpx`);
      await download.saveAs(path);
      record.download = { path, bytes: (await readFile(path)).length };
      assert.ok(record.download.bytes > 1000);
      if (scenario === 'failed-image') assert.match(await page.locator('#editable-status-label').textContent(), /복원 확인 1개/u);
      await page.screenshot({ path: join(output, `${browserName}-${scenario}.png`) });
      assert.deepEqual(errors, []); record.errors = errors;
      records.push(record);
      await page.close();
      console.log(`${browserName} ${scenario}: PASS`);
    }
  } finally { await browser.close(); }
}
await writeFile(join(output, 'results.json'), JSON.stringify(records, null, 2) + '\n');
console.log(`PASS ${records.length} browser UI scenarios`);
