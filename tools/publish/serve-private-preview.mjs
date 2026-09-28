import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const preview = process.env.EXAM_PREVIEW_OUTPUT;
const manifestPath = process.env.EXAM_STAGE_MANIFEST;
const port = Number(process.env.EXAM_PRIVATE_PORT || 8795);
if (!preview || !manifestPath || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('EXAM_PREVIEW_OUTPUT, EXAM_STAGE_MANIFEST 및 유효한 EXAM_PRIVATE_PORT가 필요합니다.');
}
const stage = JSON.parse(readFileSync(manifestPath, 'utf8'));
const staged = new Set(stage.files.map((file) => file.flatRelativePath));
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.pdf', 'application/pdf'],
  ['.webp', 'image/webp'], ['.png', 'image/png'], ['.bcmap', 'application/octet-stream'],
  ['.wasm', 'application/wasm'], ['.ttf', 'font/ttf'],
]);

function sendFile(response, file) {
  try {
    const info = statSync(file);
    if (!info.isFile()) throw new Error('not file');
    response.writeHead(200, { 'content-type': mime.get(path.extname(file)) || 'application/octet-stream',
      'content-length': info.size, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end('Not found'); }
}

createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
  let parts;
  try { parts = new URL(request.url, 'http://127.0.0.1').pathname.split('/').filter(Boolean).map(decodeURIComponent); }
  catch { return response.writeHead(400).end('Bad path'); }
  if (parts.some((part) => part === '.' || part === '..' || part.startsWith('.'))) {
    return response.writeHead(404).end('Not found');
  }
  if (parts[0] === 'private-pdf') {
    const relative = parts.slice(1).join('/');
    if (!staged.has(relative)) return response.writeHead(404).end('Not in private stage');
    return sendFile(response, path.join(stage.root, relative));
  }
  if (parts[0] === 'data') {
    if (parts.length !== 2 || !['questions.json', 'files.json', 'answers.json', 'synonyms.json'].includes(parts[1])) {
      return response.writeHead(404).end('Not found');
    }
    return sendFile(response, path.join(preview, 'data', parts[1]));
  }
  if (parts.length === 1 && parts[0] === 'drive-source.mjs') {
    const source = readFileSync(path.join(root, 'drive-source.mjs'), 'utf8');
    const from = /const EXPANSION_BASE = '[^']+';/u;
    if (!from.test(source)) return response.writeHead(500).end('Drive source contract changed');
    const local = source.replace(from,
      `const EXPANSION_BASE = 'http://127.0.0.1:${port}/private-pdf/';`);
    return response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store' }).end(local);
  }
  const file = path.resolve(root, ...parts.length ? parts : ['index.html']);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return response.writeHead(404).end('Not found');
  return sendFile(response, file);
}).listen(port, '127.0.0.1', () => {
  console.log(`비공개 로컬 미리보기: http://127.0.0.1:${port}/`);
});
