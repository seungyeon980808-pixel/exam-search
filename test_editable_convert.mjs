import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { contentRuns, createEditableHwpx, createPreparedHwpx, paragraphsForText } from './editable-convert.mjs';
import { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';

const index = JSON.parse(await readFile(new URL('./data/questions.json', import.meta.url), 'utf8'));

test('indexed question separates stem, claims and five inline choices', () => {
  const question = index.items.find((item) => item.id === 'p1_2027_06_01');
  const lines = paragraphsForText(question.text, question.no).map((runs) => runs.map((run) => run.value).join(''));
  assert.match(lines[0], /^1\. 다음은/u);
  assert.equal(lines.filter((line) => /^[①②③④⑤]/u.test(line)).length, 5);
  assert.ok(lines.some((line) => line.startsWith('ㄱ.')));
});

test('formula markup becomes a native editable equation after HWPX roundtrip', async () => {
  const source = String.raw`6. 속력은 \수식{\frac{3}{2}}이다.
① ㄱ ② ㄴ ③ ㄷ ④ ㄱ, ㄴ ⑤ ㄱ, ㄷ`;
  assert.deepEqual(contentRuns(String.raw`a \수식{\frac{3}{2}} b`).map((run) => run.kind),
    ['text', 'equation', 'text']);
  const bytes = await createEditableHwpx({ no: 6, text: source });
  const document = new HwpDocument(bytes);
  try {
    assert.match(document.getTextRange(0, 0, 0, 100), /6\. 속력은 이다\./u);
    const controls = JSON.parse(document.getControls()).filter((control) => control.ctrlId === 'eqed');
    assert.equal(controls.length, 1);
    const equation = JSON.parse(document.getEquationProperties(
      controls[0].list, controls[0].para, controls[0].controlIndex, -1, -1,
    ));
    assert.equal(equation.script, '{3} over {2}');
  } finally {
    document.free();
  }
});

test('unreadable CID text is not presented as a converted question', () => {
  const question = index.items.find((item) => item.id === 'b1_2015_06_01');
  assert.deepEqual(paragraphsForText(question.text, question.no), []);
});

test('unreadable quality blocks even partial non-CID extraction', async () => {
  const question = index.items.find((item) => item.id === 'b2_2009_11_20');
  assert.ok(paragraphsForText(question.text, question.no).length > 0);
  await assert.rejects(createEditableHwpx(question), /색인 텍스트를 읽을 수 없어/u);
});

test('CID placeholder inside an otherwise readable question cannot become editable text', async () => {
  await assert.rejects(createEditableHwpx({
    no: 6, textQuality: 'text', text: '6. 전압은 (cid:42)이다.\n① ㄱ ② ㄴ ③ ㄷ ④ ㄱ, ㄴ ⑤ ㄱ, ㄷ',
  }), /복원되지 않은 글자/u);
});

test('a question missing a choice cannot become a complete editable document', async () => {
  await assert.rejects(createEditableHwpx({
    no: 6, textQuality: 'text', text: '6. 물체의 운동은?\n① ㄱ ② ㄴ ③ ㄷ ④ ㄱ, ㄴ',
  }), /선지 다섯 개/u);
});

test('2027 June Physics I question 6 keeps every text-layer formula as editable equations', async () => {
  const manifest = JSON.parse(await readFile(new URL('./data/editable/index.json', import.meta.url), 'utf8'));
  const entry = manifest.items.p1_2027_06_06;
  assert.equal(entry?.status, 'needs_review', '문항 6은 수식 없는 색인 텍스트로 변환되고 있습니다.');
  const bytes = await readFile(new URL(entry.file, import.meta.url));
  const document = new HwpDocument(bytes);
  try {
    const controls = JSON.parse(document.getControls()).filter((control) => control.ctrlId === 'eqed');
    const scripts = controls.map((control) => JSON.parse(document.getEquationProperties(
      control.list, control.para, control.controlIndex, -1, -1,
    )).script);
    assert.deepEqual(scripts, [
      'S_{1}', 'S_{2}', 't=0', 'T_{0}', 't={T_{0}} over {4}', 'bar {PR}', '2',
    ], 'S의 첨자, 시간, 주기, 분수, 선분, 숫자 수식이 모두 편집 가능해야 합니다.');
    const first = controls[0];
    const changed = JSON.parse(document.setEquationProperties(
      first.list, first.para, first.controlIndex, -1, -1, JSON.stringify({ script: 'S_{3}' }),
    ));
    assert.equal(changed.ok, true);
    const reopened = new HwpDocument(document.exportHwpx());
    try {
      const edited = JSON.parse(reopened.getEquationProperties(
        first.list, first.para, first.controlIndex, -1, -1,
      ));
      assert.equal(edited.script, 'S_{3}', '수식 객체는 수정 후 HWPX로 다시 저장되어야 합니다.');
    } finally {
      reopened.free();
    }
  } finally {
    document.free();
  }
});

test('private-use math glyphs cannot silently become plain-text drafts', async () => {
  const question = index.items.find((item) => item.id === 'p1_2027_06_06');
  await assert.rejects(createEditableHwpx(question), /수식을 안전하게 복원/u);
});

test('prepared formulas remain inline with their surrounding Korean text', () => {
  const xml = execFileSync('unzip', [
    '-p', fileURLToPath(new URL('./data/editable/p1_2027_06_06.hwpx', import.meta.url)),
    'Contents/section0.xml',
  ], { encoding: 'utf8' });
  const content = [...xml.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>|<hp:script>([\s\S]*?)<\/hp:script>/gu)]
    .map((match) => match[2] === undefined ? match[1] : `[${match[2]}]`).join('');
  assert.match(content, /두 지점 \[S_\{1\}\], \[S_\{2\}\]에서/u);
  assert.match(content, /시간 \[t=0\]일 때/u);
  assert.match(content, /각각 \[T_\{0\}\]으로 같다/u);
  assert.match(content, /ㄱ\. \[t=\{T_\{0\}\} over \{4\}\]일 때/u);
  assert.match(content, /ㄷ\. \[bar \{PR\}\]에서 상쇄 간섭이 일어나는 지점의 개수는 \[2\]개이다/u);
});

test('prepared JSON opens directly as editable HWPX without a stored binary', async () => {
  const prepared = JSON.parse(await readFile(new URL('./data/editable/prepared/p1_2027_06_06.json', import.meta.url)));
  const bytes = await createPreparedHwpx(prepared);
  const document = new HwpDocument(bytes);
  try {
    const equations = JSON.parse(document.getControls()).filter((control) => control.ctrlId === 'eqed');
    assert.equal(equations.length, 7);
    const text = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => document.getTextRange(0, index, 0, 20000)).join(' ');
    assert.match(text, /두 지점/u);
    assert.match(text, /P에서와 Q에서가 같다/u);
  } finally {
    document.free();
  }
});
