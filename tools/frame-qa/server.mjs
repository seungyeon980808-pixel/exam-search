// 검사용 정적 서버: 저장소를 그대로 내보내고, 공개 드라이브 게이트웨이 대신 로컬 공유 폴더의 원본 PDF를 준다.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
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

export async function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    // /__pdf/<시험지 파일 이름>: 로컬 공유 폴더의 원본 PDF(검사 페이지가 setPdfSource로 쓴다).
    if (url.pathname.startsWith('/__pdf/')) {
      const name = decodeURIComponent(url.pathname.slice(7)), rel = publicPathOf.get(name), file = rel && pdfFor(rel);
      if (!file) { res.writeHead(404); res.end('no pdf ' + name); return; }
      res.writeHead(200, { 'content-type': 'application/pdf' }); createReadStream(file).pipe(res); return;
    }
    if (url.pathname === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><meta charset=utf-8><title>qa</title>'); return; }
    const file = resolve(ROOT, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(res);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
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
