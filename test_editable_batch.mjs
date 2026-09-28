import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditableBatch, clearEditableBatchCache } from './editable-batch.mjs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const getQuestion = async (id) => ({ id, pdfFile: `${id[0]}.pdf` });
const result = (question) => ({ questionId: question.id, provenance: 'pdf', paragraphs: [] });
test('PDF grouping restores the original selection order', async () => {
  const calls = [], progress = [];
  const batch = createEditableBatch(['A1', 'B1', 'A2'], { getQuestion,
    resolve: async (question) => { calls.push(question.id); return result(question); },
    onProgress: (state) => progress.push(state.completed) });
  const state = await batch.run();
  assert.deepEqual(calls, ['A1', 'A2', 'B1']);
  assert.deepEqual(state.items.map((item) => item.result.questionId), ['A1', 'B1', 'A2']);
  assert.equal(progress.at(-1), 3);
});
test('failed retry leaves successful items untouched', async () => {
  const calls = []; let fail = true;
  const batch = createEditableBatch(['A1', 'B1'], { getQuestion,
    resolve: async (question) => { calls.push(question.id);
      if (question.id === 'B1' && fail) throw new Error('retry me'); return result(question); } });
  assert.equal((await batch.run()).items[1].status, 'error');
  fail = false;
  assert.equal((await batch.retryFailed()).items[1].status, 'ready');
  assert.deepEqual(calls, ['A1', 'B1', 'B1']);
});
test('late resolution after cancellation never publishes a result or starts remaining work', async () => {
  let release, started; const start = new Promise((resolve) => { started = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  const calls = [], updates = [];
  const batch = createEditableBatch(['A1', 'B1'], { getQuestion, onProgress: (state) => updates.push(state),
    resolve: async (question) => { calls.push(question.id); started(); await pending; return result(question); } });
  const work = batch.run(); await start; batch.cancel(); const count = updates.length; release();
  const state = await work;
  assert.equal(updates.length, count); assert.deepEqual(calls, ['A1']);
  assert.ok(state.items.every((item) => item.status === 'cancelled' && item.result === null));
});
test('lookup failure is per item and retryable', async () => {
  let fail = true;
  const batch = createEditableBatch(['A1', 'B1'], { getQuestion: async (id) => {
    if (id === 'A1' && fail) throw new Error('lookup'); return getQuestion(id);
  }, resolve: async (question) => result(question) });
  assert.deepEqual((await batch.run()).items.map((item) => item.status), ['error', 'ready']);
  fail = false;
  assert.deepEqual((await batch.retryFailed()).items.map((item) => item.status), ['ready', 'ready']);
});
test('empty and duplicate snapshots reject before querying', () => {
  assert.throws(() => createEditableBatch([])); assert.throws(() => createEditableBatch(['A1', 'A1']));
});
test('draft provenance is retained in item status', async () => {
  const batch = createEditableBatch(['A1'], { getQuestion,
    resolve: async (question) => ({ ...result(question), provenance: 'index-draft' }) });
  assert.equal((await batch.run()).items[0].status, 'draft');
});

test('PDF bytes remain owned by the pending extraction after another PDF clears the cache', async () => {
  const source = await readFile(new URL('./pdf-viewer.mjs', import.meta.url), 'utf8');
  let release; const pending = new Promise((resolve) => { release = resolve; });
  const seen = [], destroyed = [];
  const context = { URL, Uint8Array, downloadDriveFile: (name) => name === 'A' ? pending : Promise.resolve(Uint8Array.of(2)),
    driveFilePath: (name) => name,
    pdfjs: { getDocument: ({ data, fontExtraProperties }) => {
      if (fontExtraProperties) seen.push(data[0]);
      return { promise: Promise.resolve({ getPage: async () => ({
        getTextContent: async () => ({ styles: {} }), getOperatorList: async () => ({ fnArray: [] }),
        getViewport: () => ({ height: 100 }),
      }) }), destroy: async () => { destroyed.push(data[0]); } };
    } } };
  runInNewContext(source.replace(/^import .*;\n/gmu, '')
    .replace(/^pdfjs.GlobalWorkerOptions.*;\n/mu, '')
    .replaceAll('import.meta.url', "'file:///test/'").replaceAll('export async function', 'async function'), context);
  const first = context.readQuestionPdf({ pdfFile: 'A', page: 1 });
  const second = context.readQuestionPdf({ pdfFile: 'B', page: 1 });
  release(Uint8Array.of(1));
  await Promise.all([first, second]);
  assert.deepEqual(seen.sort(), [1, 2]); assert.deepEqual(destroyed.sort(), [1, 2]);
});

test('successful structure cache evicts its least recently used entry after 64 items', async () => {
  const originalFetch = globalThis.fetch; const calls = [];
  const ids = Array.from({ length: 65 }, (_, index) => `cache${index}`);
  const entries = Object.fromEntries(ids.map((id) => [id, { status: 'needs_review', source: `${id}.json` }]));
  globalThis.fetch = async (url) => {
    const id = new URL(url).pathname.split('/').at(-1).replace('.json', '');
    if (id === 'index') return { ok: true, json: async () => ({ items: entries }) };
    calls.push(id);
    return { ok: true, json: async () => ({ schema: 'exam-editable-v1', status: 'needs_review',
      questionId: id, number: 1, sourcePdf: 'cache.pdf', page: 1, blocks: [
        { role: 'stem', runs: [{ kind: 'text', value: '본문' }] },
        ...[...'①②③④⑤'].map((label) => ({ role: 'choice', label, runs: [{ kind: 'text', value: '답' }] })),
      ] }) };
  };
  const lookup = async (id) => ({ id, no: 1, pdfFile: 'cache.pdf', page: 1 });
  clearEditableBatchCache();
  try {
    assert.equal((await createEditableBatch(ids, { getQuestion: lookup }).run()).completed, 65);
    const cached = await createEditableBatch(['cache64'], { getQuestion: lookup }).run();
    cached.items[0].result.paragraphs[0][0].value = 'mutated';
    const pristine = await createEditableBatch(['cache64'], { getQuestion: lookup }).run();
    assert.notEqual(pristine.items[0].result.paragraphs[0][0].value, 'mutated');
    assert.equal(calls.length, 65);
    await createEditableBatch(['cache0'], { getQuestion: lookup }).run();
    assert.equal(calls.length, 66); assert.equal(calls.at(-1), 'cache0');
  } finally { globalThis.fetch = originalFetch; clearEditableBatchCache(); }
});
