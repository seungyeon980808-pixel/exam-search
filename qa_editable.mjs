import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import init, { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';
import { createPreparedHwpx } from './editable-convert.mjs';

const base = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8770/';
const pdfDirectory = process.env.EXAM_PDF_DIR;
const evidence = '/tmp/exam-search-editable-qa';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
await init({ module_or_path: await readFile(new URL('./vendor/rhwp-studio/assets/rhwp_bg-PUGAA2uC.wasm', import.meta.url)) });
const fileNames = pdfDirectory
  ? new Map(JSON.parse(await readFile(new URL('./data/files.json', import.meta.url)))
    .map((file) => [file.publicPath, file.pdfFile])) : null;

async function newPage(options) {
  const page = await browser.newPage(options);
  page.setDefaultTimeout(60_000);
  if (pdfDirectory) {
    await page.route('https://5e-google-drive-gateway.5e-desktop.workers.dev/**', async (route) => {
      const publicPath = new URL(route.request().url()).pathname.split('/public/')[1]
        ?.split('/').map(decodeURIComponent).join('/');
      const name = fileNames.get(publicPath);
      if (!name) return route.fulfill({ status: 404, body: 'Unknown public file' });
      return route.fulfill({ status: 200, contentType: 'application/pdf',
        body: await readFile(join(pdfDirectory, name)),
        headers: { 'access-control-allow-origin': '*' } });
    });
  }
  return page;
}

try {
  for (const width of [1280, 768, 375]) {
    const page = await newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}?subject=p1&year=2027&q=${encodeURIComponent('전자기파')}&id=p1_2027_06_01`);
    await page.locator('#detail-heading').getByText('물리학Ⅰ 1번').waitFor();
    await page.screenshot({ path: `${evidence}/source-${width}.png` });
    await page.locator('#source-image-link').click();
    await page.locator('#editable-status').getByText('편집 가능한 문서입니다', { exact: false }).waitFor();
    await page.frameLocator('iframe').getByRole('textbox', { name: '문서 편집 입력' }).waitFor();
    await page.screenshot({ path: `${evidence}/editor-${width}.png` });
    assert.equal(await page.locator('#editable-download').isEnabled(), true);
    assert.deepEqual(errors, []);
    if (width === 1280) {
      await page.frameLocator('iframe').getByRole('textbox', { name: '문서 편집 입력' }).press('g');
      const downloadEvent = page.waitForEvent('download');
      await page.locator('#editable-download').click();
      const download = await downloadEvent;
      assert.equal(download.suggestedFilename(), 'p1_2027_06_01-edited.hwpx');
      const document = new HwpDocument(await readFile(await download.path()));
      try {
        assert.match(document.getTextRange(0, 0, 0, 200), /g1\. 다음은/u);
      } finally {
        document.free();
      }
    }
    await page.locator('#editable-close').click();
    await page.locator('#open-viewer').click();
    assert.equal(await page.locator('#image-viewer').isVisible(), true);
    await page.locator('#close-viewer').click();
    console.log(`${width}px: image click opens editable rhwp; download ${width === 1280 ? 'verified' : 'enabled'}; zoom remains available`);
    await page.close();
  }

  const page = await newPage();
  await page.goto(`${base}?subject=b1&year=2015&id=b1_2015_06_01`);
  await page.locator('#detail-heading').getByText('생명과학Ⅰ 1번').waitFor();
  await page.locator('#open-editable').click();
  await page.locator('#editable-status').getByText('색인 텍스트를 읽을 수 없어', { exact: false }).waitFor();
  assert.equal(await page.locator('#editable-download').isEnabled(), false);
  await page.screenshot({ path: `${evidence}/unreadable.png` });
  console.log('unreadable CID question: explicit error, no false editable document');
  await page.close();

  const partialCidPage = await newPage();
  await partialCidPage.goto(`${base}?subject=b1&year=2007&id=b1_2007_11_10`);
  await partialCidPage.locator('#open-editable').click();
  await partialCidPage.locator('#editable-status').getByText('편집 가능한 문서입니다', { exact: false }).waitFor();
  assert.equal(await partialCidPage.locator('#editable-download').isEnabled(), true);
  console.log('interior CID placeholder in index: original PDF recovers editable text');
  await partialCidPage.close();

  const missingChoicesPage = await newPage();
  await missingChoicesPage.goto(`${base}?subject=b1&year=2007&id=b1_2007_11_04`);
  await missingChoicesPage.locator('#open-editable').click();
  await missingChoicesPage.locator('#editable-status').getByText('선지 다섯 개가 모두 복원되지 않아', { exact: false }).waitFor();
  assert.equal(await missingChoicesPage.locator('#editable-download').isEnabled(), false);
  console.log('missing choices: incomplete question cannot be downloaded');
  await missingChoicesPage.close();

  const preparedPage = await newPage();
  const preparedRequests = [];
  preparedPage.on('request', (request) => preparedRequests.push(request.url()));
  await preparedPage.goto(`${base}?subject=p2&year=2018&id=p2_2018_06_06`);
  await preparedPage.locator('#detail-heading').getByText('물리학Ⅱ 6번').waitFor();
  await preparedPage.locator('#open-editable').click();
  await preparedPage.locator('#editable-status').getByText('편집 가능한 문서입니다', { exact: false }).waitFor();
  assert.equal(await preparedPage.locator('#editable-download').isEnabled(), true);
  assert.ok(preparedRequests.some((url) => url.endsWith('/data/editable/prepared/p2_2018_06_06.json')));
  await preparedPage.screenshot({ path: `${evidence}/prepared.png` });
  console.log('prepared JSON: browser builds and opens editable HWPX');
  await preparedPage.close();

  const formulaPage = await newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await formulaPage.goto(`${base}?subject=p1&year=2027&id=p1_2027_06_06`);
  await formulaPage.locator('#detail-heading').getByText('물리학Ⅰ 6번').waitFor();
  await formulaPage.locator('#open-editable').click();
  await formulaPage.locator('#editable-status').getByText('편집 가능한 문서입니다', { exact: false }).waitFor();
  await formulaPage.frameLocator('iframe').getByRole('textbox', { name: '문서 편집 입력' }).waitFor();
  await formulaPage.screenshot({ path: `${evidence}/formula-p1-2027-06-06.png` });
  const formulaDownloadEvent = formulaPage.waitForEvent('download');
  await formulaPage.locator('#editable-download').click();
  const formulaDownload = await formulaDownloadEvent;
  const formulaDocument = new HwpDocument(await readFile(await formulaDownload.path()));
  try {
    const equations = JSON.parse(formulaDocument.getControls()).filter((control) => control.ctrlId === 'eqed');
    assert.equal(equations.length, 7, '문항 6의 본문 수식 7곳이 실제 HWPX에 남아야 합니다.');
  } finally {
    formulaDocument.free();
  }
  console.log('p1_2027_06_06: rhwp opens and downloaded HWPX retains 7 editable equations');
  await formulaPage.close();

  const unsafePage = await newPage({ acceptDownloads: true });
  await unsafePage.goto(`${base}?subject=p1&year=2027&id=p1_2027_06_05`);
  await unsafePage.locator('#open-editable').click();
  await unsafePage.locator('#editable-status').getByText('편집 가능한 문서입니다', { exact: false }).waitFor();
  assert.equal(await unsafePage.locator('#editable-download').isEnabled(), true);
  assert.match(await unsafePage.locator('#editable-pdf').getAttribute('href'), /p1_2027_06\.pdf.*#page=1/u);
  const popupPromise = unsafePage.waitForEvent('popup');
  await unsafePage.locator('#editable-pdf').click();
  const pdfPopup = await popupPromise;
  await pdfPopup.close();
  const liveDownloadEvent = unsafePage.waitForEvent('download');
  await unsafePage.locator('#editable-download').click();
  const liveDownload = await liveDownloadEvent;
  const liveDocument = new HwpDocument(await readFile(await liveDownload.path()));
  try {
    const equations = JSON.parse(liveDocument.getControls()).filter((control) => control.ctrlId === 'eqed');
    assert.ok(equations.length >= 10, '현장 변환본은 수식을 편집 가능한 HWPX 컨트롤로 보존해야 합니다.');
  } finally {
    liveDocument.free();
  }
  console.log('unprepared PDF question: editable equations retained; PDF link opens a new tab');
  await unsafePage.close();

  for (const width of [1280, 375]) {
    const roughPage = await newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
    await roughPage.goto(`${base}?subject=p1&month=6&id=p1_2027_06_18`);
    await roughPage.locator('#detail-heading').getByText('물리학Ⅰ 18번').waitFor();
    await roughPage.locator('#open-editable').click();
    await roughPage.locator('#editable-status').getByText('편집 가능한 문서입니다', { exact: false }).waitFor();
    await roughPage.frameLocator('iframe').getByRole('textbox', { name: '문서 편집 입력' }).waitFor();
    assert.equal(await roughPage.locator('#editable-download').isEnabled(), true);
    assert.equal(await roughPage.locator('#editable-original').isVisible(), true);
    await roughPage.screenshot({ path: `${evidence}/restored-p1-2027-06-18-${width}.png` });
    if (width === 1280) {
      const downloadEvent = roughPage.waitForEvent('download');
      await roughPage.locator('#editable-download').click();
      const downloaded = await downloadEvent;
      const document = new HwpDocument(await readFile(await downloaded.path()));
      try {
        const equations = JSON.parse(document.getControls()).filter((control) => control.ctrlId === 'eqed');
        assert.equal(equations.length, 16);
      } finally {
        document.free();
      }
    }
    console.log(`${width}px: restored question opens; downloaded HWPX retains 16 editable equations`);
    await roughPage.close();
  }

  const livePage = await newPage();
  await livePage.goto(`${base}?subject=p1&year=2027&id=p1_2027_06_18`);
  const fromPdf = await livePage.evaluate(async () => {
    const catalog = await fetch('./data/questions.json').then((response) => response.json());
    const question = catalog.items.find((item) => item.id === 'p1_2027_06_18');
    return import('./live-convert.mjs').then(({ convertQuestionNow }) => convertQuestionNow(question));
  });
  const liveHwpx = new HwpDocument(await createPreparedHwpx(fromPdf));
  try {
    const controls = JSON.parse(liveHwpx.getControls()).filter((control) => control.ctrlId === 'eqed');
    const scripts = controls.map((control) => JSON.parse(liveHwpx.getEquationProperties(
      control.list, control.para, control.controlIndex, -1, -1,
    )).script);
    assert.ok(scripts.length >= 20);
    assert.ok(scripts.some((script) => script.includes('{{3} over {2}}')));
    assert.ok(scripts.some((script) => script.includes('{{25} over {14}}')));
    assert.equal(fromPdf.blocks.filter((block) => block.role === 'choice').length, 5);
  } finally {
    liveHwpx.free();
  }
  console.log('original PDF question 18: click-time HWPX has five choices and editable fractions');
  await livePage.close();
} finally {
  await browser.close();
}
