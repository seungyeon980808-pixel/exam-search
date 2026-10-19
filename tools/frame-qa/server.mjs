// 검사용 정적 서버: 저장소를 그대로 내보내고, 공개 드라이브 게이트웨이 대신 로컬 공유 폴더의 원본 PDF를 준다.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PDF_ROOT = process.env.EXAM_PDF_ROOT || '/Users/parkseungyeon/Library/CloudStorage/GoogleDrive-park49174332@gmail.com/내 드라이브/1. 개인작업/5E_공유폴더테스트_0916';
export const GATEWAY = 'https://5e-google-drive-gateway.5e-desktop.workers.dev/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
  '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

export function pdfFor(publicPath) {
  const file = join(PDF_ROOT, publicPath);
  return file.startsWith(PDF_ROOT) && existsSync(file) ? file : null;
}

const publicPathOf = new Map(JSON.parse(readFileSync(join(ROOT, 'data/files.json'), 'utf8')).map((f) => [f.pdfFile, f.publicPath]));

const CACHE = join(ROOT, '_work/pdf-cache');
const PUBLIC_BASE = GATEWAY + 'v1/google-drive/folders/1N46Woe4wIXs-PoUpVf0Uu4hPkSIUBqgX/public/';
async function pdfBytes(name, rel) {
  const cached = join(CACHE, name);
  if (existsSync(cached)) return readFile(cached);
  const local = pdfFor(rel);
  if (local) {
    const body = await Promise.race([readFile(local).catch(() => null), new Promise((ok) => setTimeout(() => ok(null), 3000))]);
    if (body) return body;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(PUBLIC_BASE + rel.split('/').map(encodeURIComponent).join('/'));
      if (!response.ok) throw new Error(`게이트웨이 ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      mkdirSync(CACHE, { recursive: true }); writeFileSync(cached, body);
      return body;
    } catch (error) { if (attempt === 3) throw error; await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1))); }
  }
}

export async function startServer(port = 0, root = ROOT) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    // /__pdf/<시험지 파일 이름>: 로컬 공유 폴더의 원본 PDF(검사 페이지가 setPdfSource로 쓴다).
    if (url.pathname.startsWith('/__pdf/')) {
      const name = decodeURIComponent(url.pathname.slice(7)), rel = publicPathOf.get(name);
      if (!rel) { res.writeHead(404); res.end('no pdf ' + name); return; }
      // 내려받아 둔 사본(_work/pdf-cache) → 로컬 공유 폴더(3초 안에 읽힐 때) → 공개 게이트웨이(실제 사이트와 같은 길) 순서.
      void pdfBytes(name, rel).then((body) => { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(body); },
        (error) => { res.writeHead(503); res.end(String(error.message)); });
      return;
    }
    if (url.pathname === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><meta charset=utf-8><title>qa</title>'); return; }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => server.close(ok)) };
}

/** 페이지(맥락)의 게이트웨이 요청을 로컬 PDF로 답한다. */
export async function routeGateway(context) {
  await context.route(GATEWAY + '**', (route) => {
    const publicPath = new URL(route.request().url()).pathname.split('/public/')[1]?.split('/').map(decodeURIComponent).join('/');
    const file = publicPath && pdfFor(publicPath);
    if (!file) return route.fulfill({ status: 404, body: 'Unknown public file' });
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: readFileSync(file), headers: { 'access-control-allow-origin': '*' } });
  });
}

// 직접 실행: GitHub Pages처럼 max-age=600을 주는 정적 서버. node tools/frame-qa/server.mjs <port> [root]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { origin } = await startServer(Number(process.argv[2] || 8947), resolve(process.argv[3] || ROOT));
  console.log(origin);
}
