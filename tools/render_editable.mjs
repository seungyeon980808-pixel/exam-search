import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const coreArg = args.indexOf('--rhwp-core');
const outputArg = args.indexOf('--output-dir');
if (coreArg < 0 || !args[coreArg + 1]) {
  throw new Error('Usage: node tools/render_editable.mjs --rhwp-core /path/to/rhwp-core [--output-dir data/editable]');
}

const coreDir = resolve(args[coreArg + 1]);
const outputDir = resolve(outputArg < 0 ? 'data/editable' : args[outputArg + 1]);
const { default: init, HwpDocument } = await import(pathToFileURL(join(coreDir, 'rhwp.js')).href);
await init({ module_or_path: await readFile(join(coreDir, 'rhwp_bg.wasm')) });

function appendParagraph(document, index, segments) {
  if (index > 0) document.insertParagraph(0, index);
  let offset = 0;
  for (const segment of segments) {
    if (segment.kind === 'equation') {
      const result = JSON.parse(document.insertEquation(0, index, offset, segment.script, 1200, 0));
      if (!result.ok) throw new Error(`수식을 삽입하지 못했습니다: ${segment.script}`);
      offset += 1;
    } else if (segment.value) {
      const result = JSON.parse(document.insertText(0, index, offset, segment.value));
      if (!result.ok) throw new Error(`텍스트를 삽입하지 못했습니다: ${segment.value}`);
      offset = result.charOffset;
    }
  }
}

function paragraphsFor(question) {
  const paragraphs = [];
  let previousRole = '';
  for (const block of question.blocks) {
    if (block.role !== previousRole && ['ask', 'bogi', 'choice'].includes(block.role)) {
      paragraphs.push([]);
    }
    if (block.role === 'bogi' && previousRole !== 'bogi') {
      paragraphs.push([{ kind: 'text', value: '<보기>' }]);
    }
    const label = block.role === 'stem' ? `${question.number}. `
      : block.role === 'choice' ? `${block.label} `
        : block.label ? `${block.label}. ` : '';
    paragraphs.push([
      ...(label ? [{ kind: 'text', value: label }] : []),
      ...block.runs,
    ]);
    previousRole = block.role;
  }
  return paragraphs;
}

for (const name of (await readdir(join(outputDir, 'prepared'))).filter((file) => file.endsWith('.json'))) {
  const question = JSON.parse(await readFile(join(outputDir, 'prepared', name), 'utf8'));
  if (question.schema !== 'exam-editable-v1' || question.status !== 'needs_review') {
    throw new Error(`지원하지 않는 문항 데이터: ${name}`);
  }
  const document = HwpDocument.createEmpty();
  let bytes;
  let paragraphs;
  try {
    const blank = JSON.parse(document.createBlankDocument());
    if (!blank.sectionCount) throw new Error('rhwp 빈 문서 생성 실패');
    paragraphs = paragraphsFor(question);
    paragraphs.forEach((segments, index) => appendParagraph(document, index, segments));
    bytes = document.exportHwpx();
  } finally {
    document.free();
  }

  const reopened = new HwpDocument(bytes);
  try {
    const expectedText = paragraphs.map((segments) => segments
      .filter((segment) => segment.kind === 'text').map((segment) => segment.value).join(''));
    const actualText = expectedText.map((_, index) => reopened.getTextRange(0, index, 0, 20000));
    if (JSON.stringify(actualText) !== JSON.stringify(expectedText)) {
      throw new Error(`${name}: 저장 후 문단 텍스트가 일치하지 않습니다.`);
    }
    const equations = JSON.parse(reopened.getControls()).filter((control) => control.ctrlId === 'eqed')
      .sort((left, right) => left.para - right.para || left.pos - right.pos);
    const expected = question.blocks.flatMap((block) => block.runs)
      .filter((run) => run.kind === 'equation').map((run) => run.script);
    const actual = equations.map((control) => JSON.parse(reopened.getEquationProperties(
      control.list, control.para, control.controlIndex, -1, -1,
    )).script);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${name}: 저장 후 수식 스크립트가 일치하지 않습니다. expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
    }
  } finally {
    reopened.free();
  }
  await writeFile(join(outputDir, `${question.questionId}.hwpx`), bytes);
  process.stdout.write(`${question.questionId}: HWPX ${bytes.length} bytes\n`);
}
