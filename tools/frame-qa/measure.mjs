// 체감 속도: 빈 캐시 + 느린 인터넷(기본 20Mbps·40ms)에서 문항 선택 → 한글 변환 → 편집기에 열릴 때까지.
//   node tools/frame-qa/measure.mjs --url http://127.0.0.1:8945/ --editor frame-20261025-1 [--ids a,b] [--mbps 20] [--images include]
import { chromium } from 'playwright';
import { routeGateway } from './server.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : null).filter(Boolean));
const ids = (args.ids || 'p1_2024_06_03,c1_2024_06_02,b1_2025_11_07,e1_2026_09_05').split(',');
const mbps = Number(args.mbps || 20), runs = Number(args.runs || 2);
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const results = [];
for (let run = 0; run < runs; run += 1) {
  // 실제 브라우저처럼 디스크 캐시가 있는 빈 프로필(큰 wasm도 캐시됨).
  const context = await chromium.launchPersistentContext(mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'frame-measure-')), { viewport: { width: 1280, height: 900 } }); await routeGateway(context);
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: mbps * 125000, uploadThroughput: 5 * 125000 });
  // 실제로 망을 탄 바이트(캐시 적중 제외): CDP loadingFinished.encodedDataLength.
  let bytes = 0; const sizes = new Map(), urls = new Map();
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFinished', (e) => { const n = e.encodedDataLength || 0; bytes += n; const u = new URL(urls.get(e.requestId) || 'http://x/?'); const k = u.hostname.includes('gateway') ? 'PDF ' + u.pathname.split('/').pop() : u.pathname; sizes.set(k, (sizes.get(k) || 0) + n); });
  await page.goto(args.url); await page.waitForLoadState('networkidle');
  bytes = 0; sizes.clear();
  await page.evaluate(async ({ ids, version }) => { const m = await import(`/editable-editor.mjs?v=${version}`); window.__open = m.openEditableCollection(ids); }, { ids, version: args.editor });
  await page.locator('#editable-start').waitFor({ state: 'visible' });
  if (args.images) await page.evaluate((v) => { const s = document.querySelector('#editable-image-mode'); s.value = v; s.dispatchEvent(new Event('change')); }, args.images);
  const t0 = Date.now(); await page.locator('#editable-start').click();
  await page.waitForFunction(() => !document.querySelector('#editable-download').disabled || /실패|못했/.test(document.querySelector('#editable-status').textContent), null, { timeout: 300000 });
  if (args.top) console.log([...sizes].sort((a, b) => b[1] - a[1]).slice(0, Number(args.top)).map(([k, v]) => `${(v / 1e6).toFixed(1)}MB ${decodeURIComponent(k)}`).join('\n'));
  results.push({ ms: Date.now() - t0, mb: Math.round(bytes / 1e5) / 10, status: await page.locator('#editable-status').textContent() });
  await context.close();
}
console.log(JSON.stringify({ url: args.url, mbps, ids: ids.length, results }));
