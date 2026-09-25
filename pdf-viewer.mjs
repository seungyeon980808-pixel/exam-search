import * as pdfjs from './vendor/pdfjs/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

const documentCache = new Map();
const options = {
  cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href,
};

function openPdf(name) {
  const url = new URL(`./pdfs/${encodeURIComponent(name)}`, import.meta.url).href;
  if (!documentCache.has(name)) {
    documentCache.clear();
    const promise = pdfjs.getDocument({ url, ...options }).promise;
    documentCache.set(name, promise);
    promise.catch(() => documentCache.delete(name));
  }
  return documentCache.get(name);
}

export async function renderQuestion(item) {
  const doc = await openPdf(item.pdfFile);
  const page = await doc.getPage(item.page);
  const scale = 3;
  const box = item.displayBox || item.box;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((box[2] - box[0]) * scale);
  canvas.height = Math.ceil((box[3] - box[1]) * scale);
  const context = canvas.getContext('2d', { alpha: false });
  await page.render({ canvasContext: context, canvas,
    viewport: page.getViewport({ scale }),
    transform: [1, 0, 0, 1, -box[0] * scale, -box[1] * scale] }).promise;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  if (!blob) throw new Error('문항 이미지를 생성하지 못했습니다.');
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
