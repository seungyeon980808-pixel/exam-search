import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEditableContent } from './editable-source.mjs';

const question = { id: 'optional', no: 1, pdfFile: 'paper.pdf', page: 1, box: [0, 0, 200, 400],
  text: '1. 본문 ① 가 ② 나 ③ 다 ④ 라 ⑤ 마' };
const image = () => ({ bytes: new Uint8Array([1, 2, 3]), width: 120, height: 80 });
const drawing = (left = 10) => ({ box: [left, 30, left + 50, 80], afterBlock: 0 });
const prepared = (figures = [drawing()]) => ({ schema: 'exam-editable-v1', status: 'needs_review',
  questionId: question.id, number: 1, sourcePdf: question.pdfFile, page: 1, figureFallbacks: figures,
  blocks: [{ role: 'stem', runs: [{ kind: 'text', value: '편집 가능한 본문 ' }, { kind: 'equation', script: 'x^{2}' }] },
    { role: 'ask', runs: [{ kind: 'text', value: '옳은 것을 고르시오.' }] },
    { role: 'bogi', label: 'ㄱ', runs: [{ kind: 'text', value: '보기 문장' }] },
    ...[...'①②③④⑤'].map((label) => ({ role: 'choice', label, runs: [{ kind: 'text', value: '답' }] }))] });
const dependencies = (data = prepared()) => ({ entries: async () => ({}), convert: async () => data });
const native = (result) => result.paragraphs.flat().filter((run) => run.kind !== 'figure');
const figures = (result) => result.paragraphs.flat().filter((run) => run.kind === 'figure');

test('default image exclusion skips discovery and rendering, including prepared image controls', async () => {
  const data = prepared();
  data.notes = ['편집 객체로 복원하지 못한 그림·도표 1개 영역만 원본 이미지로 넣었습니다.'];
  data.blocks.splice(1, 0, { kind: 'figure', runs: [{ kind: 'figure', image: null }] });
  let conversions = 0;
  const result = await resolveEditableContent(question, { ...dependencies(data),
    entries: async () => ({ optional: { status: 'needs_review', source: 'prepared.json' } }),
    readPrepared: async () => data,
    convert: async () => { conversions += 1; throw new Error('unexpected conversion'); },
    readQuestionPdf: async () => { throw new Error('unexpected image detection'); },
    renderFigure: async () => { throw new Error('unexpected rendering'); } });
  assert.equal(conversions, 0);
  assert.equal(figures(result).length, 0);
  assert.equal(native(result).find((run) => run.kind === 'equation').script, 'x^{2}');
  assert.ok(native(result).some((run) => run.value === '<보기>'));
  assert.equal(data.blocks.filter((block) => block.kind === 'figure').length, 1);
  assert.doesNotMatch(result.warnings.join(' '), /원본 이미지로 넣었습니다/u);
});

test('explicit exclusion is passed to live conversion and preserves native question content', async () => {
  const data = prepared([{ box: question.box }]);
  let options;
  const controller = new AbortController();
  const result = await resolveEditableContent(question, { ...dependencies(data), includeImages: false, signal: controller.signal,
    convert: async (_, config) => { options = config; return data; },
    renderFigure: () => { throw new Error('unexpected rendering'); } });
  assert.equal(options.includeImages, false);
  assert.equal(options.signal, controller.signal);
  assert.equal(figures(result).length, 0);
  assert.equal(result.provenance, 'pdf');
});

test('explicit inclusion inserts only the illustration while text, equation and 보기 remain native', async () => {
  const calls = [];
  const result = await resolveEditableContent(question, { ...dependencies(), includeImages: true,
    renderFigure: async (item, scale, { signal }) => {
      calls.push(item.box);
      assert.equal(scale, 2);
      assert.equal(signal.aborted, false);
      return image();
    } });
  assert.deepEqual(calls, [drawing().box]);
  assert.equal(figures(result).length, 1);
  assert.deepEqual(native(result), native(await resolveEditableContent(question, dependencies())));
  assert.match(result.warnings.join(' '), /1개 영역만 원본 이미지/u);
});

test('invalid and failed illustration crops are skipped independently with the native question preserved', async () => {
  const data = prepared([{ box: question.box }, drawing(10), drawing(80)]);
  const result = await resolveEditableContent(question, { ...dependencies(data), includeImages: true,
    renderFigure: async (item) => {
      if (item.box[0] === 10) throw new Error('decoded image is unavailable');
      return image();
    } });
  assert.equal(figures(result).length, 1);
  assert.deepEqual(figures(result)[0].sourceBox, drawing(80).box);
  assert.deepEqual(native(result), native(await resolveEditableContent(question, dependencies(data))));
  assert.match(result.warnings.join(' '), /문항 전체/u);
  assert.match(result.warnings.join(' '), /decoded image is unavailable/u);
});

test('image detection failure becomes a warning instead of dropping the question or switching to an index draft', async () => {
  const data = prepared(); delete data.figureFallbacks;
  const result = await resolveEditableContent(question, { ...dependencies(data), includeImages: true,
    readQuestionPdf: async () => { throw new Error('drawing analysis failed'); } });
  assert.equal(figures(result).length, 0);
  assert.equal(result.provenance, 'pdf');
  assert.match(result.warnings.join(' '), /drawing analysis failed/u);
  assert.deepEqual(native(result), native(await resolveEditableContent(question, dependencies(data))));
});

test('native body validation happens before optional illustration work', async () => {
  const data = prepared(); data.blocks[0].runs.push({ kind: 'equation', script: '(cid:10)' });
  let rendered = false;
  await assert.rejects(resolveEditableContent(question, { ...dependencies(data), includeImages: true,
    renderFigure: async () => { rendered = true; return image(); } }), /복원되지 않은/u);
  assert.equal(rendered, false);
});

test('a hanging renderer times out, aborts its work, and finishes native content without repeating the timeout', async () => {
  let hangingSignal, calls = 0;
  const phases = [];
  const result = await resolveEditableContent(question, { ...dependencies(prepared([drawing(10), drawing(80)])),
    includeImages: true, figureTimeoutMs: 20, onPhase: (phase) => phases.push(phase),
    renderFigure: async (item, _, { signal }) => {
      calls += 1;
      if (item.box[0] === 10) { hangingSignal = signal; return new Promise(() => {}); }
      return image();
    } });
  assert.equal(hangingSignal.aborted, true);
  assert.equal(figures(result).length, 0);
  assert.equal(calls, 1);
  assert.deepEqual(phases, ['그림 처리 1 / 2개']);
  assert.match(result.warnings.join(' '), /시간.*초과/u);
  assert.match(result.warnings.join(' '), /남은 그림·도표 1개/u);
  assert.ok(native(result).some((run) => run.value?.includes('편집 가능한 본문')));
});

test('parent cancellation immediately escapes a renderer that ignores abort and never starts subsequent figures', async () => {
  const controller = new AbortController();
  let started, renderSignal, renders = 0;
  const rendered = new Promise((resolve) => { started = resolve; });
  const work = resolveEditableContent(question, { ...dependencies(prepared([drawing(10), drawing(80)])),
    includeImages: true, signal: controller.signal,
    renderFigure: async (_, __, { signal }) => { renders += 1; renderSignal = signal; started(); return new Promise(() => {}); } });
  await rendered;
  controller.abort();
  await assert.rejects(work, { name: 'AbortError' });
  assert.equal(renderSignal.aborted, true);
  assert.equal(renders, 1);
});

test('an internally aborted image is optional when the parent conversion was not cancelled', async () => {
  const result = await resolveEditableContent(question, { ...dependencies(), includeImages: true,
    renderFigure: async () => { throw new DOMException('image resource aborted', 'AbortError'); } });
  assert.equal(figures(result).length, 0);
  assert.match(result.warnings.join(' '), /image resource aborted/u);
  assert.equal(result.provenance, 'pdf');
});

test('corrupt embedded prepared figures are omitted without hiding a valid native question', async () => {
  const data = prepared([]);
  data.blocks.splice(1, 0, { kind: 'figure', runs: [{ kind: 'figure', sourceBox: drawing().box, image: { ...image(), width: NaN } }] });
  const result = await resolveEditableContent(question, { ...dependencies(data), includeImages: true });
  assert.equal(figures(result).length, 0);
  assert.match(result.warnings.join(' '), /그림.*제외/u);
  assert.ok(native(result).some((run) => run.kind === 'equation'));
});

test('missing original crop bounds skip optional images and retain the valid native question', async () => {
  const data = prepared();
  data.blocks.splice(1, 0, { kind: 'figure', runs: [{ kind: 'figure', image: null }] });
  const result = await resolveEditableContent({ ...question, box: undefined }, { ...dependencies(data), includeImages: true,
    renderFigure: async () => { throw new Error('must not render without source bounds'); } });
  assert.equal(figures(result).length, 0);
  assert.match(result.warnings.join(' '), /범위를 확인할 수 없습니다/u);
  assert.ok(native(result).some((run) => run.kind === 'equation'));
});

test('source inventory distinguishes excluded, unresolved and recovered content', async () => {
  const { observedContentRegions } = await import('./content-integrity.mjs');
  const question = { id: 'science', page: 1, box: [0, 0, 300, 500] };
  const image = { type: 'image', box: [20, 20, 280, 30] };
  const table = { kind: 'table', box: [20, 100, 200, 170] };
  const vector = { kind: 'vector', box: [20, 190, 200, 250] };
  const build = (include, figures=[]) => observedContentRegions(question, {}, [image], [vector], figures, [table], include);
  assert.deepEqual(build(false).map(r=>r.state), ['excluded', 'excluded', 'editable']);
  assert.deepEqual(build(true).map(r=>r.state), ['unresolved', 'unresolved', 'editable']);
  assert.deepEqual(build(true,[{box:[18,18,282,32]},{box:vector.box}]).map(r=>r.state), ['pending-image','pending-image','editable']);
  assert.equal(build(true).filter(r=>r.kind==='raster').length,1);
});
