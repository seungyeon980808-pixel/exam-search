import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createCollectionHwpx, paragraphsForPrepared } from './editable-convert.mjs';
import { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';

const evidence = process.env.EVIDENCE_DIR || '.omo/evidence/multi-question-rhwp';
const fixtures = await Promise.all(['p1_2027_06_06', 'p1_2027_06_18', 'p1_2027_06_06'].map(async (id, index) => {
  const source = JSON.parse(await readFile(new URL(`./data/editable/prepared/${id}.json`, import.meta.url)));
  return { questionId: `${id}-${index}`, sourceLabel: `출처 ${index + 1}: ${source.title}`, paragraphs: paragraphsForPrepared(source) };
}));
const controls = (doc) => JSON.parse(doc.getControls()).filter((control) => control.ctrlId === 'eqed');
const script = (doc, control) => JSON.parse(doc.getEquationProperties(control.list, control.para, control.controlIndex, -1, -1)).script;

test('collection reopens with ordered sources, original numbers, inline equations and editable first/last equations', async () => {
  const original = structuredClone(fixtures);
  const bytes = await createCollectionHwpx(fixtures);
  await mkdir(evidence, { recursive: true });
  const path = join(evidence, 'collection-roundtrip.hwpx');
  await writeFile(path, bytes);
  const xml = execFileSync('unzip', ['-p', path, 'Contents/section0.xml'], { encoding: 'utf8' });
  const doc = new HwpDocument(bytes);
  try {
    const equations = controls(doc);
    assert.equal(equations.length, fixtures.flatMap((item) => item.paragraphs.flat()).filter((run) => run.kind === 'equation').length);
    const scripts = equations.map((control) => script(doc, control));
    const six = ['S_{1}', 'S_{2}', 't = 0', 'T_{0}', 't = {{T_{0}} over {4}}', 'bar {PR}', '2'];
    assert.deepEqual(scripts, [...six, '2m', '2m', '3m', 't', 't = t_{0}', 't = 2t_{0}',
      't = {{3} over {2}}t_{0}', 't = {{5} over {2}}t_{0}', '4', 'g',
      'v_{0} = {{1} over {14}}gt_{0}', 't = {{1} over {2}}t_{0}', '{{25} over {14}}mg',
      't = {{3} over {2}}t_{0}', 't = {{5} over {2}}t_{0}', '2', ...six]);
    assert.ok(scripts.some((value) => value.includes('over')));
    const inline = [...xml.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>|<hp:script>([\s\S]*?)<\/hp:script>/gu)]
      .map((match) => match[2] === undefined ? match[1] : `[${match[2]}]`).join('');
    assert.ok(inline.indexOf('출처 1:') < inline.indexOf('출처 2:') && inline.indexOf('출처 2:') < inline.indexOf('출처 3:'));
    assert.equal((inline.match(/6\. 그림은/gu) || []).length, 2);
    assert.match(inline, /두 지점 \[S_\{1\}\], \[S_\{2\}\]에서/u);
    for (const label of '①②③④⑤') assert.equal(inline.split(label).length - 1, 3);
    const edits = [[equations[0], 'a^{2}'], [equations.at(-1), 'z_{3}']];
    for (const [control, value] of edits) assert.equal(JSON.parse(doc.setEquationProperties(control.list, control.para,
      control.controlIndex, -1, -1, JSON.stringify({ script: value }))).ok, true);
    const editedBytes = doc.exportHwpx();
    await writeFile(join(evidence, 'collection-edited.hwpx'), editedBytes);
    const reopened = new HwpDocument(editedBytes);
    try {
      assert.equal(script(reopened, controls(reopened)[0]), 'a^{2}');
      assert.equal(script(reopened, controls(reopened).at(-1)), 'z_{3}');
      await writeFile(join(evidence, 'collection-equations.json'), JSON.stringify({ before: scripts,
        after: controls(reopened).map((control) => script(reopened, control)), inline }, null, 2));
    } finally { reopened.free(); }
    assert.deepEqual(fixtures, original);
  } finally { doc.free(); }
});
test('empty collection and malformed runs reject without producing a document', async () => {
  await assert.rejects(createCollectionHwpx([]));
  const broken = structuredClone(fixtures); broken[0].paragraphs[0].push({ kind: 'other', value: 'x' });
  await assert.rejects(createCollectionHwpx(broken));
});
test('paragraph insertion failure frees the document without exporting', async () => {
  const insert = HwpDocument.prototype.insertParagraph, free = HwpDocument.prototype.free;
  const exporting = HwpDocument.prototype.exportHwpx;
  let freed = 0, exported = 0;
  HwpDocument.prototype.insertParagraph = () => JSON.stringify({ ok: false });
  HwpDocument.prototype.free = function () { freed += 1; return free.call(this); };
  HwpDocument.prototype.exportHwpx = function () { exported += 1; return exporting.call(this); };
  try {
    await assert.rejects(createCollectionHwpx(fixtures), /문단/u);
    assert.equal(freed, 1); assert.equal(exported, 0);
  } finally {
    HwpDocument.prototype.insertParagraph = insert;
    HwpDocument.prototype.free = free; HwpDocument.prototype.exportHwpx = exporting;
  }
});
