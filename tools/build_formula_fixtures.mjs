import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { inQuestion } from '../live-fonts.mjs';

const [output, ...sources] = process.argv.slice(2);
if (!output || !sources.length) throw new Error('Usage: node tools/build_formula_fixtures.mjs output.json raw-question.json ...');
const registry = JSON.parse(await readFile(new URL('../data/editable/glyph-proofs.json', import.meta.url)));
const fixtures = [];
for (const source of sources) {
  const raw = JSON.parse(await readFile(source));
  const { question, pageHeight } = raw;
  const filter = (item) => inQuestion(item, question, pageHeight);
  const content = { items: raw.content.items.filter(filter) };
  const equationItems = raw.equationItems?.filter(filter);
  if (!equationItems) throw new Error(`Missing operator positions: ${source}`);
  const fonts = Object.fromEntries(Object.entries(raw.fonts).map(([key, font]) => [key, { name: font.name }]));
  const glyphMap = new Map();
  for (const item of [...content.items, ...equationItems]) {
    for (const char of item.str) {
      if (!/[\uE000-\uF8FF]/u.test(char)) continue;
      const family = fonts[item.fontName]?.name.split('+').at(-1).split('-Identity-')[0];
      const candidates = registry.fonts.filter((font) => font.fontName === family)
        .flatMap((font) => font.glyphs.filter((glyph) => glyph.codepoint === char.codePointAt(0)));
      const formulas = new Set(candidates.map((glyph) => glyph.formula));
      if (formulas.size !== 1) throw new Error(`Ambiguous fixture glyph: ${family}:${char.codePointAt(0)}`);
      glyphMap.set(`${item.fontName}:${char.codePointAt(0)}`, [...formulas][0]);
    }
  }
  fixtures.push({ question, pdf: { pageHeight, content, equationItems, fonts }, glyphMap: [...glyphMap] });
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ purpose: 'Geometry regression; glyph semantics verified separately by font-proof tests.', fixtures }));
console.log(`${fixtures.length} original PDF coordinate fixtures: ${output}`);
