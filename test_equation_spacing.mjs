import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPreparedHwpx } from './editable-convert.mjs';
import { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';
import { documentScripts, inlineContent } from './test-hwpx-content.mjs';
import { equationLineCollisions, equationLineGeometry, repairEquationSpacing } from './equation-spacing.mjs';

const evidence = resolve(process.env.EQUATION_SPACING_EVIDENCE || '.omo/evidence/equation-spacing');
const read = JSON.parse;
async function fixture() {
  const prepared = read(await readFile(new URL('./data/editable/prepared/p1_2027_06_18.json', import.meta.url)));
  const doc = new HwpDocument(await createPreparedHwpx(prepared));
  // Deliberately recreate the imported small advance regardless of whether the
  // production converter already invokes the repair under test.
  const addresses = new Map(equationLineGeometry(doc).filter((r) => r.equations.length).map((r) => [JSON.stringify(r.address), r.address]));
  for (const address of addresses.values()) {
    const format = JSON.stringify({ lineSpacing: 100, lineSpacingType: 'Percent' });
    if (address.length === 2) doc.applyParaFormat(...address, format);
    else {
      doc.applyParaFormatInCell(...address, format);
      doc.insertTextInCell(...address, 0, ' ');
      doc.deleteTextInCell(...address, 0, 1);
    }
  }
  const reopened = new HwpDocument(doc.exportHwpx());
  doc.free();
  return reopened;
}

test('imported fraction ink clears following body and cell lines after save/reopen without changing plain text formats', async () => {
  await mkdir(evidence, { recursive: true });
  const doc = await fixture();
  try {
    const original = doc.exportHwpx();
    const before = equationLineGeometry(doc);
    const collisions = equationLineCollisions(doc);
    assert.ok(collisions.some((c) => c.address.length === 2), 'fixture must overlap in body text');
    assert.ok(collisions.some((c) => c.address.length === 5), 'fixture must overlap in a native table cell');
    const eqParagraphs = new Set(before.filter((r) => r.equations.length && r.address.length === 2).map((r) => r.address[1]));
    const plain = Array.from({ length: doc.getParagraphCount(0) }, (_, p) => p).filter((p) => !eqParagraphs.has(p));
    const formats = plain.map((p) => doc.getParaPropertiesAt(0, p));
    const changes = repairEquationSpacing(doc);
    assert.ok(changes.length > 0);
    assert.deepEqual(equationLineCollisions(doc), []);
    assert.deepEqual(plain.map((p) => doc.getParaPropertiesAt(0, p)), formats);
    const bytes = doc.exportHwpx();
    assert.deepEqual(documentScripts(bytes), documentScripts(original));
    assert.equal(inlineContent(bytes), inlineContent(original));
    const reopened = new HwpDocument(bytes);
    try {
      assert.deepEqual(equationLineCollisions(reopened), []);
      assert.deepEqual(repairEquationSpacing(reopened), [], 'repair must be idempotent');
      const after = equationLineGeometry(reopened);
      // Independent observable: each equation-bearing row's actual ink bottom
      // is separated from the next rendered row in its own page/column/cell.
      for (const row of after.filter((r) => r.equations.length)) {
        const next = after.find((r) => r.page === row.page && r.flow === row.flow && r.y > row.y + .2);
        if (next) assert.ok(next.y >= Math.max(...row.equations.map((e) => e.y + e.height)) + 1.8);
      }
      await writeFile(`${evidence}/geometry.json`, JSON.stringify({ before, collisions, changes, after, plainParagraphs: plain }, null, 2));
      await writeFile(`${evidence}/repaired.hwpx`, bytes);
      await writeFile(`${evidence}/overlap-before.hwpx`, original);
    } finally { reopened.free(); }
  } finally { doc.free(); }
});

test('baseline and vertical alignment properties cannot be mistaken for visible placement changes in the bundled core', async () => {
  await mkdir(evidence, { recursive: true });
  const doc = await fixture();
  try {
    const eq = read(doc.getPageControlLayout(0)).controls.find((c) => c.type === 'equation' && c.cellIdx === undefined && c.h > 30);
    assert.ok(eq);
    const observations = [];
    for (const props of [{ baseline: 50 }, { baseline: 100 }, { vertOffset: -750 }, { vertAlign: 'Center' }]) {
      assert.equal(read(doc.setEquationProperties(0, eq.paraIdx, eq.controlIdx, -1, -1, JSON.stringify(props))).ok, true);
      doc.insertText(0, eq.paraIdx, 0, ' ');
      doc.deleteText(0, eq.paraIdx, 0, 1);
      const now = read(doc.getPageControlLayout(0)).controls.find((c) => c.paraIdx === eq.paraIdx && c.controlIdx === eq.controlIdx && c.cellIdx === undefined);
      assert.equal(now.y, eq.y);
      assert.equal(now.h, eq.h);
      observations.push({ props, before: eq, after: now });
    }
    await writeFile(`${evidence}/unsupported-baseline.json`, JSON.stringify(observations, null, 2));
  } finally { doc.free(); }
});

test('saved mixed text and inline equations stay within the column without reducing font or losing content', async () => {
  const { createCollectionHwpx } = await import('./editable-convert.mjs');
  const fixture = read(await readFile(new URL('./test-fixtures/inline-text-width.json', import.meta.url)));
  const own = [[{kind:'text',value:'20. '}, ...fixture.runs], ...[...'①②③④⑤'].map(label=>[{kind:'text',value:label+' 답'}])];
  const expected = fixture.runs.map(r=>r.kind==='text'?r.value:'').join('').replace(/\s/gu,'');
  for(const pagePerQuestion of [false,true]) {
    const bytes = await createCollectionHwpx([{questionId:'width',sourceLabel:'폭 검증',question:{subject:'p1'},paragraphs:own}],{pagePerQuestion});
    let doc = new HwpDocument(bytes);
    try {
      for(let cycle=0;cycle<2;cycle++) {
        for(let p=0;p<doc.pageCount();p++) {
          const info=read(doc.getPageInfo(p)), edge=info.columns[0].x+info.columns[0].width;
          for(const run of read(doc.getPageTextLayout(p)).runs.filter(r=>r.parentParaIdx===undefined&&r.text.trim())) {
            assert.ok(run.x+run.w<=edge+1,JSON.stringify(run));
            if (!run.text.includes('폭 검증')) assert.ok(Math.abs(run.fontSize-1000/75)<.05,JSON.stringify(run));
          }
        }
        const out=doc.exportHwpx();
        assert.deepEqual(documentScripts(out),documentScripts(bytes));
        const next=new HwpDocument(out);doc.free();doc=next;
      }
      const { documentText } = await import('./test-hwpx-content.mjs');
      assert.ok(documentText(doc.exportHwpx()).replace(/\s/gu,'').includes(expected));
      assert.equal(doc.pageCount(),1,'repair must not inflate a short question to more pages');
      const { repairSavedTextBounds } = await import('./editable-convert.mjs');
      const paragraphCount=doc.getParagraphCount(0);
      assert.equal(repairSavedTextBounds(doc),0,'already fitted paragraphs are not split again');
      assert.equal(doc.getParagraphCount(0),paragraphCount);
      for(let p=2;p<paragraphCount;p++) {
        const props=read(doc.getParaPropertiesAt(0,p));
        assert.equal(props.spacingBefore,0);assert.equal(props.spacingAfter,0);assert.equal(props.indent,0);
      }
      await writeFile(resolve(evidence,`inline-width-${pagePerQuestion}.hwpx`),doc.exportHwpx());
      await writeFile(resolve(evidence,`inline-width-${pagePerQuestion}.svg`),doc.renderPageSvg(0));
    } finally {doc.free();}
  }
});
