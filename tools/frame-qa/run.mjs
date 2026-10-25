// 5E 문항 틀 채점(AI 없음): 5E ExamPool 하네스(tools/kice-convert, 1,440문항 복원 95.7%)와 같은 채점표로
// 기출 탐색기의 화면 없는 조판기(exampool/frame.mjs)를 잰다. 원본 PDF는 로컬 공유 폴더에서 읽기만 한다.
//   node tools/frame-qa/run.mjs [--ids a,b] [--subject p1] [--sample N] [--limit N] [--workers 4] [--out _work/frame-qa/<이름>] [--keep-bytes]
//   [--root <작업 사본 폴더>]
//   EXAM_PDF_ROOT=<공유 폴더> (기본: 구글 드라이브 5E_공유폴더테스트_0916)
import { startServer } from './server.mjs';
import { createReadStream, existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { extname, join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { score, summarize } = require('./score.cjs');
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null).filter(Boolean));
const PDF_ROOT = process.env.EXAM_PDF_ROOT || '/Users/parkseungyeon/Library/CloudStorage/GoogleDrive-park49174332@gmail.com/내 드라이브/1. 개인작업/5E_공유폴더테스트_0916';
const corpusAll = JSON.parse(readFileSync(join(HERE, 'corpus.json'), 'utf8'));
const reference = JSON.parse(readFileSync(join(HERE, 'reference.json'), 'utf8'));
const corpusById = new Map(corpusAll.map((item) => [item.id, item]));
const library = new Map(JSON.parse(readFileSync(join(ROOT, 'data/questions.json'), 'utf8')).items.map((item) => [item.id, item]));
let items = corpusAll;
if (args.all) {
  // 조사 기록 밖(2007~2023 포함) 과탐 전체: 채점 기준(reference)이 없어 변환·조판 성공과 글 보존만 본다.
  items = [...library.values()].filter((item) => ['p1', 'p2', 'c1', 'c2', 'b1', 'b2', 'e1', 'e2'].includes(item.subject));
}
if (args.ids) items = items.filter((item) => String(args.ids).split(',').includes(item.id));
if (args.subject) items = items.filter((item) => String(args.subject).split(',').includes(item.subject));
if (args.year) items = items.filter((item) => String(args.year).split(',').includes(String(item.year ?? item.id.split('_')[1])));
if (args.failed) {
  const bad = new Set(readFileSync(args.failed, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((row) => !row.pass).map((row) => row.id));
  items = items.filter((item) => bad.has(item.id));
}
if (args.sample) { const n = Number(args.sample), step = items.length / n; items = Array.from({ length: Math.min(n, items.length) }, (_, k) => items[Math.floor(k * step)]); }
if (args.limit) items = items.slice(0, Number(args.limit));
const WORKERS = Math.max(1, Number(args.workers || 4));
const OUT = resolve(ROOT, args.out || `_work/frame-qa/${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
mkdirSync(join(OUT, 'shots'), { recursive: true });
const log = (...parts) => { const line = parts.join(' '); console.log(line); appendFileSync(join(OUT, 'run.log'), line + '\n'); };

// --root <폴더>: 그 폴더(작업 사본을 떠 둔 것)를 내보낸다 — 채점 중에 코드를 고쳐도 결과가 섞이지 않게.
const server = await startServer(0, args.root ? resolve(args.root) : undefined);
const origin = server.origin;

async function runBatch(browser, batch) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
  await page.goto(origin + '/__blank');
  await page.evaluate(async () => {
    window.__frame = await import('/exampool/frame.mjs');
    const viewer = await import('/pdf-viewer.mjs?v=frame-20261025-1');
    viewer.setPdfSource((name) => fetch('/__pdf/' + encodeURIComponent(name)).then((r) => { if (!r.ok) throw Error('PDF 없음 ' + name); return r.arrayBuffer(); }));
    await window.__frame.loadFrameEngine();
  });
  const out = [];
  for (const item of batch) {
    const q = library.get(item.id) || item, t0 = Date.now();
    const result = await Promise.race([page.evaluate(async ({ q, keep }) => {
      const f = window.__frame, timing = {};
      try {
        let t = performance.now();
        const { q: question, diag } = await f.frameQuestion(q);
        timing.convert = Math.round(performance.now() - t); t = performance.now();
        let typeset;
        try { typeset = await f.typesetFrame(structuredClone(question)); }
        catch (error) { return { ok: true, question, diag, typeset: { error: String(error?.message || error), status: '' }, timing }; }
        timing.typeset = Math.round(performance.now() - t);
        const Document = await f.loadFrameEngine(), doc = new Document(typeset.bytes);
        let text = '', eq = -1, eqScripts = [], warn = '';
        try {
          const raw = doc.getTextFileText(); text = raw.startsWith('"') ? JSON.parse(raw) : raw;
          const zip = await window.JSZip.loadAsync(typeset.bytes), xml = await zip.file('Contents/section0.xml').async('string');
          eq = (xml.match(/<hp:equation\b/g) || []).length; eqScripts = [...xml.matchAll(/<hp:script>([\s\S]*?)<\/hp:script>/g)].map((m) => m[1]).slice(0, 80);
        } finally { doc.free(); }
        let bytes = '';
        if (keep) { let raw = ''; for (let i = 0; i < typeset.bytes.length; i += 32768) raw += String.fromCharCode(...typeset.bytes.subarray(i, i + 32768)); bytes = btoa(raw); }
        // 모으기(기출 탐색기 한글 변환이 실제로 여는 문서): 문항 한 개 문서 → 시험지 문서에서 글이 그대로인지.
        let assemble = 'ok';
        // 폭 없는 글자(U+2060: 시험지 첫 빈 문단·줄 첫머리 수식 앞)는 보이지 않으므로 빼고 견준다.
        const flat = (value) => String(value).replace(/&#8288;/g, '').replace(/[\s\u2060]+/g, '');
        try {
          t = performance.now();
          const one = await f.assembleFrameCollection([{ id: q.id, bytes: typeset.bytes, height: typeset.height }]);
          timing.assemble = Math.round(performance.now() - t);
          const od = new Document(one);
          try { const raw = od.getTextFileText(), got = raw.startsWith('"') ? JSON.parse(raw) : raw; if (flat(got) !== flat(text)) assemble = '글 달라짐'; if (!od.getBookmarks().includes('exam_question_')) assemble = '이동 표시 없음'; } finally { od.free(); }
          (window.__docs ||= []).push({ id: q.id, bytes: typeset.bytes, height: typeset.height, text: flat(text) });
        } catch (error) { assemble = String(error?.message || error); }
        return { ok: true, question, diag, typeset: { text, eq, eqScripts, usedMm: Math.round(typeset.height * 10) / 10, status: warn, error: false, size: typeset.bytes.length }, timing, bytes, assemble };
      } catch (error) { return { ok: false, error: String(error?.message || error), timing }; }
    }, { q, keep: !!args['keep-bytes'] }), new Promise((ok) => setTimeout(() => ok({ ok: false, error: '시간 초과(120초)' }), 120000))]);
    result.ms = Date.now() - t0; result.id = item.id; out.push(result);
  }
  // 이 묶음(최대 20문항)을 한 시험지로 모아 문항 글이 모두 차례대로 들어가는지 본다.
  const collection = await page.evaluate(async () => {
    const docs = window.__docs || []; if (!docs.length) return 'none';
    try {
      const f = window.__frame, Document = await f.loadFrameEngine();
      const bytes = await f.assembleFrameCollection(docs.map(({ id, bytes, height }) => ({ id, bytes, height })));
      const d = new Document(bytes);
      try {
        const raw = d.getTextFileText(), all = (raw.startsWith('"') ? JSON.parse(raw) : raw).replace(/&#8288;/g, '').replace(/[\s\u2060]+/g, '');
        let at = 0; for (const doc of docs) { const k = all.indexOf(doc.text, at); if (k < 0) return `${doc.id} 글 빠짐`; at = k + doc.text.length; }
        const marks = JSON.parse(d.getBookmarks()).length; if (marks !== docs.length) return `이동 표시 ${marks}/${docs.length}`;
        return `ok ${docs.length}문항 ${d.pageCount()}쪽`;
      } finally { d.free(); }
    } catch (error) { return String(error?.message || error); }
  }).catch((error) => String(error.message));
  for (const row of out) row.collection = collection;
  if (!collection.startsWith('ok') && collection !== 'none') log(`  모으기 실패: ${collection}`);
  if (errors.length) log(`  pageerror ${errors.length}: ${errors[0]}`);
  await context.close();
  return out;
}

log(`frame-qa: ${items.length}문항 · 작업자 ${WORKERS} · 결과 ${relative(ROOT, OUT)}`);
const browser = await chromium.launch({ headless: true });
const results = join(OUT, 'results.jsonl'); writeFileSync(results, '');
const queue = [...items]; let done = 0; const CHUNK = Number(args.chunk || 20);
try {
  await Promise.all(Array.from({ length: WORKERS }, async (_, worker) => {
    while (queue.length) {
      const batch = queue.splice(0, CHUNK);
      let rows;
      try { rows = await runBatch(browser, batch); } catch (error) { rows = batch.map((item) => ({ id: item.id, ok: false, error: '작업 실패: ' + error.message })); }
      for (const row of rows) {
        const item = batch.find((x) => x.id === row.id);
        const q = row.question;
        const meta = corpusById.get(row.id) || item;
        const scored = reference[row.id] ? score(meta, reference[row.id], { ok: row.ok, question: q, diag: row.diag, error: row.error, ms: row.ms }, row.typeset)
          : { id: row.id, subject: item.subject, form: '(조사 기록 없음)', struct: String(item.year), pass: row.ok && !row.typeset?.error,
            checks: { convert: !!row.ok, typeset: !!row.ok && !row.typeset?.error },
            reasons: row.ok ? (row.typeset?.error ? ['typeset: ' + row.typeset.error] : []) : ['convert: ' + row.error], restoreReasons: [] };
        scored.timing = row.timing; scored.ms = row.ms; scored.size = row.typeset?.size; scored.assemble = row.assemble; scored.collection = row.collection;
        if (row.ok && row.assemble && row.assemble !== 'ok') { scored.pass = false; (scored.restoreReasons ||= []).push('assemble: ' + row.assemble); (scored.reasons ||= []).push('assemble: ' + row.assemble); }
        if (!scored.restoreReasons?.length && !scored.pass) scored.restoreReasons = scored.reasons;
        if (row.bytes) writeFileSync(join(OUT, 'shots', `${row.id}.hwpx`), Buffer.from(row.bytes, 'base64'));
        if (q) writeFileSync(join(OUT, 'shots', `${row.id}.json`), JSON.stringify({ question: q, typesetText: row.typeset?.text }));
        appendFileSync(results, JSON.stringify(scored) + '\n'); done++;
      }
      log(`  [w${worker}] ${done}/${items.length}`);
    }
  }));
} finally { await browser.close(); await server.close(); }

const rows = readFileSync(results, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const md = summarize(rows.filter((row) => reference[row.id]).length ? rows : rows);
const timing = rows.filter((r) => r.timing?.typeset).map((r) => r.timing.convert + r.timing.typeset).sort((a, b) => a - b);
const extra = timing.length ? `\n문항당 변환+조판 중앙값 ${timing[timing.length >> 1]}ms · 90% ${timing[Math.floor(timing.length * .9)]}ms\n` : '';
writeFileSync(join(OUT, 'summary.md'), md + extra); log(md + extra);
