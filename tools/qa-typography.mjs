// Run against local original PDFs; keep extraction failures distinct from layout failures.
import fs, { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { resolve, join, basename } from 'node:path';

const root = new URL('../', import.meta.url);
const evidence = resolve(process.env.EXAM_LAYOUT_EVIDENCE || '.omo/evidence/1003-typography');
const originals = process.env.EXAM_LOCAL_PDFS;
const mathOriginal = process.env.EXAM_MATH_PDF;
if (!originals || !mathOriginal || !process.env.EXAM_CANVAS_MODULE)
  throw new Error('Set EXAM_LOCAL_PDFS, EXAM_MATH_PDF and EXAM_CANVAS_MODULE to the local originals and canvas module.');
const { default: canvas } = await import(process.env.EXAM_CANVAS_MODULE);
Object.assign(globalThis, { DOMMatrix: canvas.DOMMatrix, ImageData: canvas.ImageData, Path2D: canvas.Path2D });
globalThis.location = new URL('http://127.0.0.1:8813/');
const originalRead = fs.readFile;
fs.readFile = (path, ...args) => originalRead(typeof path === 'string' && path.startsWith('file:') ? new URL(path) : path, ...args);
globalThis.fetch = async (resource) => {
  const url = resource instanceof URL ? resource : new URL(String(resource), root);
  if (url.protocol === 'file:') {
    try { return new Response(await readFile(fileURLToPath(url)), { status: 200 }); }
    catch (error) { if (error.code === 'ENOENT') return new Response('', { status: 404 }); throw error; }
  }
  const publicPath = url.pathname.split('/public/')[1];
  if (!publicPath) throw new Error(`Unexpected external request: ${url.origin}`);
  const name = decodeURIComponent(publicPath).split('/').at(-1);
  const path = name.includes('acb936d9a4c4') ? mathOriginal : join(originals, name);
  return new Response(await readFile(path), { status: 200 });
};
await import(new URL('vendor/pdfjs/pdf.worker.mjs', root));
const { getJson } = await import(new URL('data.mjs', root));
const { readQuestionPdf } = await import(new URL('pdf-viewer.mjs', root));
const { verifiedGlyphMap, inQuestion } = await import(new URL('live-fonts.mjs', root));
const { buildLiveStructure } = await import(new URL('live-convert.mjs', root));
await getJson('/api/status');
const { items } = JSON.parse(await readFile(new URL('data/questions.json', root), 'utf8'));
const mathIds = [1, 3, 4, 10, 12].map((no) => `2021_11_math_ga_odd_${String(no).padStart(2, '0')}`);
const subjects = ['p1', 'p2', 'c1', 'c2', 'b1', 'b2', 'e1', 'e2'];
const ids = process.env.EXAM_LAYOUT_IDS?.split(',') || [...mathIds,
  ...subjects.flatMap((subject) => [1, 11, 20].map((no) => `${subject}_2027_06_${String(no).padStart(2, '0')}`))];
await mkdir(evidence, { recursive: true });
await mkdir(join(evidence, 'structures'), { recursive: true });
await mkdir(join(evidence, 'output'), { recursive: true });
const prepared = [];
for (const id of ids) {
  const cache = join(evidence, 'structures', `${id}.json`);
  let fixture;
  try { fixture = JSON.parse(await readFile(cache, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const question = items.find((item) => item.id === id);
    assert.ok(question, `Missing question ${id}`);
    const source = question.subject === 'math' ? mathOriginal : join(originals, question.pdfFile);
    const bytes = await readFile(source);
    const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    if (question.sourceSha256) assert.equal(sourceSha256, question.sourceSha256);
    fixture = { id, subject: question.subject, question, source: { basename: basename(source), sha256: sourceSha256 } };
    try {
      const pdf = await readQuestionPdf(question);
      const glyphMap = await verifiedGlyphMap(question, pdf);
      fixture.structure = buildLiveStructure(question, pdf, glyphMap);
      fixture.pdf = { pageNumber: pdf.pageNumber, pageHeight: pdf.pageHeight, pageWidth: pdf.pageWidth,
        content: { items: pdf.content.items.filter((item) => inQuestion(item, question, pdf.pageHeight)), styles: pdf.content.styles },
        equationItems: pdf.equationItems.filter((item) => inQuestion(item, question, pdf.pageHeight)),
        fonts: Object.fromEntries(Object.entries(pdf.fonts).map(([key, font]) => [key, { name: font.name, fontMatrix: font.fontMatrix }])),
        glyphs: pdf.glyphs, operations: pdf.operations, OPS: pdf.OPS };
      fixture.glyphMap = [...glyphMap];
      fixture.emptyBlocks = fixture.structure.blocks.filter((block) => !block.runs?.length && !['table', 'figure'].includes(block.kind)).map((block) => block.role);
    } catch (error) { fixture.extractionError = error.message; }
    await writeFile(cache, JSON.stringify(fixture, (_key, value) => ArrayBuffer.isView(value) ? [...value] : value) + '\n');
  }
  if (fixture.structure) {
    fixture.emptyBlocks = fixture.structure.blocks.filter((block) => !block.runs?.length && !['table', 'figure'].includes(block.kind)).map((block) => block.role);
    // Rebuild from the frozen original geometry when extraction code changes.
    fixture.structure = buildLiveStructure(fixture.question, fixture.pdf, new Map(fixture.glyphMap));
  }
  prepared.push(fixture);
  console.log(`${id}: ${fixture.extractionError ? `EXTRACTION FAIL ${fixture.extractionError}` : `prepared ${fixture.structure.blocks.length} blocks`}`);
}
await writeFile(join(evidence, 'prepared.json'), JSON.stringify(prepared.map(({ pdf, glyphMap, ...rest }) => rest), null, 2));
if (process.argv.includes('--prepare-only')) process.exit(0);

const { createPreparedHwpx, createCollectionHwpx, paragraphsForPrepared, equationScript, groupFractions } = await import(new URL('editable-convert.mjs', root));
const { equationLineCollisions } = await import(new URL('equation-spacing.mjs', root));
const { documentScripts, documentText } = await import(new URL('test-hwpx-content.mjs', root));
const { HwpDocument } = await import(new URL('vendor/rhwp-studio/assets/rhwp-core.js', root));
const { execFileSync } = await import('node:child_process');
const normalized = (script) => groupFractions(equationScript(script));
const results = [];
for (const fixture of prepared) {
  const result = { id: fixture.id, subject: fixture.subject, source: fixture.source,
    emptyBlocks: fixture.emptyBlocks, pass: false, stages: {} };
  if (fixture.extractionError) { result.extractionError = fixture.extractionError; results.push(result); continue; }
  const sourceScripts = fixture.structure.blocks.flatMap((block) => block.kind === 'table' ? block.rows.flat(2) : block.runs || [])
    .filter((run) => run.kind === 'equation').map((run) => normalized(run.script));
  const nativeTables = fixture.structure.blocks.filter((block) => block.kind === 'table');
  try {
    const bytes = await createPreparedHwpx(fixture.structure);
    const path = join(evidence, 'output', `${fixture.id}.hwpx`);
    await writeFile(path, bytes);
    const xml = execFileSync('unzip', ['-p', path, 'Contents/section0.xml'], { encoding: 'utf8' });
    const scripts = documentScripts(bytes);
    assert.deepEqual(scripts, sourceScripts, 'Equation scripts changed');
    result.equationCount = scripts.length;
    result.stages.content = { pass: true, nativeTables: nativeTables.length };
    const doc = new HwpDocument(bytes);
    try {
      assert.deepEqual(equationLineCollisions(doc), [], 'Saved layout contains overlapping rows');
      const fonts = new Set();
      let pages = [];
      for (let page = 0; page < doc.pageCount(); page += 1) {
        const info = JSON.parse(doc.getPageInfo(page));
        const controls = JSON.parse(doc.getPageControlLayout(page)).controls;
        for (const run of JSON.parse(doc.getPageTextLayout(page)).runs) {
          if (run.text.trim()) {
            assert.ok(Math.abs(run.fontSize - 1000 / 75) <= .05, `Text size is inconsistent: ${run.fontSize}`);
            fonts.add(1000);
          }
        }
        for (const control of controls.filter((item) => ['equation', 'table'].includes(item.type))) {
          assert.ok(control.y + control.h <= info.footerArea.y + 1, `Control exceeds footer: ${JSON.stringify(control)}`);
          assert.ok(control.x + control.w <= info.columns[0].x + info.columns[0].width + 1, 'Control exceeds left column');
        }
        pages.push({ page, controls });
        await writeFile(join(evidence, 'output', `${fixture.id}-${page + 1}.svg`), doc.renderPageSvg(page));
      }
      assert.deepEqual([...fonts].sort(), [1000], `Text size is inconsistent: ${[...fonts]}`);
      result.textSizes = [...fonts];
      const equationSizes = [...xml.matchAll(/<hp:equation\b[^>]*?\bbaseUnit="(\d+)"/g)].map((match) => Number(match[1]));
      assert.ok(equationSizes.every((size) => size === 1000), `Equation size is inconsistent: ${equationSizes}`);
      result.equationSizes = [...new Set(equationSizes)];
      result.pages = doc.pageCount();
      result.stages.layout = { pass: true };
      const first = pages.flatMap((page) => page.controls).find((control) => control.type === 'equation');
      if (first) {
        assert.equal(JSON.parse(doc.setEquationProperties(first.secIdx, first.paraIdx, first.controlIdx,
          first.cellIdx ?? -1, first.cellParaIdx ?? -1, JSON.stringify({ script: 'x_{98765}+1' }))).ok, true);
        const editedBytes = doc.exportHwpx();
        assert.equal(documentScripts(editedBytes).filter((script) => script === 'x_{98765}+1').length, 1);
        assert.equal(documentScripts(editedBytes).length, scripts.length);
        const reopened = new HwpDocument(editedBytes);
        try { assert.deepEqual(equationLineCollisions(reopened), []); } finally { reopened.free(); }
      }
      result.stages.editReload = { pass: true };
      result.pass = true;
    } finally { doc.free(); }
  } catch (error) { result.error = error?.message || String(error); }
  results.push(result);
  await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`${fixture.id}: ${result.pass ? 'PASS' : `FAIL ${result.error}`}`);
}

const successful = prepared.filter((fixture) => !fixture.extractionError);
const collection = successful.filter((fixture) => fixture.subject === 'math').map((fixture) => ({ question: fixture.question,
  questionId: fixture.id, sourceLabel: fixture.id, paragraphs: paragraphsForPrepared(fixture.structure) }));
const collectionResults = [];
for (const pagePerQuestion of collection.length ? [false, true] : []) {
  try {
    const bytes = await createCollectionHwpx(collection, { pagePerQuestion });
    const doc = new HwpDocument(bytes);
    try {
      assert.deepEqual(equationLineCollisions(doc), []);
      await writeFile(join(evidence, 'output', `math-collection-${pagePerQuestion ? 'per-question' : 'continuous'}.hwpx`), bytes);
      for (let page = 0; page < doc.pageCount(); page += 1)
        await writeFile(join(evidence, 'output', `math-collection-${pagePerQuestion ? 'per-question' : 'continuous'}-${page + 1}.svg`), doc.renderPageSvg(page));
      collectionResults.push({ pagePerQuestion, pass: true, pages: doc.pageCount() });
    } finally { doc.free(); }
  } catch (error) { collectionResults.push({ pagePerQuestion, pass: false, error: error?.message || String(error) }); }
}
await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2));
await writeFile(join(evidence, 'summary.json'), JSON.stringify({ questions: results.length,
  passes: results.filter((result) => result.pass).length,
  failures: results.filter((result) => !result.pass), collections: collectionResults,
  nativeHancom: 'Unavailable locally; rHWP is installed, Hancom Hangul is not.' }, null, 2));
console.log(JSON.stringify({ passes: results.filter((result) => result.pass).length, total: results.length, collections: collectionResults }));
if (results.some((result) => !result.pass) || collectionResults.some((result) => !result.pass)) process.exitCode = 1;
