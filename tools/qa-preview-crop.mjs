import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const base = process.env.EXAM_SEARCH_URL || 'http://localhost:8813/';
const evidence = resolve(process.env.EXAM_CROP_EVIDENCE || '.omo/evidence/1003-preview-crop');
const catalog = JSON.parse(await readFile(new URL('../data/questions.json', import.meta.url))).items;
const ids = ['2021_11_math_ga_odd_01', '2021_11_math_ga_odd_04', '2021_11_math_ga_odd_30',
  'p1_2025_11_06', ...['p1', 'p2', 'c1', 'c2', 'b1', 'b2', 'e1', 'e2']
    .flatMap((subject) => [1, 20].map((no) => `${subject}_2027_06_${String(no).padStart(2, '0')}`)),
  '2019_11_kor_all_odd_01', '2019_11_kor_all_odd_36', '2019_11_eng_all_odd_36',
  '2019_11_economics_all_single_01'];
const selected = ids.map((id) => {
  const question = catalog.find((item) => item.id === id);
  assert.ok(question, `Missing fixture ${id}`);
  return { key: id, question };
});
const longPassage = catalog.find((item) => item.id === '2019_11_kor_all_odd_36');
selected.push(...longPassage.passageRegions.map((region, index) => ({
  key: `${longPassage.id}-passage-${index + 1}`,
  question: { ...longPassage, ...region, displayBox: region.box },
})));
// Existing science sources often have no source hash; the crop must apply to them too.
const plain = selected.find((item) => item.key === 'p1_2027_06_20');
selected.push({ key: `${plain.key}-no-source-hash`, question: { ...plain.question, sourceSha256: undefined } });
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const records = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route('**/app.js?*', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(base);
  for (const { key, question } of selected) {
    const result = await page.evaluate(async ({ item }) => {
      const { getJson, driveFilePath } = await import('./data.mjs?v=library-20261008-3');
      const { driveLink } = await import('./drive-source.mjs');
      const { renderQuestion } = await import('./pdf-viewer.mjs?v=library-20261008-3');
      const { PREVIEW_VERTICAL_PADDING_PT, previewQuestionBox, previewPaperEnd, previewCropBounds } = await import('./preview-crop.mjs');
      const pdfjs = await import('./vendor/pdfjs/pdf.mjs');
      await getJson('/api/status');
      const bytes = await fetch(driveLink(driveFilePath(item.pdfFile))).then((response) => {
        if (!response.ok) throw new Error(`Source PDF ${response.status}`);
        return response.arrayBuffer();
      });
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes),
        cMapUrl: new URL('./vendor/pdfjs/cmaps/', location.href).href, cMapPacked: true,
        standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', location.href).href });
      const doc = await task.promise;
      try {
        const sourcePage = await doc.getPage(item.page);
        const scale = 2;
        const viewport = sourcePage.getViewport({ scale });
        const source = document.createElement('canvas');
        source.width = Math.ceil(viewport.width); source.height = Math.ceil(viewport.height);
        await sourcePage.render({ canvasContext: source.getContext('2d', { alpha: false }), canvas: source, viewport }).promise;
        const content = await sourcePage.getTextContent();
        const pageHeight = viewport.height / scale;
        const box = previewQuestionBox(item, content, pageHeight);
        const raw = document.createElement('canvas');
        raw.width = Math.ceil((box[2] - box[0]) * scale); raw.height = Math.ceil((box[3] - box[1]) * scale);
        const context = raw.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, raw.width, raw.height);
        context.drawImage(source, -box[0] * scale, -box[1] * scale);
        const paperEnd = previewPaperEnd(content, pageHeight, viewport.width / scale);
        const bounds = previewCropBounds(context.getImageData(0, 0, raw.width, raw.height), { scale, box, paperEnd });
        const url = await renderQuestion(item, scale);
        try {
          const image = new Image(); image.src = url; await image.decode();
          const padding = Math.ceil(PREVIEW_VERTICAL_PADDING_PT * scale);
          if (image.naturalWidth !== bounds[2] - bounds[0] || image.naturalHeight !== bounds[3] - bounds[1] + padding * 2)
            throw new Error('Browser renderer and display bounds differ');
          const bottom = box[1] + bounds[3] / scale;
          const top = box[1] + bounds[1] / scale;
          const choices = content.items.filter((entry) => /[①②③④⑤]/u.test(entry.str || '')
            && entry.transform[4] >= box[0] && entry.transform[4] < box[2]
            && pageHeight - entry.transform[5] >= box[1] && pageHeight - entry.transform[5] < Math.min(box[3], paperEnd));
          const lostChoices = choices.filter((entry) => pageHeight - entry.transform[5] < top
            || pageHeight - entry.transform[5] > bottom);
          if (lostChoices.length) throw new Error(`Lost choice labels: ${lostChoices.map((entry) => entry.str).join(' ')}`);
          const display = document.createElement('canvas'); display.width = image.naturalWidth; display.height = image.naturalHeight;
          const displayContext = display.getContext('2d', { willReadFrequently: true });
          displayContext.drawImage(image, 0, 0);
          // The display uses lossy WebP; inspect the outer half away from its boundary ringing.
          const blankHeight = Math.floor(padding / 2);
          for (const y of [0, image.naturalHeight - blankHeight]) {
            const pixels = displayContext.getImageData(0, y, image.naturalWidth, blankHeight).data;
            if (pixels.some((value) => value < 245)) throw new Error('Preview padding contains visible ink');
          }
          return { width: image.naturalWidth, height: image.naturalHeight, originalBox: item.displayBox || item.box,
            displayBox: box, bounds, verticalPadding: padding, choiceLabels: choices.map((entry) => entry.str), lostChoices: 0,
            image: display.toDataURL('image/png') };
        } finally { URL.revokeObjectURL(url); }
      } finally { await task.destroy(); }
    }, { item: question });
    await writeFile(join(evidence, `${key}-after.png`), Buffer.from(result.image.split(',')[1], 'base64'));
    delete result.image;
    records.push({ key, ...result });
    console.log(`${key}: ${result.width}×${result.height}, choices retained`);
  }
  const q4 = records.find((entry) => entry.key === '2021_11_math_ga_odd_04');
  assert.ok(q4.height < 908 * 0.4, 'The reported q4 tail must be removed');
  assert.equal(q4.choiceLabels.join('').match(/[①②③④⑤]/gu)?.length, 5);
  assert.equal(records.find((entry) => entry.key.endsWith('-no-source-hash')).height,
    records.find((entry) => entry.key === plain.key).height);
  await writeFile(join(evidence, 'browser-results.json'), JSON.stringify(records, null, 2) + '\n');
  console.log(`PASS: ${records.length} original PDF regions`);
} finally { await browser.close(); }
