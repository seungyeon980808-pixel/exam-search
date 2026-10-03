import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeContentQuality, contentQualitySummary } from './content-quality.mjs';
import { resolveEditableContent } from './editable-source.mjs';
const region = (change = {}) => ({ id: 'sequence', page: 1, kind: 'raster', box: [10, 50, 100, 60], state: 'pending-image', ...change });
const imageBlock = (box = [9, 49, 101, 61], page = 1) => ({ kind: 'figure', runs: [{ kind: 'figure',
  sourceBox: box, sourcePage: page, image: { bytes: Uint8Array.of(137), width: 92, height: 12 } }] });
test('generated image must cover the complete source asset on its original page', () => {
  for (const [block, expected] of [[imageBlock(), 'image'], [imageBlock([10, 50, 50, 60]), 'unresolved'], [imageBlock(undefined, 2), 'unresolved']]) {
    const result = finalizeContentQuality({ contentRegions: [region()], blocks: [block] }, { includeImages: true });
    assert.equal(result.quality.regions[0].state, expected);
    assert.equal(result.quality.state, expected === 'image' ? 'review' : 'incomplete');
  }
});
test('explicit image exclusion is distinguishable from failed inclusion', () => {
  const data = { contentRegions: [region()], blocks: [] };
  const excluded = finalizeContentQuality(data);
  const failed = finalizeContentQuality(data, { includeImages: true });
  assert.equal(excluded.quality.state, 'excluded');
  assert.equal(excluded.quality.excludedCount, 1);
  assert.equal(failed.quality.unresolvedCount, 1);
  assert.match(failed.warnings.join(' '), /복원/u);
});
test('an empty source inventory is observed, absent inventory remains unverified', () => {
  assert.equal(finalizeContentQuality({ contentRegions: [], blocks: [] }).quality.state, 'review');
  assert.equal(finalizeContentQuality({ blocks: [] }).quality.state, 'unverified');
  assert.equal(finalizeContentQuality({ contentRegions: 'bad', blocks: [] }).quality.state, 'unverified');
});
test('native tables stay editable in both image options and missing controls are not trusted', () => {
  const data = { contentRegions: [region({ kind: 'table', state: 'editable' })], blocks: [{ kind: 'table', sourceContentId: 'sequence', rows: [] }] };
  for (const includeImages of [false, true]) assert.equal(finalizeContentQuality(data, { includeImages }).quality.regions[0].state, 'editable');
  for (const includeImages of [false, true]) {
    assert.equal(finalizeContentQuality({ ...data, blocks: [] }, { includeImages }).quality.state, 'incomplete');
  }
});
test('one native table cannot stand in for another missing source table after image insertion', () => {
  const a = region({ id: 'a', kind: 'table', state: 'editable' });
  const b = region({ id: 'b', page: 2, box: [200, 50, 300, 60], kind: 'table', state: 'editable' });
  for (const includeImages of [false, true]) {
    const result = finalizeContentQuality({ contentRegions: [a, b], blocks: [imageBlock(), { kind: 'table', sourceContentId: 'a' }] }, { includeImages });
    assert.equal(result.quality.regions[0].state, 'editable');
    assert.equal(result.quality.regions[1].state, 'unresolved');
    assert.equal(result.quality.state, 'incomplete');
    assert.equal(result.quality.unresolvedCount, 1);
    assert.equal(result.quality.excludedCount, 0);
  }
});
test('known rendering failures remain incomplete when prepared data has no inventory', () => {
  const result = finalizeContentQuality({ blocks: [], notes: ['그림·도표 1번을 제외했습니다: 시간 초과'] }, { includeImages: true });
  assert.equal(result.quality.state, 'incomplete');
  assert.equal(result.quality.failedFigureCount, 1);
});
test('summary separates deliberate exclusion from reconstruction problems and index drafts', () => {
  const item = (quality, provenance = 'pdf') => ({ result: { quality, provenance } });
  const result = contentQualitySummary([item({ state: 'review' }), item({ state: 'excluded', excludedCount: 1 }), item({ state: 'incomplete' })]);
  assert.equal(result.incomplete, 1); assert.equal(result.excluded, 1);
  assert.match(result.message, /복원 확인/u);
  assert.equal(contentQualitySummary([item(undefined, 'index-draft')]).incomplete, 1);
});
test('actual resolver includes source-asset quality with independently usable native text', async () => {
  const question = { id: 'q', no: 1, pdfFile: 'q.pdf', page: 1, box: [0, 0, 150, 200] };
  const prepared = { schema: 'exam-editable-v1', status: 'needs_review', questionId: 'q', number: 1, sourcePdf: 'q.pdf', page: 1,
    contentRegions: [region({ state: 'unresolved' })], figureFallbacks: [], blocks: [
      { role: 'stem', runs: [{ kind: 'text', value: '자료의 결과를 고르시오.' }] },
      ...[...'①②③④⑤'].map((label) => ({ role: 'choice', label, runs: [{ kind: 'text', value: '답' }] })),
    ] };
  const deps = { entries: async () => ({}), convert: async () => prepared, includeImages: true };
  const result = await resolveEditableContent(question, deps);
  assert.equal(result.provenance, 'pdf');
  assert.equal(result.quality.state, 'incomplete');
  assert.equal(result.quality.unresolvedCount, 1);
  assert.match(result.warnings.join(' '), /원본 자료 1개/u);
  assert.ok(result.paragraphs.flat().some((run) => run.value === '자료의 결과를 고르시오.'));
  const excluded = await resolveEditableContent(question, { ...deps, includeImages: false });
  assert.equal(excluded.quality.state, 'excluded');
});
