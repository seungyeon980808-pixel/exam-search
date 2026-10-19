// 5E 문항 틀 연결부: 과학탐구 문항은 5E 틀로, 실패하거나 끄면 기존 변환으로.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEditableContent } from './editable-source.mjs';
import { createEditableBatch } from './editable-batch.mjs';
import { stripFigures, frameEligible, FRAME_SUBJECTS } from './exampool/frame.mjs';

const question = { id: 'p1_2024_06_03', subject: 'p1', no: 3, pdfFile: 'p1_2024_06.pdf', page: 1, box: [0, 0, 100, 100],
  text: '3. 본문\n① 가 ② 나 ③ 다 ④ 라 ⑤ 마' };
const prepared = () => ({ schema: 'exam-editable-v1', status: 'needs_review', questionId: question.id, number: 3, sourcePdf: question.pdfFile, page: 1,
  blocks: [{ role: 'stem', runs: [{ kind: 'text', value: '본문' }] },
    ...[...'①②③④⑤'].map((label) => ({ role: 'choice', label, runs: [{ kind: 'text', value: '답' }] }))] });
const deps = (frame) => ({ entries: async () => ({}), convert: async () => prepared(), frame: true,
  frameModule: async () => ({ frameEligible, convertFrame: frame }) });

test('science questions use the 5E frame document', async () => {
  const bytes = Uint8Array.of(1, 2, 3);
  let seen;
  const result = await resolveEditableContent(question, { ...deps(async (q, options) => {
    seen = [q.id, options.includeImages];
    return { bytes, height: 80, notes: ['확인: 그림 1개'], excludedFigures: 0 };
  }), includeImages: true });
  assert.deepEqual(seen, [question.id, true]);
  assert.equal(result.provenance, '5e-frame');
  assert.equal(result.frame.bytes, bytes);
  assert.deepEqual(result.warnings, ['확인: 그림 1개']);
  assert.equal(result.quality.state, 'unverified');
});
test('excluded figures are reported but keep the frame', async () => {
  const result = await resolveEditableContent(question, { ...deps(async () => ({ bytes: Uint8Array.of(1), height: 1, notes: [], excludedFigures: 2 })), includeImages: false });
  assert.equal(result.quality.state, 'excluded'); assert.equal(result.quality.excludedCount, 2);
});
test('a failed 5E frame falls back to the basic conversion with a warning', async () => {
  const result = await resolveEditableContent(question, deps(async () => { throw new Error('표를 읽지 못했습니다'); }));
  assert.equal(result.provenance, 'pdf');
  assert.match(result.warnings[0], /5E 문항 틀로 바꾸지 못해 기본 변환.*표를 읽지 못했습니다/u);
});
test('basic conversion is used when the frame is turned off or the subject is not science', async () => {
  const never = async () => { throw new Error('must not run'); };
  assert.equal((await resolveEditableContent(question, { ...deps(never), frame: false })).provenance, 'pdf');
  const korean = { ...question, id: 'k_2024_06_03', subject: 'korean' };
  const entries = async () => ({});
  const convert = async () => ({ ...prepared(), questionId: korean.id });
  assert.equal((await resolveEditableContent(korean, { ...deps(never), entries, convert })).provenance, 'pdf');
});
test('cancelling stops instead of falling back', async () => {
  const controller = new AbortController();
  const pending = resolveEditableContent(question, { ...deps(async () => { controller.abort(); throw new DOMException('취소', 'AbortError'); }), signal: controller.signal });
  await assert.rejects(pending, { name: 'AbortError' });
});
test('stripFigures removes every figure and counts it', () => {
  const q = { blocks: [{ figure: { data: 'x' } }, { table: { cells: [[{ figure: { data: 'y' } }, { value: 'a' }]] } }, { lines: [{ figure: { data: 'z' } }] }],
    choices: [{ figure: { data: 'c' } }, { text: '①' }], choiceTable: { cells: [[{ figure: { data: 'd' } }]] } };
  assert.equal(stripFigures(q), 5);
  assert.equal(JSON.stringify(q).includes('"data"'), false);
});
test('only the eight science subjects with a PDF region are eligible', () => {
  assert.equal(FRAME_SUBJECTS.size, 8);
  assert.equal(frameEligible(question), true);
  assert.equal(frameEligible({ ...question, subject: 'math' }), false);
  assert.equal(frameEligible({ ...question, box: null }), false);
});
test('batch conversion overlaps work but keeps start order and results in selection order', async () => {
  let active = 0, peak = 0; const started = [];
  const batch = createEditableBatch(['A1', 'B1', 'A2', 'B2'], { concurrency: 2, getQuestion: async (id) => ({ id, pdfFile: `${id[0]}.pdf` }),
    resolve: async (q) => { started.push(q.id); active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active -= 1; return { questionId: q.id, provenance: 'pdf', paragraphs: [] }; } });
  const state = await batch.run();
  assert.equal(peak, 2);
  assert.deepEqual(started, ['A1', 'A2', 'B1', 'B2']);
  assert.deepEqual(state.items.map((item) => item.result.questionId), ['A1', 'B1', 'A2', 'B2']);
  assert.equal(state.completed, 4);
});
