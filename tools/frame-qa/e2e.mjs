// 5E 문항 틀 화면 흐름 검사: 선택 문항 → 한글 변환 → 5E 틀 문서가 0.8.7 편집기로 열림 → 내려받은 HWPX 확인.
// 「기본 변환」으로 바꾸면 기존 편집기·기존 문서로 돌아가는지, 그림 제외면 그림 자리가 남는지도 본다.
//   node tools/frame-qa/e2e.mjs [--engines chromium,webkit] [--widths 1280,390]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { ROOT, startServer, routeGateway } from './server.mjs';

import { execFileSync } from 'node:child_process';
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : null).filter(Boolean));
const ENGINES = (args.engines || 'chromium,webkit').split(',');
const WIDTHS = (args.widths || '1280,390').split(',').map(Number);
const OUT = join(ROOT, '_work/frame-qa/e2e'); mkdirSync(OUT, { recursive: true });
const IDS = ['p1_2024_06_03', 'c1_2024_06_02', 'b1_2025_11_07', 'e1_2026_09_05'];
const server = await startServer();
const report = [];

async function convert(page, ids, { frame = '5e', images = 'include', layout = 'continuous' } = {}) {
  await page.evaluate(async (ids) => {
    const m = await import('/editable-editor.mjs?v=frame-20261020-1');
    window.__editorOpen = m.openEditableCollection(ids);
  }, ids);
  await page.locator('#editable-start').waitFor({ state: 'visible' });
  await page.evaluate(({ frame, images, layout }) => {
    for (const [id, value] of [['#editable-frame-mode', frame], ['#editable-image-mode', images], ['#editable-layout', layout]]) {
      const select = document.querySelector(id); select.value = value; select.dispatchEvent(new Event('change'));
    }
  }, { frame, images, layout });
  const t0 = Date.now();
  await page.locator('#editable-start').click();
  await page.waitForFunction(() => !document.querySelector('#editable-download').disabled
    || /실패|못했/.test(document.querySelector('#editable-status')?.textContent || ''), null, { timeout: 180000 });
  const ms = Date.now() - t0;
  const state = await page.evaluate(() => ({ status: document.querySelector('#editable-status').textContent,
    label: document.querySelector('#editable-document-label').textContent,
    studio: document.querySelector('#editable-host iframe')?.getAttribute('src') || '',
    frames: document.querySelectorAll('#editable-host iframe').length,
    items: [...document.querySelectorAll('#editable-items li')].map((li) => li.textContent) }));
  return { ms, ...state };
}

async function downloaded(page) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.locator('#editable-download').click()]);
  const path = await download.path();
  const xml = execFileSync('unzip', ['-p', path, 'Contents/section0.xml'], { maxBuffer: 1 << 28 }).toString('utf8');
  return { name: download.suggestedFilename().normalize('NFC'), equations: (xml.match(/<hp:equation\b/g) || []).length, pictures: (xml.match(/<hp:pic\b/g) || []).length,
    tables: (xml.match(/<hp:tbl\b/g) || []).length, bookmarks: [...xml.matchAll(/exam_question_([\w%]+)/g)].map((m) => decodeURIComponent(m[1])),
    text: xml.replace(/<hp:script>[\s\S]*?<\/hp:script>/g, '').replace(/<[^>]+>/g, '') };
}

for (const name of ENGINES) {
  const browser = await { chromium, webkit }[name].launch({ headless: true });
  try {
    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
      await routeGateway(context);
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('dialog', (dialog) => dialog.accept());
      const wasm = []; page.on('request', (request) => { if (request.url().endsWith('.wasm') || request.url().includes('.wasm?')) wasm.push(new URL(request.url()).pathname); });
      await page.goto(server.origin + '/');
      // 1) 5E 문항 틀 · 그림 포함
      const framed = await convert(page, IDS);
      assert.match(framed.studio, /exampool\/studio\//, `${name} ${width}: 5E 틀 문서는 0.8.7 편집기로 열어야 합니다`);
      assert.equal(framed.frames, 1);
      assert(!wasm.some((path) => path.includes('PUGAA2uC')), `5E 틀만 쓸 때 0.8.6 엔진을 받으면 안 됩니다: ${wasm.join(', ')}`);
      assert.match(framed.label, /5E 문항 틀/);
      await page.screenshot({ path: join(OUT, `${name}-${width}-frame.png`) });
      const file = await downloaded(page);
      assert.match(file.name, /5E틀/);
      assert.deepEqual(file.bookmarks.sort(), [...IDS].sort(), '문항마다 이동 표시가 있어야 합니다');
      assert(file.pictures >= 4, `그림이 들어가야 합니다(${file.pictures})`);
      for (const n of ['3.', '2.', '7.', '5.']) assert(file.text.includes(n), `문항 번호 ${n}`);
      assert(!/\{\{수식|\$[^$]+\$/.test(file.text), '수식 표시가 글로 남으면 안 됩니다');
      // 2) 그림 제외: 5E 틀은 유지하고 그림 자리만
      await page.evaluate(() => { document.querySelector('#editable-close').click(); });
      const ghost = await convert(page, IDS.slice(0, 2), { images: 'exclude' });
      assert.match(ghost.studio, /exampool\/studio\//);
      const ghostFile = await downloaded(page);
      assert(ghostFile.pictures >= 1, '그림 제외에서도 그림 자리 상자가 남아야 합니다');
      // 3) 기본 변환: 기존 편집기로 돌아감
      await page.evaluate(() => { document.querySelector('#editable-close').click(); });
      const basic = await convert(page, IDS.slice(0, 2), { frame: 'basic', images: 'exclude' });
      assert.match(basic.studio, /vendor\/rhwp-studio\//, '기본 변환은 기존 편집기');
      assert.equal(basic.frames, 1, '편집기가 겹치면 안 됩니다');
      const basicFile = await downloaded(page);
      assert(!/5E틀/.test(basicFile.name));
      // 4) 문항별 새 페이지
      await page.evaluate(() => { document.querySelector('#editable-close').click(); });
      const paged = await convert(page, IDS.slice(0, 2), { layout: 'question' });
      assert.match(paged.studio, /exampool\/studio\//);
      const pagedFile = await downloaded(page);
      assert.equal(pagedFile.bookmarks.length, 2);
      assert.deepEqual(errors, [], `페이지 오류: ${errors.join(' / ')}`);
      report.push({ engine: name, width, frameMs: framed.ms, framedItems: framed.items, pictures: file.pictures, equations: file.equations, tables: file.tables,
        ghostMs: ghost.ms, basicMs: basic.ms, pagedMs: paged.ms, status: framed.status });
      console.log(`${name} ${width}px: 5E 틀 4문항 ${framed.ms}ms · 그림 ${file.pictures} · 수식 ${file.equations} · 표 ${file.tables} | 그림 제외 ${ghost.ms}ms | 기본 ${basic.ms}ms | 새 쪽 ${paged.ms}ms`);
      await context.close();
    }
  } finally { await browser.close(); }
}
await server.close();
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('e2e 통과');
