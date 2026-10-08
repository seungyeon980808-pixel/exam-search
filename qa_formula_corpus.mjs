import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createPreparedHwpx } from './editable-convert.mjs';
import { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';

const root = new URL('.', import.meta.url);
const base = process.env.EXAM_SEARCH_URL || 'http://127.0.0.1:8813/';
const evidence = resolve(process.env.EXAM_CORPUS_EVIDENCE || `/tmp/exam-formula-corpus/baseline-${new Date().toISOString().replaceAll(':', '-')}`);
const localRoot = '/Users/parkseungyeon/Documents/Codex/2026-09-06/x20/exam-search-public';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(join(evidence, 'raw'), { recursive: true });
await mkdir(join(evidence, 'fonts'), { recursive: true });
await mkdir(join(evidence, 'source'), { recursive: true });
await mkdir(join(evidence, 'hwpx'), { recursive: true });
const files = JSON.parse(await readFile(new URL('data/files.json', root)));
const catalog = JSON.parse(await readFile(new URL('data/questions.json', root))).items;
const selected = new Map();
const add = (question) => selected.set(question.id, question);
catalog.filter((question) => question.pdfFile.includes('74e7e4a61455')).forEach(add);
catalog.filter((question) => question.pdfFile === 'p1_2027_06.pdf').forEach(add);
for (const subject of ['b1', 'b2', 'c1', 'c2', 'e1', 'e2', 'p2']) {
  const pool = catalog.filter((question) => question.subject === subject && question.year >= 2020);
  [pool[0], pool[Math.floor(pool.length / 2)], pool.at(-1)].filter(Boolean).forEach(add);
}
let questions = [...selected.values()];
if (process.env.EXAM_CORPUS_IDS) questions = catalog.filter((question) => process.env.EXAM_CORPUS_IDS.split(',').includes(question.id));
if (process.env.EXAM_CORPUS_LIMIT) questions = questions.slice(0, Number(process.env.EXAM_CORPUS_LIMIT));
const snapshot = new Map();
for (const name of (await readdir(root)).filter((name) => name.endsWith('.mjs'))) {
  const bytes = await readFile(new URL(name, root));
  snapshot.set(`/${name}`, bytes);
  await writeFile(join(evidence, 'source', name), bytes, { flag: 'wx' });
}
for (const name of ['data/editable/glyph-proofs.json', 'data/files.json']) {
  const bytes = await readFile(new URL(name, root));
  snapshot.set(`/${name}`, bytes);
  await writeFile(join(evidence, 'source', basename(name)), bytes, { flag: 'wx' });
}
async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.name.endsWith('.pdf')) paths.push(path);
  }
  return paths;
}
const localPdfs = [...await walk(join(localRoot, 'pdfs')), ...await walk(join(localRoot, '기출확장_국영수사탐'))];
const paths = new Map();
const inputs = [];
for (const pdfFile of new Set(questions.map((question) => question.pdfFile))) {
  const file = files.find((entry) => entry.pdfFile === pdfFile);
  const suffix = file.sourceSha256?.slice(0, 12);
  const path = localPdfs.find((path) => suffix ? basename(path).endsWith(`_${suffix}.pdf`) : basename(path) === file.pdfFile);
  if (!path) throw new Error(`Local PDF missing: ${pdfFile}`);
  const bytes = await readFile(path);
  const digest = sha(bytes);
  if (file.sourceSha256 && digest !== file.sourceSha256) throw new Error(`PDF hash mismatch: ${pdfFile}`);
  paths.set(file.publicPath, path);
  paths.set(file.publicPath.replace(/^기출문제\/기출확장_국영수사탐\//u, ''), path);
  inputs.push({ pdfFile, path, sha256: digest, bytes: bytes.length });
}
await writeFile(join(evidence, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), invocation: `EXAM_SEARCH_URL=${base} EXAM_CORPUS_EVIDENCE=${evidence} node qa_formula_corpus.mjs`, base, questions, inputs, sourceHashes: Object.fromEntries([...snapshot].map(([name, bytes]) => [name, sha(bytes)])) }, null, 2), { flag: 'wx' });
console.log(`WORKING: frozen ${snapshot.size} sources; ${questions.length} questions; evidence ${evidence}`);
const browser = await chromium.launch({ headless: true });
const rows = [];
const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin) {
      const frozen = snapshot.get(url.pathname);
      if (frozen) return route.fulfill({ body: frozen, contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript' });
      return route.continue();
    }
    const publicPath = url.pathname.split('/public/')[1]?.split('/').map(decodeURIComponent).join('/');
    const path = paths.get(publicPath);
    if (!path) return route.fulfill({ status: 404, body: 'Outside local corpus; network disabled' });
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: await readFile(path), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(base);
  for (const question of questions) {
    const result = await page.evaluate(async (question) => {
      const { readQuestionPdf } = await import('./pdf-viewer.mjs?v=library-20261008-3');
      const { verifiedGlyphMap, inQuestion } = await import('./live-fonts.mjs');
      const { buildLiveStructure } = await import('./live-convert.mjs');
      let pdf, map;
      const result = { id: question.id, subject: question.subject, pdfFile: question.pdfFile, page: question.page, stages: {}, scripts: [], fonts: [], privateUse: [] };
      for (const stage of ['readQuestionPdf', 'verifiedGlyphMap', 'buildLiveStructure']) {
        const start = performance.now();
        try {
          if (stage === 'readQuestionPdf') {
            pdf = await readQuestionPdf(question);
            const relevant = pdf.content.items.filter((item) => inQuestion(item, question, pdf.pageHeight));
            result.fonts = [...new Set(relevant.map((item) => item.fontName))].map((id) => ({ id, name: pdf.fonts[id]?.name, bytes: pdf.fonts[id]?.data?.length || 0 }));
            result.privateUse = [...new Set(relevant.flatMap((item) => [...item.str].filter((char) => /[\uE000-\uF8FF]/u.test(char)).map((char) => `${item.fontName}:${char.codePointAt(0)}`)))];
            result.textSample = relevant.map((item) => item.str).join(' ').slice(0, 1200);
          } else if (stage === 'verifiedGlyphMap') {
            map = await verifiedGlyphMap(question, pdf);
            result.glyphMap = [...map];
          } else {
            const structure = buildLiveStructure(question, pdf, map);
            result.scripts = structure.blocks.flatMap((block) => block.runs.filter((run) => run.kind === 'equation').map((run) => run.script));
            result.choices = structure.blocks.filter((block) => block.role === 'choice').length;
            result.structure = structure;
          }
          result.stages[stage] = { pass: true, milliseconds: Math.round(performance.now() - start) };
        } catch (error) {
          result.stages[stage] = { pass: false, error: error.message, milliseconds: Math.round(performance.now() - start) };
          result.failedStage = stage;
          break;
        }
      }
      result.pass = !result.failedStage;
      if (pdf && question.subject === 'math' && (!result.pass || question.no <= 2)) {
        result.raw = { question, content: pdf.content, equationItems: pdf.equationItems, glyphs: pdf.glyphs, pageHeight: pdf.pageHeight, fonts: Object.fromEntries(Object.entries(pdf.fonts).map(([id, font]) => [id, { name: font.name, data: font.data ? Array.from(font.data) : null }])) };
        if (question.no <= 2) {
          const pdfjs = await import('./vendor/pdfjs/pdf.mjs');
          const { driveFilePath } = await import('./data.mjs?v=library-20261008-3');
          const { downloadDriveFile } = await import('./drive-source.mjs');
          const task = pdfjs.getDocument({ data: new Uint8Array(await downloadDriveFile(driveFilePath(question.pdfFile))), fontExtraProperties: true, cMapUrl: new URL('./vendor/pdfjs/cmaps/', location.href).href, cMapPacked: true, standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', location.href).href });
          try {
            const document = await task.promise;
            const page = await document.getPage(question.page);
            const operations = await page.getOperatorList();
            const names = Object.fromEntries(Object.entries(pdfjs.OPS).map(([name, id]) => [id, name]));
            result.raw.operatorSamples = operations.fnArray.map((id, index) => ({ name: names[id], args: operations.argsArray[index] })).filter((operation) => ['setFont', 'setTextMatrix', 'showText', 'moveText', 'setCharSpacing', 'setHScale', 'setTextRise'].includes(operation.name)).slice(0, 200);
          } finally { await task.destroy(); }
        }
      }
      return result;
    }, question);
    if (result.raw) {
      for (const font of Object.values(result.raw.fonts)) {
        if (!font.data) continue;
        const bytes = Buffer.from(font.data);
        const name = `${sha(bytes)}.bin`;
        await writeFile(join(evidence, 'fonts', name), bytes);
        font.dataPath = `../fonts/${name}`;
        font.sha256 = sha(bytes);
        font.bytes = bytes.length;
        delete font.data;
      }
      result.rawPath = `raw/${question.id}.json`;
      await writeFile(join(evidence, result.rawPath), JSON.stringify(result.raw));
      delete result.raw;
    }
    if (result.pass) {
      let bytes, document;
      for (const stage of ['createPreparedHwpx', 'reloadEquationControls', 'editExportReload']) {
        if (stage === 'editExportReload' && result.scripts.length === 0) break;
        const start = performance.now();
        try {
          if (stage === 'createPreparedHwpx') {
            bytes = await createPreparedHwpx(result.structure);
            result.hwpxPath = `hwpx/${question.id}.hwpx`;
            await writeFile(join(evidence, result.hwpxPath), bytes);
            result.hwpxSha256 = sha(bytes);
          } else if (stage === 'reloadEquationControls') {
            document = new HwpDocument(bytes);
            const controls = JSON.parse(document.getControls()).filter((control) => control.ctrlId === 'eqed');
            assert.equal(controls.length, result.scripts.length, 'Reloaded eqed count must equal source equation runs');
            result.hwpxScripts = controls.map((control) => JSON.parse(document.getEquationProperties(control.list, control.para, control.controlIndex, -1, -1)).script);
            assert.ok(result.hwpxScripts.every((script) => typeof script === 'string' && script.trim().length > 0), 'Every equation script must be nonempty');
            result.equationControls = controls;
          } else {
            const first = result.equationControls[0];
            const script = 'x_{98765}+1';
            assert.notEqual(result.hwpxScripts[0], script);
            const changed = JSON.parse(document.setEquationProperties(first.list, first.para, first.controlIndex, -1, -1, JSON.stringify({ script })));
            assert.equal(changed.ok, true, 'Changing first equation must succeed');
            const editedBytes = document.exportHwpx();
            result.editedHwpxPath = `hwpx/${question.id}-edited.hwpx`;
            await writeFile(join(evidence, result.editedHwpxPath), editedBytes);
            result.editedHwpxSha256 = sha(editedBytes);
            const reopened = new HwpDocument(editedBytes);
            try {
              const controls = JSON.parse(reopened.getControls()).filter((control) => control.ctrlId === 'eqed');
              assert.equal(controls.length, result.scripts.length, 'Editing must preserve the equation count');
              const edited = JSON.parse(reopened.getEquationProperties(first.list, first.para, first.controlIndex, -1, -1));
              assert.equal(edited.script, script, 'Edited equation must survive export and reload');
              result.retainedEdit = edited.script;
            } finally { reopened.free(); }
          }
          result.stages[stage] = { pass: true, milliseconds: Math.round(performance.now() - start) };
        } catch (error) {
          result.stages[stage] = { pass: false, error: error.message, milliseconds: Math.round(performance.now() - start) };
          result.failedStage = stage;
          result.pass = false;
          break;
        }
      }
      document?.free();
    }
    rows.push(result);
    await writeFile(join(evidence, 'results.json'), JSON.stringify(rows, null, 2));
    console.log(`${rows.length}/${questions.length} ${question.id}: ${result.pass ? `PASS ${result.scripts.length} equations` : `${result.failedStage}: ${result.stages[result.failedStage].error}`}`);
  }
  const counts = {};
  for (const row of rows) {
    const category = row.pass ? 'pass' : `${row.failedStage}: ${row.stages[row.failedStage].error.replace(/\d+/gu, '#')}`;
    counts[category] = (counts[category] || 0) + 1;
  }
  const report = { total: rows.length, passed: rows.filter((row) => row.pass).length, failed: rows.filter((row) => !row.pass).length, counts, pageErrors, artifact: evidence, hwpxReloads: rows.filter((row) => row.stages.reloadEquationControls?.pass).length, editRoundtrips: rows.filter((row) => row.stages.editExportReload?.pass).length, zeroEquationDocuments: rows.filter((row) => row.pass && row.scripts.length === 0).length, criterion: 'Each selected question invokes readQuestionPdf → verifiedGlyphMap → buildLiveStructure → createPreparedHwpx → reloadEquationControls. Documents containing equations additionally edit the first equation and export/reload to verify persistence. Pass verifies controls and edit persistence, not semantic formula correctness.', bySubject: Object.fromEntries([...new Set(rows.map((row) => row.subject))].map((subject) => [subject, { total: rows.filter((row) => row.subject === subject).length, passed: rows.filter((row) => row.subject === subject && row.pass).length }])) };
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
