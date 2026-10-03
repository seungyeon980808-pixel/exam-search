import './stream-iterator-polyfill.mjs';
import * as pdfjs from './vendor/pdfjs/pdf.mjs';
import { driveFilePath } from './data.mjs';
import { downloadDriveFile } from './drive-source.mjs';
import { equationTextItems } from './pdf-text-geometry.mjs';
import { PREVIEW_VERTICAL_PADDING_PT, previewCropBounds, previewPaperEnd, previewQuestionBox } from './preview-crop.mjs?v=preview-crop-20261004-1';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf-worker.mjs', import.meta.url).href;

const documentCache = new Map();
const byteCache = new Map();
const renderedPages = new Map();
const options = {
  cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href,
};

function openPdf(name) {
  if (!documentCache.has(name)) {
    if (documentCache.size >= 4) {
      const oldest = documentCache.keys().next().value;
      documentCache.delete(oldest);
      byteCache.delete(oldest);
    }
    const bytes = downloadDriveFile(driveFilePath(name));
    byteCache.set(name, bytes);
    const promise = bytes
      .then((data) => pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), ...options }).promise);
    documentCache.set(name, promise);
    promise.catch(() => {
      if (documentCache.get(name) === promise) documentCache.delete(name);
      if (byteCache.get(name) === bytes) byteCache.delete(name);
    });
  }
  return documentCache.get(name);
}

// Preview and conversion share the download and open document. Cancelling one
// consumer releases its wait without destroying resources another consumer needs.
function waitForPdf(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  return Promise.race([promise, cancelled]).finally(() => signal.removeEventListener('abort', abort));
}

function trimPreviewPaper(canvas, scale, box, paperEnd) {
  const { width, height } = canvas;
  if (!width || !height) return canvas;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const [left, top, right, bottom] = previewCropBounds(context.getImageData(0, 0, width, height),
    { scale, box, paperEnd });
  const padding = Math.ceil(PREVIEW_VERTICAL_PADDING_PT * scale);
  const cropped = document.createElement('canvas');
  cropped.width = right - left;
  cropped.height = bottom - top + padding * 2;
  const output = cropped.getContext('2d', { alpha: false });
  output.fillStyle = '#fff';
  output.fillRect(0, 0, cropped.width, cropped.height);
  // Copy only the detected content so adjacent source text cannot leak into the added frame.
  output.drawImage(canvas, left, top, right - left, bottom - top,
    0, padding, right - left, bottom - top);
  return cropped;
}

export async function readQuestionPdf(item, { signal } = {}) {
  signal?.throwIfAborted();
  const documentPromise = openPdf(item.pdfFile);
  const bytesPromise = byteCache.get(item.pdfFile);
  await waitForPdf(documentPromise, signal);
  signal?.throwIfAborted();
  const bytes = await waitForPdf(bytesPromise, signal);
  signal?.throwIfAborted();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)),
    fontExtraProperties: true, ...options });
  const abort = () => { Promise.resolve(task.destroy()).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(item.page);
    const [content, operations] = await Promise.all([
      page.getTextContent({ disableNormalization: true }), page.getOperatorList(),
    ]);
    signal?.throwIfAborted();
    const fonts = Object.fromEntries(Object.keys(content.styles).map((key) => {
      const font = page.commonObjs.get(key);
      return [key, { name: font.name || '', fontMatrix: font.fontMatrix,
        data: font.data ? Uint8Array.from(font.data) : null }];
    }));
    const glyphs = [];
    let fontId = '';
    for (let index = 0; index < operations.fnArray.length; index += 1) {
      const operation = operations.fnArray[index];
      const args = operations.argsArray[index];
      if (operation === pdfjs.OPS.setFont) fontId = args[0];
      if (operation !== pdfjs.OPS.showText) continue;
      for (const glyph of args[0]) {
        if (glyph && typeof glyph === 'object' && glyph.unicode) {
          glyphs.push({ fontId, codepoint: glyph.unicode.codePointAt(0),
            glyphId: glyph.originalCharCode, advance: glyph.width });
        }
      }
    }
    return { pageNumber: item.page, content, fonts, glyphs, equationItems: equationTextItems(operations, pdfjs.OPS, fonts),
      operations: { fnArray: operations.fnArray, argsArray: operations.argsArray }, OPS: pdfjs.OPS,
      pageHeight: page.getViewport({ scale: 1 }).height, pageWidth: page.getViewport({ scale: 1 }).width };
  } finally {
    signal?.removeEventListener('abort', abort);
    await task.destroy();
  }
}

async function renderedPage(item, scale) {
  const key = JSON.stringify([item.pdfFile, item.page, scale]);
  const hit = renderedPages.get(key);
  if (hit) { renderedPages.delete(key); renderedPages.set(key, hit); return hit; }
  const work = (async () => {
    const doc = await openPdf(item.pdfFile);
    const page = await doc.getPage(item.page);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const rendering = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), canvas, viewport });
    const timeout = setTimeout(() => rendering.cancel(), 10000);
    try { await rendering.promise; } finally { clearTimeout(timeout); }
    // Text failure must not prevent raster previews of scanned/legacy papers.
    const content = await page.getTextContent().catch(() => null);
    const pageHeight = viewport.height / scale;
    return { canvas, content, pageHeight, paperEnd: previewPaperEnd(content, pageHeight, viewport.width / scale) };
  })();
  renderedPages.set(key, work);
  // A full exam page is large; retain only two raster pages, shared by preview and conversion.
  if (renderedPages.size > 2) renderedPages.delete(renderedPages.keys().next().value);
  work.catch(() => { if (renderedPages.get(key) === work) renderedPages.delete(key); });
  return work;
}

async function questionCanvas(item, scale, preview = false) {
  const source = await renderedPage(item, scale);
  const box = preview ? previewQuestionBox(item, source.content, source.pageHeight) : item.displayBox || item.box;
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)
    || box[2] <= box[0] || box[3] <= box[1]) throw new Error('문항의 크롭 영역이 올바르지 않습니다.');
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((box[2] - box[0]) * scale);
  canvas.height = Math.ceil((box[3] - box[1]) * scale);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source.canvas, -box[0] * scale, -box[1] * scale);
  return preview ? trimPreviewPaper(canvas, scale, box, source.paperEnd) : canvas;
}

export async function renderQuestion(item, scale = 3) {
  const canvas = await questionCanvas(item, scale, true);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  if (!blob) throw new Error('문항 이미지를 생성하지 못했습니다.');
  return URL.createObjectURL(blob);
}

export async function renderFigureImage(item, scale = 2, { signal } = {}) {
  signal?.throwIfAborted();
  const canvas = await questionCanvas(item, scale);
  signal?.throwIfAborted();
  const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
  // Remove only white outer paper. Figure labels are retained as ink.
  for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
    const offset = (y * canvas.width + x) * 4;
    if (pixels[offset] < 245 || pixels[offset + 1] < 245 || pixels[offset + 2] < 245) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('문항 영역에서 인쇄된 내용을 찾지 못했습니다.');
  const padding = Math.ceil(3 * scale);
  left = Math.max(0, left - padding); top = Math.max(0, top - padding);
  right = Math.min(canvas.width - 1, right + padding); bottom = Math.min(canvas.height - 1, bottom + padding);
  const cropped = document.createElement('canvas');
  cropped.width = right - left + 1; cropped.height = bottom - top + 1;
  cropped.getContext('2d', { alpha: false }).drawImage(canvas, -left, -top);
  const blob = await new Promise((resolve) => cropped.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('문항 이미지를 생성하지 못했습니다.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal?.throwIfAborted();
  return { bytes, width: cropped.width, height: cropped.height };
}

export async function renderFileThumbnail(name) {
  const doc = await openPdf(name);
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 240 / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.72));
  if (!blob) throw new Error('시험지 미리보기를 생성하지 못했습니다.');
  return URL.createObjectURL(blob);
}

export async function renderFilePages(name, container, firstPage = 1, isCurrent = () => true, selectedPages = null) {
  const doc = await openPdf(name);
  if (!isCurrent()) return;
  const entries = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    if (selectedPages && !selectedPages.includes(number)) continue;
    const section = document.createElement('section');
    section.className = 'file-page';
    section.dataset.page = String(number);
    const label = document.createElement('span');
    label.className = 'file-page-label';
    label.textContent = `${number} / ${doc.numPages}쪽`;
    const canvas = document.createElement('canvas');
    canvas.className = 'file-page-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${name} ${number}쪽 원본`);
    canvas.style.aspectRatio = '0.71';
    section.append(label, canvas);
    entries.push(section);
  }
  container.replaceChildren(...entries);
  const target = entries.find((entry) => Number(entry.dataset.page) === firstPage) || entries[0];
  if (target) container.scrollTop = target.offsetTop - container.offsetTop;
  const observer = new IntersectionObserver((observed) => {
    for (const entry of observed) {
      if (!entry.isIntersecting || !isCurrent()) continue;
      observer.unobserve(entry.target);
      const section = entry.target;
      const number = Number(section.dataset.page);
      void (async () => {
        try {
          const page = await doc.getPage(number);
          if (!isCurrent()) return;
          const base = page.getViewport({ scale: 1 });
          const width = Math.max(1, container.clientWidth - 36);
          const scale = Math.min(2.3, width / base.width * Math.min(devicePixelRatio || 1, 2));
          const viewport = page.getViewport({ scale });
          const canvas = section.querySelector('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d', { alpha: false });
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: context,
            canvas, viewport }).promise;
          canvas.dataset.rendered = 'true';
        } catch {
          section.querySelector('canvas').replaceWith('페이지를 표시할 수 없습니다. PDF 열기로 확인해 주세요.');
        }
      })();
    }
  }, { root: container, rootMargin: '700px 0px' });
  entries.forEach((entry) => observer.observe(entry));
  return () => observer.disconnect();
}
