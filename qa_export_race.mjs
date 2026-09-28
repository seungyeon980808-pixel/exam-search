import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import init, { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';

export async function verifyExportRace(browser, base, evidence) {
  await mkdir(evidence, { recursive: true });
  await init({ module_or_path: await readFile(new URL('./vendor/rhwp-studio/assets/rhwp_bg-PUGAA2uC.wasm', import.meta.url)) });
  const page = await browser.newPage({ acceptDownloads: true });
  page.setDefaultTimeout(60000);
  const observations = [];
  try {
    await page.route('**/vendor/rhwp-editor/transport.js', async (route) => {
      const source = await readFile(new URL('./vendor/rhwp-editor/transport.js', import.meta.url), 'utf8');
      await route.fulfill({ contentType: 'text/javascript', body: `${source}
        const originalRequest = EditorTransport.prototype.request;
        EditorTransport.prototype.request = function(method, params) {
          const response = originalRequest.call(this, method, params);
          if (method === 'exportHwpx' && window.__qaDelayExport) return response.then(bytes => {
            window.__qaExportCaptured = true;
            return new Promise(resolve => { window.__qaReleaseExport = () => resolve(bytes); });
          });
          return response;
        };` });
    });
    await page.goto(`${base}?subject=p1&year=2027&id=p1_2027_06_06`);
    await page.locator('#open-editable').click();
    await page.waitForFunction(() => !document.querySelector('#editable-download').disabled);
    const input = page.frameLocator('iframe').getByRole('textbox', { name: '문서 편집 입력' });
    await input.press('a');
    await page.evaluate(() => { window.__qaDelayExport = true; });
    const downloaded = page.waitForEvent('download');
    await page.locator('#editable-download').click();
    await page.waitForFunction(() => window.__qaExportCaptured === true);
    await input.press('b');
    await page.evaluate(() => window.__qaReleaseExport());
    await (await downloaded).saveAs(`${evidence}/export-race-snapshot.hwpx`);
    const snapshotDoc = new HwpDocument(await readFile(`${evidence}/export-race-snapshot.hwpx`));
    try {
      const text = snapshotDoc.getTextRange(0, 0, 0, 200);
      observations.push({ downloadedSnapshotText: text });
      assert.match(text, /^a6\./u);
      assert.doesNotMatch(text, /^ab6\./u);
    } finally { snapshotDoc.free(); }
    await page.waitForFunction(() => !document.querySelector('#editable-download').disabled);
    observations.push({ scenario: 'export captured after a; b entered while export response deferred', status: await page.locator('#editable-status').textContent() });
    const preventsUnload = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    observations.push({ beforeUnloadPrevented: preventsUnload });
    assert.equal(preventsUnload, true, 'Edits entered after export snapshot must remain unsaved after download');
    const confirm = page.waitForEvent('dialog');
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('#editable-close').click();
    assert.match((await confirm).message(), /내려받지 않은/u);
    assert.equal(await page.locator('#editable-dialog').isVisible(), true);
    observations.push({ closeWarned: true, dismissedClosePreservedEditor: true });
    await page.screenshot({ path: `${evidence}/export-race-unsaved.png` });
    await page.evaluate(() => { window.__qaDelayExport = false; });
    const saved = page.waitForEvent('download');
    await page.locator('#editable-download').click();
    await (await saved).saveAs(`${evidence}/export-race-latest.hwpx`);
    const latestDoc = new HwpDocument(await readFile(`${evidence}/export-race-latest.hwpx`));
    try {
      const text = latestDoc.getTextRange(0, 0, 0, 200);
      observations.push({ downloadedLatestText: text });
      assert.match(text, /^ab6\./u);
    } finally { latestDoc.free(); }
    await page.waitForFunction(() => !document.querySelector('#editable-download').disabled);
    const savedPreventsUnload = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(savedPreventsUnload, false, 'A subsequent stable export must clear the unsaved state');
    observations.push({ stableExportBeforeUnloadPrevented: savedPreventsUnload });
    await page.locator('#editable-close').click();
    await page.waitForFunction(() => !document.querySelector('#editable-dialog').open);
    await writeFile(`${evidence}/export-race-observations.json`, JSON.stringify({ passed: true, observations }, null, 2));
    return 'Deferred real export: later edit retains unload/close guard; subsequent stable save clears guard';
  } catch (error) {
    await writeFile(`${evidence}/export-race-observations.json`, JSON.stringify({ passed: false, observations, error: String(error) }, null, 2));
    throw error;
  } finally { await page.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch({ headless: true });
  try { console.log(await verifyExportRace(browser, process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8770/',
    process.env.EVIDENCE_DIR || '.omo/evidence/multi-question-rhwp/export-race')); }
  finally { await browser.close(); }
}
