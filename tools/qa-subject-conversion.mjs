// Exercise actual detail → conversion → download for both catalog ID families.
// Local original PDFs keep the comparison independent of gateway availability.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import init, { HwpDocument } from '../vendor/rhwp-studio/assets/rhwp-core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8813/';
const evidence = resolve(root, '_work/subject-review/browser');
await mkdir(evidence, { recursive: true });
const paths = execFileSync('rg', ['--files', '-uuu', process.env.EXAM_ORIGINAL_ROOT || resolve(root, '../../../exam-search-public')],
  { encoding: 'utf8', maxBuffer: 1e7 }).trim().split('\n').filter(path => path.endsWith('.pdf'));
const names = new Map(paths.map(path => [path.split('/').at(-1).normalize('NFC'), path]));
const hashes = new Map(paths.flatMap(path => {
  const hash = path.match(/_([0-9a-f]{12})\.pdf$/u)?.[1]; return hash ? [[hash, path]] : [];
}));
const pdfs = new Map();
for (const file of JSON.parse(await readFile(resolve(root, 'data/files.json')))) {
  const name = file.publicPath.split('/').at(-1).normalize('NFC');
  const path = names.get(file.pdfFile.normalize('NFC')) || names.get(name) || hashes.get(name.match(/_([0-9a-f]{12})\.pdf$/u)?.[1]);
  if (!path) continue;
  pdfs.set(file.publicPath.normalize('NFC'), path);
  pdfs.set(file.publicPath.replace(/^기출문제\/기출확장_국영수사탐\//u, '').normalize('NFC'), path);
}
const cases = [
  ['math', '2021_11_math_ga_odd_03', 'sin'],
  ['kor', '2019_11_kor_all_odd_36', '경업'],
  ['eng', '2019_11_eng_all_odd_36', 'Researchers'],
  ['economics', '2019_11_economics_all_single_11', '11.'],
  ['p1', 'p1_2027_06_20', '전기력'],
  ['c1', 'c1_2027_06_20', '화학 반응식'],
  ['b2', 'b2_2025_11_18', '유전자'],
  ['e1', 'e1_2027_06_20', '방사성'],
];
await init({ module_or_path: await readFile(resolve(root, 'vendor/rhwp-studio/assets/rhwp_bg-PUGAA2uC.wasm')) });
const observations = [];
for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch();
  try {
    for (const [subject, id, anchor] of cases) {
      const context = await browser.newContext({ viewport: { width: engine === 'webkit' ? 375 : 1440, height: 900 }, acceptDownloads: true });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/v1/google-drive/folders/**/public/**', async route => {
        const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/public/').at(-1)).normalize('NFC');
        const path = pdfs.get(name);
        assert(path, `Original PDF missing: ${name}`);
        await route.fulfill({ contentType: 'application/pdf', body: await readFile(path) });
      });
      const start = performance.now();
      await page.goto(`${origin}?subject=${subject}&id=${id}`);
      await page.locator('#detail-content').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#detail-selection').isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#open-editable').click();
      const includeImages = ['b2', 'e1'].includes(subject);
      if (includeImages) {
        await page.locator('#editable-document-settings > summary').click();
        await page.locator('#editable-image-mode').selectOption('include');
        await page.locator('#editable-document-settings > summary').click();
      }
      await page.locator('#editable-start').click();
      await page.waitForFunction(() => !document.querySelector('#editable-download').disabled, null, { timeout: 120000 });
      const readyMs = Math.round(performance.now() - start);
      const downloading = page.waitForEvent('download');
      await page.locator('#editable-download').click();
      const download = await downloading, output = resolve(evidence, `${engine}-${id}.hwpx`);
      await download.saveAs(output);
      const doc = new HwpDocument(await readFile(output));
      try {
        const text = Array.from({ length: doc.getParagraphCount(0) }, (_, n) => doc.getTextRange(0, n, 0, 20000)).join('\n');
        const scripts = Array.from({ length: doc.pageCount() }, (_, page) => JSON.parse(doc.getPageControlLayout(page)).controls)
          .flat().filter(control => control.type === 'equation').map(control => JSON.parse(doc.getEquationProperties(
            control.secIdx, control.paraIdx, control.controlIdx, control.cellIdx ?? -1, control.cellParaIdx ?? -1)).script).join(' ');
        assert((text + scripts).replace(/\s/gu, '').includes(anchor.replace(/\s/gu, '')), `Native editable content missing: ${id} / ${anchor}`);
        assert(doc.pageCount() > 0);
        const pictures = Array.from({ length: doc.pageCount() }, (_, n) => JSON.parse(doc.getPageControlLayout(n)).controls)
          .flat().filter(control => ['picture', 'image'].includes(control.type)).length;
        if (includeImages) assert(pictures > 0, `Requested source drawings missing: ${id}`);
        assert.deepEqual(errors, []);
        observations.push({ engine, subject, id, includeImages, pictures, readyMs, pages: doc.pageCount(), nativeEquations: JSON.parse(doc.getControls()).filter(c => c.ctrlId === 'eqed').length, errors });
      } finally { doc.free(); }
      await page.screenshot({ path: resolve(evidence, `${engine}-${id}.png`) });
      console.log(JSON.stringify(observations.at(-1)));
      await context.close();
    }
  } finally { await browser.close(); }
}
await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ passed: true, observations }, null, 2));
