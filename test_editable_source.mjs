import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEditableContent } from './editable-source.mjs';

const question = { id: 'a', no: 1, pdfFile: 'a.pdf', page: 1,
  text: '1. 본문\n① 가 ② 나 ③ 다 ④ 라 ⑤ 마' };
const prepared = () => ({ schema: 'exam-editable-v1', status: 'needs_review', questionId: 'a',
  number: 1, sourcePdf: 'a.pdf', page: 1, blocks: [
    { role: 'stem', runs: [{ kind: 'text', value: '본문 ' }, { kind: 'equation', script: 'x^{2}' }] },
    ...[...'①②③④⑤'].map((label) => ({ role: 'choice', label, runs: [{ kind: 'text', value: '답' }] })),
  ] });
const options = (entry = {}) => ({ entries: async () => ({ a: entry }),
  readPrepared: async () => prepared(), convert: async () => prepared() });

test('prepared JSON has precedence and retains native equation runs', async () => {
  const deps = options({ status: 'needs_review', source: 'a.json' });
  deps.convert = () => { throw new Error('must not convert'); };
  const result = await resolveEditableContent(question, deps);
  assert.equal(result.provenance, 'prepared');
  assert.equal(result.paragraphs.flat().find((run) => run.kind === 'equation').script, 'x^{2}');
});
test('PDF content is returned when no prepared source exists', async () => {
  assert.equal((await resolveEditableContent(question, options())).provenance, 'pdf');
});
test('safe index fallback carries the PDF failure warning', async () => {
  const deps = options(); deps.convert = async () => { throw new Error('offline'); };
  const result = await resolveEditableContent(question, deps);
  assert.equal(result.provenance, 'index-draft'); assert.match(result.warnings[0], /offline/u);
});
for (const field of ['questionId', 'number', 'sourcePdf', 'page']) {
  test(`mismatched prepared ${field} rejects`, async () => {
    const deps = options({ status: 'needs_review', source: 'a.json' });
    deps.readPrepared = async () => ({ ...prepared(), [field]: 'wrong' });
    await assert.rejects(resolveEditableContent(question, deps), /일치/u);
  });
}
for (const invalid of [
  { kind: 'unknown', value: 'wrong' }, { kind: 'equation', script: ' ' },
  { kind: 'text', value: '(cid:42)' }, { kind: 'equation', script: '\uE001' },
]) {
  test(`invalid prepared run ${JSON.stringify(invalid)} rejects`, async () => {
    const deps = options({ status: 'needs_review', source: 'a.json' });
    deps.readPrepared = async () => { const data = prepared(); data.blocks[0].runs.push(invalid); return data; };
    await assert.rejects(resolveEditableContent(question, deps));
  });
}
for (const change of ['missing', 'duplicate', 'empty']) {
  test(`${change} prepared choice rejects`, async () => {
    const deps = options({ status: 'needs_review', source: 'a.json' });
    deps.readPrepared = async () => {
      const data = prepared();
      if (change === 'missing') data.blocks.pop();
      if (change === 'duplicate') data.blocks.push(data.blocks.at(-1));
      if (change === 'empty') data.blocks.at(-1).runs = [];
      return data;
    };
    await assert.rejects(resolveEditableContent(question, deps));
  });
}
for (const entry of [{ status: 'unavailable' }, { status: 'needs_review', file: 'a.hwpx' }]) {
  test(`${JSON.stringify(entry)} never falls back after PDF error`, async () => {
    const deps = options(entry); deps.convert = async () => { throw new Error('PDF error'); };
    await assert.rejects(resolveEditableContent(question, deps), /PDF error/u);
  });
}
test('binary-only entry uses PDF structure without reading or merging its binary', async () => {
  assert.equal((await resolveEditableContent(question, options({ status: 'needs_review', file: 'a.hwpx' }))).provenance, 'pdf');
});
for (const change of [{ textQuality: 'unreadable' }, { text: `${question.text} (cid:2)` },
  { text: `${question.text} \uE001` }, { text: '1. 본문 ① 가' }]) {
  test(`unsafe index fallback rejects ${JSON.stringify(change)}`, async () => {
    const deps = options(); deps.convert = async () => { throw new Error('offline'); };
    await assert.rejects(resolveEditableContent({ ...question, ...change }, deps));
  });
}

test('cancelled manifest lookup cannot start PDF conversion or fallback', async () => {
  const controller = new AbortController(); let converted = false, release;
  const pending = new Promise((resolve) => { release = resolve; });
  const work = resolveEditableContent(question, { signal: controller.signal, entries: () => pending,
    convert: async () => { converted = true; return prepared(); } });
  controller.abort(); release({});
  await assert.rejects(work, { name: 'AbortError' }); assert.equal(converted, false);
});
