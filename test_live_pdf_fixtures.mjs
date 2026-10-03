import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildLiveStructure } from './live-convert.mjs';
import { createPreparedHwpx } from './editable-convert.mjs';
import { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';
import { documentScripts } from './test-hwpx-content.mjs';

const { fixtures } = JSON.parse(await readFile(new URL('./test-fixtures/live-formulas.json', import.meta.url)));
const standalone = JSON.parse(await readFile(new URL('./test-fixtures/standalone-fraction-baselines.json', import.meta.url)));
for (const { question, pdf, glyphMap } of standalone.fixtures) {
  test(`uses the equality axis for an isolated fraction: ${question.id}`, () => {
    if (question.id === '2021_06_math_ga_single_07') {
      assert.throws(() => buildLiveStructure(question, pdf, new Map(glyphMap)), /fraction script baseline collision/u);
      return;
    }
    const structure = buildLiveStructure(question, pdf, new Map(glyphMap));
    const scripts = structure.blocks.flatMap(b => b.runs).filter(r => r.kind === 'equation').map(r => r.script);
    assert.ok(scripts.some(s => s.includes('=') && s.includes('\\frac{')), JSON.stringify(scripts));
    if (question.id.startsWith('2019_11')) assert.ok(scripts.includes('\\frac{S_{9}-S_{5}}{S_{6}-S_{2}}=3'), JSON.stringify(scripts));
    if (question.id === '2021_06_math_ga_single_11') assert.ok(scripts.includes('g(x)=\\frac{f(x)}{(e^{x}+1)^{2}}'), JSON.stringify(scripts));
  });
}
const expected = {
  '2026_11_math_common_odd_01': [String.raw`9^{\frac{1}{4}}×3^{-\frac{1}{2}}`, String.raw`\sqrt{3}`, String.raw`3\sqrt{3}`],
  '2026_11_math_common_odd_02': [String.raw`f(x)=3x^{3}+4x+1`, String.raw`\lim_{h→0}\frac{f(1+h)-f(1)}{h}`],
  '2026_11_math_common_odd_04': [String.raw`f(x)=cases{3x-2 & (x<1) # x^{2}-3x+a & (x≥1)}`],
  '2026_11_math_common_odd_20': [String.raw`\sum_{k=1}^{12}a_{k}+\sum_{k=1}^{5}a_{2k+1}=a_{1}+a_{2}+\sum_{k=1}^{5}(2a_{2k+1}+a_{2k+2})`],
  '2026_11_math_calculus_odd_28': [String.raw`\int_{\frac{1}{2}}^{\frac{27}{4}}g(t)dt`],
};
for (const { question, pdf, glyphMap } of fixtures) {
  test(`original PDF geometry survives HWPX: ${question.id}`, async () => {
    const structure = buildLiveStructure(question, pdf, new Map(glyphMap));
    const scripts = structure.blocks.flatMap((block) => block.runs).filter((run) => run.kind === 'equation').map((run) => run.script);
    for (const script of expected[question.id] || []) assert.ok(scripts.includes(script), `${script}\nActual: ${JSON.stringify(scripts)}`);
    if (question.responseType !== 'short_answer') assert.equal(structure.blocks.filter((block) => block.role === 'choice').length, 5);
    const bytes = await createPreparedHwpx(structure);
    const saved = documentScripts(bytes);
    assert.equal(saved.length, scripts.length);
    for (const script of saved) {
      assert.ok(script.trim());
      assert.doesNotMatch(script, /[\uE000-\uF8FF]|brace(?:Top|Middle|Bottom|Extender)/u);
    }
    new HwpDocument(bytes).free();
  });
}
