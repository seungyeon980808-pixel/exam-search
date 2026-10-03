import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import init, { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';

const base = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8813/';
const evidence = process.env.EXAM_VISUAL_EVIDENCE || '/tmp/exam-formula-visual';
const publicMode = process.env.EXAM_PUBLIC_QA === '1';
const manifest = publicMode ? { inputs: [] } : JSON.parse(await readFile(process.env.EXAM_CORPUS_MANIFEST
  || '/tmp/exam-formula-corpus/hwpx-with-geometry-20260929/manifest.json'));
const files = JSON.parse(await readFile(new URL('./data/files.json', import.meta.url)));
const paths = new Map();
for (const input of manifest.inputs) {
  const file = files.find((entry) => entry.pdfFile === input.pdfFile);
  paths.set(file.publicPath, input.path);
  paths.set(file.publicPath.replace(/^기출문제\/기출확장_국영수사탐\//u, ''), input.path);
}
await mkdir(evidence, { recursive: true });
await init({ module_or_path: await readFile(new URL('./vendor/rhwp-studio/assets/rhwp_bg-PUGAA2uC.wasm', import.meta.url)) });
const browser = await chromium.launch({ headless: true });
try {
  for (const id of (process.env.EXAM_VISUAL_IDS || '2026_11_math_common_odd_01,2026_11_math_common_odd_02,2026_11_math_common_odd_20,p1_2027_06_18').split(',')) {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, acceptDownloads: true });
    const errors = [];
    const pdfResponses = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.url().includes('/public/') && response.headers()['content-type']?.includes('application/pdf')) {
        pdfResponses.push(response.status());
      }
    });
    if (!publicMode) await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/data/editable/index.json')) return route.fulfill({ json: { items: {} } });
      if (url.origin === new URL(base).origin) return route.continue();
      const path = paths.get(url.pathname.split('/public/')[1]?.split('/').map(decodeURIComponent).join('/'));
      if (!path) return route.fulfill({ status: 404, body: 'Outside local corpus' });
      return route.fulfill({ body: await readFile(path), contentType: 'application/pdf',
        headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto(`${base}?view=split&id=${encodeURIComponent(id)}`);
    await page.locator('#open-editable').click();
    await page.locator('#editable-status').getByText('편집 가능한 문서입니다', { exact: false }).waitFor({ timeout: 60000 });
    await page.frameLocator('iframe').getByRole('textbox', { name: '문서 편집 입력' }).waitFor();
    await page.locator('#editable-reference-image').waitFor({ state: 'visible' });
    await page.screenshot({ path: `${evidence}/${id}.png` });
    const event = page.waitForEvent('download');
    await page.locator('#editable-download').click();
    const download = await event;
    await download.saveAs(`${evidence}/${id}.hwpx`);
    const document = new HwpDocument(await readFile(`${evidence}/${id}.hwpx`));
    let count;
    try {
      count = JSON.parse(document.getControls()).filter((control) => control.ctrlId === 'eqed').length;
      assert.ok(count > 0, 'Downloaded document must retain native editable equations');
    } finally { document.free(); }
    if (publicMode) assert.ok(pdfResponses.some((status) => status === 200), 'Real public PDF must load without local interception');
    assert.deepEqual(errors, []);
    console.log(`${id}: ${publicMode ? 'public network' : 'local PDF'} → rhwp and original visible; downloaded ${count} native equations; ${evidence}`);
    await page.close();
  }
} finally { await browser.close(); }
