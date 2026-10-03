import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createCollectionHwpx } from './editable-convert.mjs';
import { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';
import { documentScripts } from './test-hwpx-content.mjs';
import { equationLineCollisions } from './equation-spacing.mjs';

const evidence = '.omo/evidence/1003-typography/engine';
function glyph(svg, value) {
  const matches = [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/gu)].filter((match) => match[2] === value);
  assert.equal(matches.length, 1, `Expected one ${value} glyph`);
  return Number(matches[0][1].match(/\by="([^"]+)"/u)[1]);
}
const runs = (label) => [{ kind: 'text', value: label + ' ' },
  { kind: 'equation', script: '∠A={pi} over {3}' }, { kind: 'text', value: ' 뒤' }];
async function fixture() {
  return createCollectionHwpx([{ questionId: 'baseline-contract', sourceLabel: '출처',
    question: { no: 1, subject: 'math', responseType: 'short_answer' },
    paragraphs: [runs('앞'), [{ kind: 'table', table: { rows: [[runs('칸')]] } }]] }]);
}

test('fraction superscript denominator stays above the base baseline with serialized native metrics', async () => {
  const bytes = await fixture();
  const doc = new HwpDocument(bytes);
  try {
    const svg = doc.renderEquationPreview('3^{{{1} over {2}}}', 1000, 0);
    const base = glyph(svg, '3'), denominator = glyph(svg, '2');
    assert.ok(denominator < base - 1, JSON.stringify({ base, denominator }));
    const control = JSON.parse(doc.getPageControlLayout(0)).controls.find((item) => item.type === 'equation' && item.cellIdx === undefined);
    assert.equal(JSON.parse(doc.setEquationProperties(control.secIdx, control.paraIdx, control.controlIdx, -1, -1,
      JSON.stringify({ script: '3^{{{1} over {2}}}' }))).ok, true);
    const props = JSON.parse(doc.getEquationProperties(control.secIdx, control.paraIdx, control.controlIdx, -1, -1));
    const height = Number(svg.match(/\bheight="([^"]+)"/u)[1]);
    assert.equal(props.baseline, Math.round(base / height * 100));
    const reopened = new HwpDocument(doc.exportHwpx());
    try {
      assert.equal(JSON.parse(reopened.getEquationProperties(control.secIdx, control.paraIdx, control.controlIdx, -1, -1)).baseline, props.baseline);
    } finally { reopened.free(); }
    await mkdir(evidence, { recursive: true });
    await writeFile(`${evidence}/fraction-exponent.svg`, svg);
    await writeFile(`${evidence}/fraction-exponent.json`, JSON.stringify({ base, denominator, serializedBaseline: props.baseline, height }, null, 2));
  } finally { doc.free(); }
});

test('saved body and native cell equations share adjacent text baselines and survive reopening', async () => {
  const bytes = await fixture();
  const originalScripts = documentScripts(bytes);
  let saved = bytes;
  const observations = [];
  for (let roundtrip = 0; roundtrip < 2; roundtrip++) {
    const doc = new HwpDocument(saved);
    try {
      assert.deepEqual(equationLineCollisions(doc), []);
      const svg = doc.renderPageSvg(0);
      const intrinsicBaseline = glyph(doc.renderEquationPreview('∠A={pi} over {3}', 1000, 0), 'A');
      const controls = JSON.parse(doc.getPageControlLayout(0)).controls.filter((item) => item.type === 'equation');
      assert.equal(controls.length, 2);
      for (const [label, inCell] of [['앞', false], ['칸', true]]) {
        const control = controls.find((item) => (item.cellIdx !== undefined) === inCell);
        const textBaseline = glyph(svg, label);
        const equationBaseline = control.y + intrinsicBaseline;
        // The public geometry API rounds coordinates to tenths of a CSS pixel.
        assert.ok(Math.abs(textBaseline - equationBaseline) <= .11, JSON.stringify({ label, textBaseline, equationBaseline }));
        observations.push({ roundtrip, label, textBaseline, equationBaseline });
      }
      saved = doc.exportHwpx();
      assert.deepEqual(documentScripts(saved), originalScripts);
      await mkdir(evidence, { recursive: true });
      await writeFile(`${evidence}/body-cell-${roundtrip}.svg`, svg);
    } finally { doc.free(); }
  }
  await writeFile(`${evidence}/body-cell-baselines.json`, JSON.stringify(observations, null, 2));
});
