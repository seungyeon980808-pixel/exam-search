import * as pdfjs from './vendor/pdfjs/pdf.mjs';
import { driveFilePath } from './data.mjs';
import { downloadDriveFile } from './drive-source.mjs';
import { equationTextItems } from './pdf-text-geometry.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

const documentCache = new Map();
const byteCache = new Map();
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

function trimTrailingPaper(canvas) {
  const { width, height } = canvas;
  if (!width || !height) return canvas;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, width, height).data;
  const left = Math.floor(width * 0.015);
  const right = Math.ceil(width * 0.985);
  const required = Math.max(3, Math.floor((right - left) * 0.004));
  let bottom = height - 1;
  for (; bottom >= 0; bottom -= 1) {
    let ink = 0;
    for (let x = left; x < right; x += 2) {
      const offset = (bottom * width + x) * 4;
      if (pixels[offset] < 235 && pixels[offset + 1] < 235 && pixels[offset + 2] < 235) ink += 1;
      if (ink >= required) break;
    }
    if (ink >= required) break;
  }
  const trimmedHeight = Math.min(height, bottom + Math.max(12, Math.round(height * 0.012)));
  if (trimmedHeight < height * 0.85 && trimmedHeight > height * 0.25) {
    const cropped = document.createElement('canvas');
    cropped.width = width;
    cropped.height = trimmedHeight;
    cropped.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0);
    return cropped;
  }
  return canvas;
}

export async function readQuestionPdf(item) {
  const documentPromise = openPdf(item.pdfFile);
  const bytesPromise = byteCache.get(item.pdfFile);
  await documentPromise;
  const bytes = await bytesPromise;
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)),
    fontExtraProperties: true, ...options });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(item.page);
    const [content, operations] = await Promise.all([
      page.getTextContent({ disableNormalization: true }), page.getOperatorList(),
    ]);
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
    return { content, fonts, glyphs, equationItems: equationTextItems(operations, pdfjs.OPS, fonts),
      pageHeight: page.getViewport({ scale: 1 }).height };
  } finally {
    await task.destroy();
  }
}

export async function renderQuestion(item, scale = 3) {
  const doc = await openPdf(item.pdfFile);
  const page = await doc.getPage(item.page);
  const box = item.displayBox || item.box;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((box[2] - box[0]) * scale);
  canvas.height = Math.ceil((box[3] - box[1]) * scale);
  const context = canvas.getContext('2d', { alpha: false });
  await page.render({ canvasContext: context, canvas,
    viewport: page.getViewport({ scale }),
    transform: [1, 0, 0, 1, -box[0] * scale, -box[1] * scale] }).promise;
  const output = item.sourceSha256 ? trimTrailingPaper(canvas) : canvas;
  const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/webp', 0.86));
  if (!blob) throw new Error('문항 이미지를 생성하지 못했습니다.');
  return URL.createObjectURL(blob);
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

export async function renderFilePages(name, container, firstPage = 1, isCurrent = () => true) {
  const doc = await openPdf(name);
  if (!isCurrent()) return;
  const entries = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const section = document.createElement('section');
    section.className = 'file-page';
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
  const target = entries[Math.min(doc.numPages, Math.max(1, firstPage)) - 1];
  if (target) container.scrollTop = target.offsetTop - container.offsetTop;
  const observer = new IntersectionObserver((observed) => {
    for (const entry of observed) {
      if (!entry.isIntersecting || !isCurrent()) continue;
      observer.unobserve(entry.target);
      const section = entry.target;
      const number = entries.indexOf(section) + 1;
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
