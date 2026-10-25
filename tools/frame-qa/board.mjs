// 눈 검사판: 원본 문항 카드(왼쪽)와 5E 문항 틀로 만든 한글 문서(오른쪽)를 나란히 놓는다.
//   node tools/frame-qa/board.mjs [--ids a,b] [--sample N] [--from results.jsonl --failed] [--out _work/frame-qa/board]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ROOT, startServer } from './server.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null).filter(Boolean));
const OUT = join(ROOT, args.out || '_work/frame-qa/board'); mkdirSync(OUT, { recursive: true });
const corpus = JSON.parse(readFileSync(join(ROOT, 'tools/frame-qa/corpus.json'), 'utf8'));
let ids = args.ids ? String(args.ids).split(',') : corpus.map((item) => item.id);
if (args.from) {
  const rows = readFileSync(args.from, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  ids = rows.filter((row) => !args.failed || !row.pass).map((row) => row.id);
}
if (args.sample) { const n = Number(args.sample), step = ids.length / n; ids = Array.from({ length: Math.min(n, ids.length) }, (_, k) => ids[Math.floor(k * step)]); }

// --root <폴더>: 고정 사본(예: 이전 커밋)을 내보내 견준다. 원본 카드 그림은 이 저장소 것을 쓴다.
const server = await startServer(0, args.root ? resolve(args.root) : undefined);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
await page.goto(server.origin + '/__blank');
const rendered = await page.evaluate(async (ids) => {
  (await import('/pdf-viewer.mjs?v=frame-20261025-1')).setPdfSource((name) => fetch('/__pdf/' + encodeURIComponent(name)).then((r) => r.arrayBuffer()));
  const f = await import('/exampool/frame.mjs'); const Document = await f.loadFrameEngine();
  const items = new Map((await (await fetch('/data/questions.json')).json()).items.map((q) => [q.id, q]));
  const out = [];
  for (const id of ids) {
    try {
      const c = await f.convertFrame(items.get(id)); const d = new Document(c.bytes);
      try {
        // 편집기와 같은 캔버스 그리기(SVG는 일부 글을 빠뜨려 그려 눈 검사에 쓰지 않는다).
        const canvas = document.createElement('canvas'); d.renderPageToCanvas(0, canvas, 2);
        out.push({ id, png: canvas.toDataURL('image/png'), notes: c.notes, height: c.height });
      } finally { d.free(); }
    } catch (error) { out.push({ id, error: String(error?.message || error) }); }
  }
  return out;
}, ids);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const rows = rendered.map((r) => `<section><h2>${esc(r.id)}${r.notes?.length ? ` <small>${esc(r.notes.join(' · '))}</small>` : ''}</h2>
<div class="pair"><img src="${args.root ? 'data:image/webp;base64,' + readFileSync(join(ROOT, 'cards', r.id + '.webp')).toString('base64') : '/cards/' + encodeURIComponent(r.id) + '.webp'}"><div class="doc">${r.error ? `<p class="err">${esc(r.error)}</p>` : `<img class="paper" src="${r.png}">`}</div></div></section>`).join('\n');
const SERVED = args.root ? resolve(args.root) : ROOT; mkdirSync(join(SERVED, '_work/frame-qa'), { recursive: true });
writeFileSync(join(SERVED, '_work/frame-qa/board.html'), `<!doctype html><meta charset="utf-8"><title>5E 문항 틀 비교판</title><style>
body{font:13px system-ui;margin:16px;background:#f3f4f6}section{background:#fff;margin:0 0 14px;padding:10px;border-radius:8px}
h2{font-size:13px;margin:0 0 8px}small{color:#b45309;font-weight:400}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
.pair img{width:100%;border:1px solid #ddd}.doc{border:1px solid #ddd;overflow:hidden}.paper{width:100%;height:auto;display:block}.err{color:#b91c1c}</style>${rows}`);
await page.goto(server.origin + '/_work/frame-qa/board.html');
await page.waitForLoadState('networkidle');
const sections = await page.locator('section').count();
for (let i = 0; i < sections; i += 4) {
  const top = await page.locator('section').nth(i).boundingBox(), last = await page.locator('section').nth(Math.min(sections - 1, i + 3)).boundingBox();
  await page.screenshot({ path: join(OUT, `board-${String(i / 4 + 1).padStart(2, '0')}.png`), fullPage: true,
    clip: { x: 0, y: top.y, width: 1400, height: last.y + last.height - top.y } });
}
console.log(`${rendered.length}문항 · 실패 ${rendered.filter((r) => r.error).length} · ${OUT}`);
await browser.close(); await server.close();
