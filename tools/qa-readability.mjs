// Actual application conversion path. Run with a local PDF preview server on 8813.
// Example: node tools/qa-readability.mjs --phase final --ids b2_2025_11_20
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const circleChoices = [...'①②③④⑤'];
const compact = (text) => String(text || '').normalize('NFC').replace(/\s+/gu, '');
const finiteBox = (box) => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1];
const covers = (outer, inner, margin = 1) => finiteBox(outer) && finiteBox(inner)
  && outer[0] <= inner[0] + margin && outer[1] <= inner[1] + margin
  && outer[2] >= inner[2] - margin && outer[3] >= inner[3] - margin;
const check = (name, status, detail) => ({ name, status, ...(detail === undefined ? {} : { detail }) });
const passFail = (name, pass, detail) => check(name, pass ? 'pass' : 'fail', detail);

export function sourceChargePairs(items) {
  // Only attest separated charge glyphs near a source formula; never infer a digit subscript.
  const pairs = [];
  for (const base of items.filter((item) => /(?:NH4|NO3)/u.test(item.text))) {
    const normalizeCharge = (text) => text.trim().normalize('NFKC').replace(/−/gu, '-');
    const charges = items.filter((item) => /^[+\-]$/u.test(normalizeCharge(item.text))
      && item.x >= base.x && item.x <= base.x + base.w + Math.max(base.h, 10)
      && Math.abs(item.y - base.y) < Math.max(base.h * 1.5, 15));
    const observed = charges.map((item) => ({ text: item.text, normalized: normalizeCharge(item.text), x: item.x, y: item.y }));
    const signs = [...new Set(observed.map((item) => item.normalized))];
    pairs.push({ base: base.text, baseBox: [base.x, base.y, base.x + base.w, base.y + base.h],
      expected: signs.length === 1 ? signs[0] : null, observed });
  }
  return pairs;
}

export function qualityChecks(mode, criticalRegions = []) {
  const checks = [];
  const quality = mode.quality;
  if (!quality) {
    checks.push(check('content-quality-contract', 'fail', 'Actual resolver returned no observed-source quality status.'));
    return checks;
  }
  const regions = quality.regions || [];
  const unresolved = regions.filter((region) => region.state === 'unresolved');
  const excluded = regions.filter((region) => region.state === 'excluded');
  checks.push(passFail('content-quality-contract', quality.scope === 'observed-source-regions'
    && quality.unresolvedCount === unresolved.length && quality.excludedCount === excluded.length
    && ['review', 'incomplete', 'unverified', 'excluded'].includes(quality.state), quality));
  checks.push(passFail('missing-regions-are-explicit', !unresolved.length
    || quality.state === 'incomplete' && mode.warnings?.length > 0, { unresolved: unresolved.map((r) => r.id), warnings: mode.warnings }));
  if (quality.state === 'unverified') checks.push(check('source-region-coverage', 'uncovered', 'No trustworthy source inventory; conversion is not fully verified.'));
  else if (unresolved.length) checks.push(check('source-region-coverage', 'fail', unresolved));
  else if (excluded.length) checks.push(check('source-region-coverage', 'acknowledged-exclusion', excluded.map((r) => ({ id: r.id, kind: r.kind, box: r.box }))));
  else checks.push(check('source-region-coverage', 'pass', `${regions.length} observed regions accounted for.`));
  const figures = (mode.nativeRuns || []).filter((run) => run.kind === 'figure');
  const tables = (mode.nativeRuns || []).filter((run) => run.kind === 'table');
  for (const region of regions.filter((r) => r.state === 'image')) {
    checks.push(passFail(`region-image:${region.id}`, mode.includeImages && figures.some((run) =>
      (run.sourcePage || mode.sourcePage) === region.page && covers(run.sourceBox, region.box)), region));
  }
  if (!mode.includeImages) checks.push(passFail('image-exclusion-option', figures.length === 0, { figures: figures.length }));
  for (const region of criticalRegions) {
    const visible = figures.some((run) => (run.sourcePage || mode.sourcePage) === region.page && covers(run.sourceBox, region.box))
      || tables.some((run) => (run.table?.sourcePage || mode.sourcePage) === region.page && covers(run.table?.sourceBox, region.box));
    const excludedByContract = regions.some((r) => r.state === 'excluded' && r.page === region.page && covers(r.box, region.box));
    checks.push(check(`critical-source-region:${region.label}`, visible ? 'pass'
      : !mode.includeImages && excludedByContract ? 'acknowledged-exclusion' : 'fail', { ...region, visible, excludedByContract }));
  }
  return checks;
}

export function controlBounds(pages) {
  const failures = [];
  for (const page of pages) {
    const column = page.info.columns?.[0];
    const footerY = page.info.footerArea?.y;
    for (const control of page.controls.filter((c) => ['equation', 'table', 'picture', 'image'].includes(c.type))) {
      if (![control.x, control.y, control.w, control.h].every(Number.isFinite) || control.w <= 0 || control.h <= 0) {
        failures.push({ page: page.page, type: 'invalid-control-box', control }); continue;
      }
      if (column && (control.x < column.x - 1 || control.x + control.w > column.x + column.width + 1))
        failures.push({ page: page.page, type: 'outside-left-column', control, column });
      if (Number.isFinite(footerY) && control.y + control.h > footerY + 1)
        failures.push({ page: page.page, type: 'below-body', control, footerY });
    }
  }
  return failures;
}

export function textBounds(pages) {
  const findings = [];
  for (const page of pages) {
    const column = page.info.columns?.[0], footerY = page.info.footerArea?.y;
    for (const run of (page.textRuns || []).filter((run) => run.text.trim())) {
      // Native API geometry; horizontal overflow is independent of font ascent.
      if (![run.x, run.y, run.w, run.h].every(Number.isFinite)) continue;
      const excerpt = { text: run.text, x: run.x, y: run.y, w: run.w, h: run.h, fontSize: run.fontSize,
        address: [run.secIdx, run.parentParaIdx ?? run.paraIdx, run.controlIdx ?? -1, run.cellIdx ?? -1, run.cellParaIdx ?? -1] };
      if (column && (run.x < column.x - 1 || run.x + run.w > column.x + column.width + 1)) findings.push({ page: page.page,
        type: 'text-outside-left-column', run: excerpt, column, right: run.x + run.w, excess: run.x + run.w - column.x - column.width,
        scope: 'native-text-layout-horizontal-geometry' });
      if (Number.isFinite(footerY) && run.y + run.h > footerY + 1) findings.push({ page: page.page,
        type: 'text-below-body', run: excerpt, footerY, scope: 'native-text-layout-vertical-metric-needs-glyph-review' });
    }
  }
  return findings;
}

export function horizontalInlineCollisions(pages) {
  const findings = [];
  const context = (item, text) => JSON.stringify(item.cellIdx === undefined ? [item.secIdx, item.paraIdx]
    : [item.secIdx, text ? item.parentParaIdx : item.paraIdx, item.controlIdx, item.cellIdx, item.cellParaIdx]);
  for (const page of pages) {
    const texts = (page.textRuns || []).filter((run) => run.text.trim());
    for (const equation of page.controls.filter((c) => c.type === 'equation')) {
      for (const text of texts.filter((run) => context(run, true) === context(equation, false))) {
        const vertical = Math.min(text.y + text.h, equation.y + equation.h) - Math.max(text.y, equation.y);
        const horizontal = Math.min(text.x + text.w, equation.x + equation.w) - Math.max(text.x, equation.x);
        if (vertical > Math.min(text.h, equation.h) * .3 && horizontal > 1) findings.push({ page: page.page, text: text.text,
          textBox: [text.x, text.y, text.w, text.h], equation, overlap: horizontal, scope: 'native-inline-box-geometry' });
      }
    }
  }
  return findings;
}

export function renderedProseFindings(mode, reference = '') {
  // Report attested broken words, not arbitrary short lines in poetry, diagrams or choices.
  const suspect = [];
  const referenceWords = new Set((reference.normalize('NFC').match(/[가-힣A-Za-z]{3,}/gu) || []));
  const rows = [];
  for (const page of mode.pages || []) {
    const groups = new Map();
    for (const run of page.textRuns || []) {
      if (run.cellIdx !== undefined || !run.text.trim()) continue;
      const address = `${page.page}:${run.secIdx}:${run.paraIdx}:${Math.round(run.y * 10)}`;
      const group = groups.get(address) || { page: page.page, secIdx: run.secIdx, paraIdx: run.paraIdx, y: run.y, runs: [] };
      group.runs.push(run); groups.set(address, group);
    }
    rows.push(...[...groups.values()].map((g) => ({ ...g, text: g.runs.sort((a, b) => a.x - b.x).map((r) => r.text).join('') })));
  }
  const singletonRows = rows.filter((row) => /^[가-힣]$/u.test(row.text.trim()));
  // A PDF physical wrap persisted as a paragraph boundary can be distinguished from a real native soft wrap.
  const paragraphs = (mode.paragraphText || []).map((text) => text.trim());
  for (let i = 0; i < paragraphs.length - 1; i++) {
    if (/^[①②③④⑤◦○<［[(]/u.test(paragraphs[i + 1])) continue;
    const left = paragraphs[i].match(/([가-힣A-Za-z]+)$/u)?.[1];
    const right = paragraphs[i + 1].match(/^([가-힣A-Za-z]+)/u)?.[1];
    if (left && right && referenceWords.has(left + right)) suspect.push({ boundary: i, left, right, attested: left + right });
  }
  return { attestedParagraphWordBreaks: suspect, singletonRows: singletonRows.map(({ runs, ...row }) => row),
    physicalLines: rows.length, nativeParagraphs: paragraphs.filter(Boolean).length };
}

export function analyzeMode(record, mode, expectations = {}) {
  if (mode.error) return [check('actual-resolver-conversion', 'fail', mode.error)];
  const checks = [passFail('actual-resolver-conversion', ['pdf', 'prepared'].includes(mode.provenance), mode.provenance),
    ...qualityChecks(mode, expectations.criticalRegions || [])];
  if (record.sourceSha256) checks.push(passFail('original-pdf-source-hash', record.actualSource?.sha256 === record.sourceSha256,
    { expected: record.sourceSha256, actual: record.actualSource?.sha256 }));
  else checks.push(check('original-pdf-catalog-hash', 'uncovered', 'Original file was hashed, but this catalog record has no sourceSha256 oracle.'));
  const nativeContent = (mode.nativeContent || '') + (mode.scripts || []).join('');
  const expectedChoices = circleChoices.filter((c) => record.questionText?.includes(c));
  const missingChoices = expectedChoices.filter((c) => !nativeContent.includes(c));
  checks.push(passFail('source-choice-labels-preserved', missingChoices.length === 0, { expected: expectedChoices, missing: missingChoices }));
  checks.push(passFail('serialized-equation-scripts-preserved', JSON.stringify(mode.scripts || []) === JSON.stringify(mode.sourceScripts || []),
    { sourceCount: mode.sourceScripts?.length, savedCount: mode.scripts?.length }));
  for (const charge of expectations.nativeCharges || []) {
    const exact = compact(nativeContent).includes(charge);
    const scripted = charge === 'NH4⁺' ? /NH\s*_?\s*\{?4\}?\s*\^\s*\{?\+\}?/u.test(nativeContent)
      : /NO\s*_?\s*\{?3\}?\s*\^\s*\{?[−-]\}?/u.test(nativeContent);
    checks.push(passFail(`native-charge:${charge}`, exact || scripted, { sourcePairs: record.sourceChargePairs, exact, scripted }));
  }
  if (expectations.nativeCharges?.length) {
    checks.push(passFail('source-charge-positional-proof', expectations.nativeCharges.every((charge) => (record.sourceChargePairs || []).some((pair) =>
      pair.base.includes(charge.slice(0, -1)) && pair.expected === (charge.endsWith('⁺') ? '+' : '-'))), record.sourceChargePairs));
    if ((record.sourceChargePairs || []).some((pair) => pair.expected === null)) checks.push(check('source-charge-sign-ambiguity', 'uncovered',
      'No unique source charge glyph; chemistry knowledge is not used to fill in a sign.'));
    checks.push(check('charge-digit-subscript-source-proof', 'uncovered',
      'PDF.js merged 4/3 into the formula text item. Superscript charge is checked; digit subscript is not inferred.'));
  }
  if (record.id === 'b1_2025_11_20') {
    const sequence = mode.paragraphStructure || [];
    const tableA = sequence.findIndex((p) => p.tableColumns === 1);
    const captionA = sequence.findIndex((p, i) => i > tableA && /^\(가\)$/u.test(compact(p.text)));
    const tableB = sequence.findIndex((p, i) => i > captionA && p.tableColumns === 2);
    const captionB = sequence.findIndex((p, i) => i > tableB && /^\(나\)$/u.test(compact(p.text)));
    checks.push(passFail('nitrogen-data-caption-order', tableA >= 0 && captionA > tableA && tableB > captionA && captionB > tableB,
      { tableA, captionA, tableB, captionB, sequence }));
  }
  const bounds = controlBounds(mode.pages || []);
  checks.push(passFail('native-control-bounds', bounds.length === 0, bounds));
  const texts = textBounds(mode.pages || []), horizontal = texts.filter((f) => f.type === 'text-outside-left-column');
  checks.push(passFail('native-text-horizontal-bounds', horizontal.length === 0, horizontal));
  checks.push(check('native-text-vertical-bounds', texts.some((f) => f.type === 'text-below-body') ? 'review' : 'pass',
    texts.filter((f) => f.type === 'text-below-body')));
  const inlineCollisions = horizontalInlineCollisions(mode.pages || []);
  checks.push(passFail('native-inline-horizontal-overlap', inlineCollisions.length === 0, inlineCollisions));
  checks.push(check('rendered-font-glyph-overlap', 'uncovered', 'Native text/control boxes are checked; renderer-specific glyph ink and font substitution need visual review.'));
  checks.push(passFail('equation-row-overlap', !mode.equationCollisions?.length, mode.equationCollisions || []));
  const baselineFailures = (mode.equationMetrics || []).filter((eq) => !Number.isFinite(eq.baseline) || eq.baseline < 0 || eq.baseline > 100
    || !Number.isFinite(eq.previewWidth) || !Number.isFinite(eq.previewHeight) || eq.previewWidth <= 0 || eq.previewHeight <= 0);
  checks.push(passFail('equation-native-metrics', baselineFailures.length === 0, { equations: mode.equationMetrics?.length, failures: baselineFailures }));
  checks.push(check('equation-visual-baseline-corpus', 'uncovered', 'Native baseline/extent/overlap checked. Arbitrary formula glyph baselines still require visual reference review.'));
  for (const word of expectations.proseOracle?.joinedWords || []) {
    checks.push(passFail(`source-prose-word:${word}`, (mode.paragraphText || []).some((para) => para.includes(word)),
      { sourceNote: expectations.proseOracle.sourceNote, nearMatches: (mode.paragraphText || []).filter((para) => compact(para).includes(word)) }));
  }
  for (const fragment of expectations.proseOracle?.joinedParagraphFragments || []) {
    checks.push(passFail('source-prose-paragraph-continuation', (mode.paragraphText || []).some((para) => compact(para).includes(fragment)),
      { fragment, sourceNote: expectations.proseOracle.sourceNote }));
  }
  for (const fragments of expectations.proseOracle?.separateParagraphFragments || []) {
    const locate = (paragraphs) => fragments.map((fragment) => paragraphs.findIndex((para) => compact(para).includes(compact(fragment))));
    const distinct = (locations) => locations.every((position) => position >= 0) && new Set(locations).size === fragments.length;
    const sourceLocations = locate(mode.paragraphText || []);
    checks.push(passFail('source-verse-lineation', distinct(sourceLocations),
      { fragments, sourceLocations, sourceNote: expectations.proseOracle.sourceNote }));
    if (mode.pages?.length) {
      const nativeParagraphs = new Map();
      for (const page of mode.pages) for (const run of page.textRuns || []) {
        const key = `${run.secIdx}:${run.parentParaIdx ?? run.paraIdx}:${run.cellIdx ?? 'body'}`;
        nativeParagraphs.set(key, (nativeParagraphs.get(key) || '') + run.text);
      }
      const savedLocations = locate([...nativeParagraphs.values()]);
      checks.push(passFail('saved-verse-lineation', distinct(savedLocations), { fragments, savedLocations }));
    }
  }
  if (['kor', 'eng', 'economics'].includes(record.subject)) {
    const prose = renderedProseFindings(mode, record.questionText || '');
    checks.push(passFail('attested-prose-word-breaks', prose.attestedParagraphWordBreaks.length === 0, prose));
    checks.push(check('prose-singleton-line-review', prose.singletonRows.length ? 'review' : 'pass', prose.singletonRows));
  }
  checks.push(check('semantic-correctness', 'uncovered', 'No automatic claim that restored formulas, labels or data mean the same thing as the source.'));
  return checks;
}

function savedXml(bytes) {
  // Caller writes the archive first, so this helper never substitutes success for a save/reopen.
  const unescape = (value) => value.replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&');
  return { scripts: [...bytes.matchAll(/<hp:script>([\s\S]*?)<\/hp:script>/gu)].map((m) => unescape(m[1])),
    nativeContent: [...bytes.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/gu)].map((m) => unescape(m[1])).join('') };
}

async function snapshotModules(destination) {
  await mkdir(destination, { recursive: true });
  const modules = new Map(); const hashes = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(mjs|js)$/u.test(entry.name)) continue;
    const bytes = await readFile(join(root, entry.name));
    modules.set('/' + entry.name, bytes);
    hashes[entry.name] = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(destination, entry.name), bytes);
  }
  await writeFile(join(destination, 'hashes.json'), JSON.stringify(hashes, null, 2));
  return modules;
}

async function localPdfMap() {
  const originals = process.env.EXAM_ORIGINAL_ROOT || resolve(root, '../../../exam-search-public');
  const paths = execFileSync('rg', ['--files', '-uuu', originals], { encoding: 'utf8', maxBuffer: 1e7 })
    .trim().split('\n').filter((path) => path.endsWith('.pdf'));
  const names = new Map(paths.map((path) => [path.split('/').at(-1).normalize('NFC'), path]));
  const suffixes = new Map(paths.flatMap((path) => { const hash = path.match(/_([0-9a-f]{12})\.pdf$/u)?.[1]; return hash ? [[hash, path]] : []; }));
  const files = JSON.parse(await readFile(join(root, 'data/files.json'), 'utf8')), map = new Map();
  for (const file of files) {
    const name = file.publicPath.split('/').at(-1).normalize('NFC');
    const suffix = name.match(/_([0-9a-f]{12})\.pdf$/u)?.[1];
    const path = names.get(file.pdfFile.normalize('NFC')) || names.get(name) || suffixes.get(suffix);
    if (!path) continue;
    map.set(file.publicPath.normalize('NFC'), path);
    map.set(file.publicPath.replace(/^기출문제\/기출확장_국영수사탐\//u, '').normalize('NFC'), path);
  }
  return map;
}

async function collectQuestion(page, id, modes, captureSource) {
  return page.evaluate(async ({ id, modes, captureSource }) => {
    const { getJson } = await import('./data.mjs?v=library-release-20261010-1');
    await getJson('/api/status');
    const q = await getJson(`/api/question?id=${encodeURIComponent(id)}`);
    const { readQuestionPdf, renderQuestion } = await import('./pdf-viewer.mjs?v=library-release-20261010-1');
    const { inQuestion } = await import('./live-fonts.mjs');
    const { resolveEditableContent } = await import('./editable-source.mjs?v=preview-crop-20261004-1');
    const { createCollectionHwpx, equationScript, groupFractions } = await import('./editable-convert.mjs?v=typography-20261003-3');
    const { equationLineCollisions } = await import('./equation-spacing.mjs');
    const { default: init, HwpDocument } = await import('./vendor/rhwp-studio/assets/rhwp-core.js');
    await init('./vendor/rhwp-studio/assets/rhwp_bg-PUGAA2uC.wasm');
    const b64 = (bytes) => { let raw = ''; for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(raw); };
    const sanitize = (value) => JSON.parse(JSON.stringify(value, (_key, v) => ArrayBuffer.isView(v) ? { byteLength: v.byteLength } : v));
    const source = await readQuestionPdf(q);
    const sourceItems = source.content.items.filter((item) => inQuestion(item, q, source.pageHeight)).map((item) =>
      ({ text: item.str, x: item.transform[4], y: source.pageHeight - item.transform[5], w: item.width, h: Math.abs(item.height), transform: item.transform }));
    let sourcePNG;
    if (captureSource) {
      const url = await renderQuestion(q, 1.5); const img = new Image(); img.src = url; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(url); sourcePNG = canvas.toDataURL('image/png');
    }
    globalThis.__readabilityItems ||= new Map();
    const result = { id, subject: q.subject, sourcePage: q.page, box: q.box, questionText: q.questionText || q.text,
      sourcePdf: q.pdfFile, sourceSha256: q.sourceSha256 || null, sourceItems, sourcePNG, modes: [] };
    for (const includeImages of modes) {
      try {
        const resolved = await resolveEditableContent(q, { includeImages });
        if (!includeImages) globalThis.__readabilityItems.set(id, resolved);
        const bytes = await createCollectionHwpx([resolved]);
        const doc = new HwpDocument(bytes);
        try {
          const sourceRuns = [];
          const visit = (runs) => { for (const run of runs) { sourceRuns.push(run); if (run.kind === 'table') for (const row of run.table?.rows || []) for (const cell of row) visit(cell); } };
          for (const para of resolved.paragraphs) visit(para);
          const pages = [], equationMetrics = [];
          for (let p = 0; p < doc.pageCount(); p++) {
            const info = JSON.parse(doc.getPageInfo(p));
            const controls = JSON.parse(doc.getPageControlLayout(p)).controls;
            const textRuns = JSON.parse(doc.getPageTextLayout(p)).runs;
            for (const c of controls.filter((c) => c.type === 'equation')) {
              const props = JSON.parse(doc.getEquationProperties(c.secIdx, c.paraIdx, c.controlIdx, c.cellIdx ?? -1, c.cellParaIdx ?? -1));
              const svg = doc.renderEquationPreview(props.script, props.fontSize, props.color || 0);
              const svgRoot = svg.match(/<svg\b[^>]*>/u)?.[0] || '';
              equationMetrics.push({ page: p, address: [c.secIdx, c.paraIdx, c.controlIdx, c.cellIdx ?? -1, c.cellParaIdx ?? -1],
                baseline: props.baseline, baseUnit: props.fontSize, previewWidth: Number(svgRoot.match(/\bwidth="([^"]+)"/u)?.[1]),
                previewHeight: Number(svgRoot.match(/\bheight="([^"]+)"/u)?.[1]) });
            }
            pages.push({ page: p, info, controls, textRuns, svg: doc.renderPageSvg(p) });
          }
          result.modes.push({ includeImages, sourcePage: q.page, provenance: resolved.provenance, warnings: resolved.warnings,
            quality: resolved.quality, status: resolved.status, paragraphText: resolved.paragraphs.map((para) => para.map((run) =>
              run.kind === 'text' ? run.value : run.kind === 'equation' ? '[' + run.script + ']' : '').join('')),
            paragraphStructure: resolved.paragraphs.map((para) => ({ text: para.filter((run) => run.kind === 'text').map((run) => run.value).join(''),
              ...(para.find((run) => run.kind === 'table') ? { tableColumns: para.find((run) => run.kind === 'table').table.rows[0]?.length } : {}) })),
            nativeRuns: sanitize(sourceRuns), sourceScripts: sourceRuns.filter((r) => r.kind === 'equation').map((r) => groupFractions(equationScript(r.script))),
            pages, equationMetrics, equationCollisions: equationLineCollisions(doc), hwpx: b64(bytes) });
        } finally { doc.free(); }
      } catch (error) { result.modes.push({ includeImages, error: error?.stack || String(error) }); }
    }
    return result;
  }, { id, modes, captureSource });
}

async function collectCollections(page, ids) {
  return page.evaluate(async (ids) => {
    const { createCollectionHwpx } = await import('./editable-convert.mjs?v=typography-20261003-3');
    const { equationLineCollisions } = await import('./equation-spacing.mjs');
    const { HwpDocument } = await import('./vendor/rhwp-studio/assets/rhwp-core.js');
    const b64 = (bytes) => { let raw = ''; for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(raw); };
    const items = ids.map((id) => globalThis.__readabilityItems?.get(id)).filter(Boolean), result = [];
    for (const pagePerQuestion of [false, true]) {
      if (items.length !== ids.length) { result.push({ pagePerQuestion, ids, error: 'Some actual resolver items failed; collection cannot be verified.' }); continue; }
      try {
        const bytes = await createCollectionHwpx(items, { pagePerQuestion }); const doc = new HwpDocument(bytes);
        try {
          const pages = [];
          for (let p = 0; p < doc.pageCount(); p++) pages.push({ page: p, info: JSON.parse(doc.getPageInfo(p)),
            controls: JSON.parse(doc.getPageControlLayout(p)).controls, textRuns: JSON.parse(doc.getPageTextLayout(p)).runs, svg: doc.renderPageSvg(p) });
          result.push({ ids, labels: items.map((item) => item.sourceLabel), pagePerQuestion, pages,
            equationCollisions: equationLineCollisions(doc), hwpx: b64(bytes) });
        } finally { doc.free(); }
      } catch (error) { result.push({ pagePerQuestion, ids, error: error?.stack || String(error) }); }
    }
    return result;
  }, ids);
}

async function collectOverflow(page) {
  return page.evaluate(async () => {
    const { longQuestionFixture, longQuestionSentinels, equationOverflowFixture } = await import('./test-fixtures/readability-overflow.mjs');
    const { createCollectionHwpx } = await import('./editable-convert.mjs?v=typography-20261003-3');
    const { HwpDocument } = await import('./vendor/rhwp-studio/assets/rhwp-core.js');
    const result = { scope: 'synthetic-native-layout-only', longQuestion: [], equationOverflow: {} };
    for (const pagePerQuestion of [false, true]) {
      const bytes = await createCollectionHwpx([longQuestionFixture(), { questionId: 'qa-after-long', sourceLabel: '긴 문항 다음 문항',
        question: { no: 2, subject: 'kor', responseType: 'short_answer' }, paragraphs: [[{ kind: 'text', value: '둘째 문항 마지막 보존 표식입니다.' }]] }], { pagePerQuestion });
      const doc = new HwpDocument(bytes);
      try {
        const pages = [];
        for (let p = 0; p < doc.pageCount(); p++) pages.push({ page: p, info: JSON.parse(doc.getPageInfo(p)),
          controls: JSON.parse(doc.getPageControlLayout(p)).controls, textRuns: JSON.parse(doc.getPageTextLayout(p)).runs });
        const text = pages.flatMap((p) => p.textRuns).map((r) => r.text).join('').replace(/\s+/gu, '');
        result.longQuestion.push({ pagePerQuestion, pages,
          missingSentinels: longQuestionSentinels.filter((sentinel) => !text.includes(sentinel)),
          secondQuestionPreserved: text.includes('둘째문항마지막보존표식입니다.'),
          secondStartPage: pages.findIndex((p) => p.textRuns.map((r) => r.text).join('').replace(/\s+/gu, '').includes('긴문항다음문항')) });
      } finally { doc.free(); }
    }
    try { await createCollectionHwpx([equationOverflowFixture()]); result.equationOverflow = { rejected: false }; }
    catch (error) { result.equationOverflow = { rejected: true, message: error.message }; }
    return result;
  });
}

export async function historicalBaseline(evidence) {
  const path = join(root, '.omo/evidence/1004-biology-audit/browser/results.json');
  const bytes = await readFile(path), records = JSON.parse(bytes.toString());
  const fixtures = JSON.parse(await readFile(join(root, 'test-fixtures/readability-cases.json'), 'utf8'));
  const checks = [];
  for (const record of records) {
    for (const mode of record.modes) {
      if (!mode.paragraphs) continue;
      const nativeRuns = [];
      const visit = (runs) => { for (const run of runs) { nativeRuns.push(run); if (run.kind === 'table') for (const row of run.table.rows || []) for (const cell of row) visit(cell); } };
      mode.paragraphs.forEach(visit);
      const text = nativeRuns.filter((r) => r.kind === 'text').map((r) => r.value).join('');
      for (const charge of fixtures.nativeCharges[record.id] || []) checks.push({ id: record.id, includeImages: mode.includeImages,
        ...passFail(`native-charge:${charge}`, compact(text).includes(charge)) });
      for (const region of fixtures.criticalRegions[record.id] || []) {
        if (!mode.includeImages) continue; // Historical exclusion had no quality contract; do not invent one.
        const visible = nativeRuns.some((r) => r.kind === 'figure' && r.sourcePage === region.page && covers(r.sourceBox, region.box));
        checks.push({ id: record.id, includeImages: mode.includeImages, ...passFail(`critical-source-region:${region.label}`, visible) });
      }
      if (record.id === 'b1_2025_11_20') {
        const sequence = mode.paragraphs.map((para) => ({ text: para.filter((r) => r.kind === 'text').map((r) => r.value).join(''),
          tableColumns: para.find((r) => r.kind === 'table')?.table.rows[0]?.length }));
        const tableA = sequence.findIndex((p) => p.tableColumns === 1), captionA = sequence.findIndex((p, i) => i > tableA && /^\(가\)$/u.test(compact(p.text))),
          tableB = sequence.findIndex((p, i) => i > captionA && p.tableColumns === 2), captionB = sequence.findIndex((p, i) => i > tableB && /^\(나\)$/u.test(compact(p.text)));
        checks.push({ id: record.id, includeImages: mode.includeImages, ...passFail('nitrogen-data-caption-order', tableA >= 0 && captionA > tableA && tableB > captionA && captionB > tableB,
          { tableA, captionA, tableB, captionB }) });
      }
    }
  }
  const result = { scope: 'historical-actual-resolver-observation', path, sha256: createHash('sha256').update(bytes).digest('hex'),
    capturedFileMtime: (await stat(path)).mtime.toISOString(), checks,
    limitation: 'These are preserved pre-fix actual resolver paragraphs/figure source boxes. The old audit did not save a module hash or observed-source quality status; those claims are not reconstructed.' };
  await mkdir(evidence, { recursive: true }); await writeFile(join(evidence, 'historical-baseline.json'), JSON.stringify(result, null, 2));
  return result;
}

export async function runReadabilityQA(options = {}) {
  const fixtures = JSON.parse(await readFile(join(root, 'test-fixtures/readability-cases.json'), 'utf8'));
  const cases = options.ids || [...fixtures.biology, ...fixtures.scienceSubjects.flatMap((s) => fixtures.scienceNumbers.map((n) =>
    `${s}_2027_06_${String(n).padStart(2, '0')}`)), ...fixtures.other];
  const phase = options.phase || 'final';
  if (!/^[a-z0-9-]+$/u.test(phase)) throw new Error('Use a simple phase name.');
  const evidence = options.evidence || join(root, '.omo/evidence/1004-readability', phase);
  const output = join(evidence, 'output'); await mkdir(output, { recursive: true });
  const modules = await snapshotModules(join(evidence, 'source'));
  const pdfs = await localPdfMap(), pdfEvidence = new Map();
  const sourceCatalog = JSON.parse(await readFile(join(root, 'data/files.json'), 'utf8'));
  const meta = { schema: 1, phase, startedAt: new Date().toISOString(), sourcePath: root,
    actualPath: 'resolveEditableContent → createCollectionHwpx → HwpDocument', origin: options.origin || 'http://localhost:8813', cases,
    sourceSnapshot: 'source/hashes.json', harnessSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    fixtureSha256: createHash('sha256').update(await readFile(join(root, 'test-fixtures/readability-cases.json'))).digest('hex'),
    limitations: ['Observed source-region coverage is not semantic correctness.',
      'PDF digit subscript geometry is unverified when extraction merges the digit onto the formula baseline.',
      'Native Hancom is unavailable; rHWP layout engine is the verification renderer.'] };
  await writeFile(join(evidence, 'run.json'), JSON.stringify(meta, null, 2));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true }); const results = [], collectionResults = []; let overflow;
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.continue();
      if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: '' });
      if (modules.has(url.pathname)) {
        let body = modules.get(url.pathname);
        if (url.pathname === '/drive-source.mjs') body = body.toString().replace(/const (PUBLIC_BASE|EXPANSION_BASE) = '[^']+';/gu,
          (_match, name) => `const ${name} = '${options.origin || 'http://localhost:8813'}/local-pdf/';`);
        return route.fulfill({ contentType: 'text/javascript', body });
      }
      // Serve the actual local original, without changing the preview server's routing or product files.
      if (url.pathname.startsWith('/local-pdf/')) {
        const publicPath = decodeURIComponent(url.pathname.slice('/local-pdf/'.length)).normalize('NFC');
        const path = pdfs.get(publicPath);
        if (!path) return route.fulfill({ status: 404, body: 'Local original PDF was not found.' });
        const bytes = await readFile(path);
        pdfEvidence.set(publicPath, { basename: path.split('/').at(-1), path, byteLength: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex') });
        return route.fulfill({ contentType: 'application/pdf', body: bytes });
      }
      if (url.pathname.startsWith('/api/')) return route.continue();
      const relative = decodeURIComponent(url.pathname).replace(/^\//u, ''), path = resolve(root, relative);
      if (path !== root && !path.startsWith(root + '/')) return route.abort();
      try {
        if (!(await stat(path)).isFile()) return route.continue();
        const type = ({ '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
          '.css': 'text/css', '.html': 'text/html' })[extname(path)] || 'application/octet-stream';
        return route.fulfill({ contentType: type, body: await readFile(path) });
      } catch { return route.continue(); }
    });
    await page.goto(meta.origin);
    for (const id of cases) {
      let record;
      try { record = await collectQuestion(page, id, options.modes || [false, true], options.captureSource !== false); }
      catch (error) { record = { id, error: error.stack, modes: [] }; }
      const sourceFile = sourceCatalog.find((file) => file.pdfFile === record.sourcePdf);
      const originalPath = sourceFile && pdfs.get(sourceFile.publicPath.normalize('NFC'));
      record.actualSource = [...pdfEvidence.values()].find((source) => source.path === originalPath);
      record.sourceChargePairs = sourceChargePairs(record.sourceItems || []);
      if (record.sourcePNG) { await writeFile(join(output, `${id}-source.png`), Buffer.from(record.sourcePNG.split(',')[1], 'base64')); delete record.sourcePNG; }
      for (const mode of record.modes) {
        const name = `${id}-${mode.includeImages ? 'images' : 'text'}`;
        if (mode.hwpx) {
          const path = join(output, name + '.hwpx'); await writeFile(path, Buffer.from(mode.hwpx, 'base64')); delete mode.hwpx;
          const xml = execFileSync('unzip', ['-p', path, 'Contents/section0.xml'], { encoding: 'utf8', maxBuffer: 1e8 });
          Object.assign(mode, savedXml(xml));
        }
        for (const p of mode.pages || []) { await writeFile(join(output, `${name}-page-${p.page + 1}.svg`), p.svg); delete p.svg; }
        mode.checks = analyzeMode(record, mode, { nativeCharges: fixtures.nativeCharges[id], criticalRegions: fixtures.criticalRegions[id], proseOracle: fixtures.proseOracles[id] });
        mode.pass = mode.checks.every((c) => c.status !== 'fail');
        mode.failures = mode.checks.filter((c) => c.status === 'fail').map((c) => c.name);
      }
      results.push(record);
      await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2));
      console.log(`${id}: ${record.error || record.modes.map((m) => `${m.includeImages ? 'images' : 'text'} ${m.pass ? 'PASS' : 'FAIL'} ${(m.failures || []).join(',')}`).join(' | ')}`);
    }
    if (options.collections !== false) {
      for (const [name, ids] of [['math', cases.filter((id) => id.startsWith('2021_11_math'))], ['long-biology', fixtures.biology.filter((id) => cases.includes(id) && /_18$|_20$/u.test(id))]]) {
        if (ids.length < 2) continue;
        for (const collection of await collectCollections(page, ids)) {
          collection.name = name;
          if (collection.hwpx) {
            const path = join(output, `${name}-collection-${collection.pagePerQuestion ? 'per-question' : 'continuous'}.hwpx`);
            await writeFile(path, Buffer.from(collection.hwpx, 'base64')); delete collection.hwpx;
            Object.assign(collection, savedXml(execFileSync('unzip', ['-p', path, 'Contents/section0.xml'], { encoding: 'utf8', maxBuffer: 1e8 })));
          }
          for (const p of collection.pages || []) { await writeFile(join(output, `${name}-collection-${collection.pagePerQuestion ? 'per-question' : 'continuous'}-${p.page + 1}.svg`), p.svg); delete p.svg; }
          const bounds = controlBounds(collection.pages || []), texts = textBounds(collection.pages || []), inlineCollisions = horizontalInlineCollisions(collection.pages || []);
          const labelPages = (collection.labels || []).map((label) => (collection.pages || []).findIndex((p) => compact(p.textRuns.map((r) => r.text).join('')).includes(compact(label))));
          collection.checks = collection.error ? [check('actual-collection', 'fail', collection.error)] : [
            passFail('collection-control-bounds', bounds.length === 0, bounds),
            passFail('collection-text-horizontal-bounds', !texts.some((f) => f.type === 'text-outside-left-column'), texts),
            passFail('collection-inline-horizontal-overlap', inlineCollisions.length === 0, inlineCollisions),
            passFail('collection-equation-overlap', !collection.equationCollisions?.length, collection.equationCollisions || []),
            passFail('collection-all-source-labels', collection.labels.every((label) => compact(collection.nativeContent).includes(compact(label))), collection.labels),
            passFail('page-per-question-lower-bound', !collection.pagePerQuestion || collection.pages.length >= ids.length,
              { questions: ids.length, pages: collection.pages.length }),
            passFail('page-per-question-distinct-starts', !collection.pagePerQuestion || labelPages.every((p) => p >= 0)
              && new Set(labelPages).size === ids.length, { labelPages }),
            check('long-question-page-overflow', 'review', 'More than one page for a long question is permitted; native content and control bounds must still be preserved.'),
          ];
          collection.pass = collection.checks.every((c) => c.status !== 'fail'); collectionResults.push(collection);
        }
      }
      overflow = await collectOverflow(page);
      for (const record of overflow.longQuestion) {
        const bounds = controlBounds(record.pages), texts = textBounds(record.pages), inlineCollisions = horizontalInlineCollisions(record.pages);
        record.checks = [passFail('long-prose-overflow-retains-native-content', record.pages.length > 1 && !record.missingSentinels.length && record.secondQuestionPreserved,
          { pages: record.pages.length, missing: record.missingSentinels, second: record.secondQuestionPreserved }),
          passFail('long-prose-overflow-control-bounds', !bounds.length, bounds),
          passFail('long-prose-overflow-text-bounds', !texts.some((f) => f.type === 'text-outside-left-column'), texts),
          passFail('long-prose-overflow-inline-overlap', !inlineCollisions.length, inlineCollisions),
          passFail('long-prose-per-question-next-page', !record.pagePerQuestion || record.secondStartPage > 0, record.secondStartPage)];
        record.pass = record.checks.every((c) => c.status !== 'fail');
      }
      overflow.equationOverflow.pass = overflow.equationOverflow.rejected && /최소 8pt 크기로도/u.test(overflow.equationOverflow.message);
    }
  } finally { await browser.close(); }
  const modes = results.flatMap((r) => r.modes);
  const summary = { ...meta, finishedAt: new Date().toISOString(), questions: results.length, conversions: modes.length,
    passedConversions: modes.filter((m) => m.pass).length, failedConversions: modes.filter((m) => !m.pass).length,
    extractionFailures: results.filter((r) => r.error).map((r) => ({ id: r.id, error: r.error })),
    failures: results.flatMap((r) => r.modes.filter((m) => !m.pass).map((m) => ({ id: r.id, includeImages: m.includeImages, failures: m.failures, error: m.error }))),
    acknowledgedExclusions: modes.flatMap((m) => m.checks.filter((c) => c.status === 'acknowledged-exclusion')).length,
    uncovered: [...new Set(modes.flatMap((m) => m.checks.filter((c) => c.status === 'uncovered').map((c) => c.name)))],
    reviewFindings: results.flatMap((r) => r.modes.flatMap((m) => m.checks.filter((c) => c.status === 'review')
      .map((c) => ({ id: r.id, includeImages: m.includeImages, ...c })))),
    collections: collectionResults.map(({ pages, nativeContent, scripts, ...rest }) => ({ ...rest, pageCount: pages?.length })) };
  await writeFile(join(evidence, 'collections.json'), JSON.stringify(collectionResults, null, 2));
  await writeFile(join(evidence, 'original-pdfs.json'), JSON.stringify([...pdfEvidence.entries()].map(([publicPath, source]) => ({ publicPath, ...source })), null, 2));
  if (overflow) { await writeFile(join(evidence, 'overflow.json'), JSON.stringify(overflow, null, 2)); summary.overflow = { longProse: overflow.longQuestion.every((r) => r.pass), equation: overflow.equationOverflow.pass }; }
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ evidence, questions: summary.questions, conversions: summary.conversions, pass: summary.passedConversions,
    fail: summary.failedConversions, extractionFailures: summary.extractionFailures.length, collections: summary.collections.map((c) => ({ name: c.name, perQuestion: c.pagePerQuestion, pass: c.pass })) }));
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  if (process.argv.includes('--historical-baseline')) { await historicalBaseline(join(root, '.omo/evidence/1004-readability')); process.exit(0); }
  const modes = arg('--mode') === 'text' ? [false] : arg('--mode') === 'images' ? [true] : [false, true];
  const summary = await runReadabilityQA({ phase: arg('--phase'), ids: arg('--ids')?.split(','), modes,
    origin: arg('--origin'), captureSource: !process.argv.includes('--no-source'), collections: !process.argv.includes('--no-collections') });
  if (summary.failedConversions || summary.extractionFailures.length || summary.collections.some((c) => !c.pass)
    || summary.overflow && (!summary.overflow.longProse || !summary.overflow.equation)) process.exitCode = 1;
}
