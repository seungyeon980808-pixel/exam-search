import assert from 'node:assert/strict';
import test from 'node:test';
import { previewCropBounds, previewPaperEnd, previewQuestionBox } from './preview-crop.mjs';

function paper(width = 200, height = 600) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { width, height, data };
}
function mark(image, x0, y0, x1, y1, gray = 0) {
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    const i = (y * image.width + x) * 4;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = gray;
  }
}
function item(str, x, baseline, height = 12) {
  return { str, transform: [height, 0, 0, height, x, 1200 - baseline], height };
}

test('a short question occupying less than a quarter of its region trims to its final choice', () => {
  const image = paper();
  mark(image, 12, 10, 150, 20);
  for (let x = 12; x < 180; x += 35) mark(image, x, 80, x + 12, 100);
  assert.deepEqual(previewCropBounds(image), [0, 6, 200, 104]);
});

test('trim even modest whitespace; do not enlarge type by shrinking the column width', () => {
  const image = paper(200, 100);
  mark(image, 50, 3, 60, 90);
  assert.deepEqual(previewCropBounds(image), [0, 0, 200, 94]);
});

test('a gutter rule and partial sheet-count frame cannot keep an empty tail', () => {
  const image = paper();
  mark(image, 0, 0, 2, 580);
  mark(image, 0, 580, 20, 581);
  mark(image, 20, 10, 150, 20);
  mark(image, 20, 80, 180, 100);
  const box = [420, 600, 620, 1200];
  assert.deepEqual(previewCropBounds(image, { box, paperEnd: 1175 }), [2, 6, 200, 104]);
});

test('a closed frame around a long common passage keeps all four edges', () => {
  const image = paper(200, 300);
  mark(image, 1, 2, 2, 297); mark(image, 198, 2, 199, 297);
  mark(image, 1, 2, 199, 3); mark(image, 1, 296, 199, 297);
  mark(image, 15, 10, 170, 285);
  assert.deepEqual(previewCropBounds(image), [0, 0, 200, 300]);
});

test('unlabelled diagrams, fraction strokes, and faint print below text remain inside the crop', () => {
  const image = paper();
  mark(image, 10, 10, 150, 20);
  mark(image, 35, 200, 36, 321);
  mark(image, 35, 320, 140, 321, 240);
  assert.deepEqual(previewCropBounds(image), [0, 6, 200, 325]);
});

test('a standalone image reaching the bottom is retained in full', () => {
  const image = paper();
  mark(image, 30, 450, 180, 600);
  assert.deepEqual(previewCropBounds(image), [0, 446, 200, 600]);
});

test('blank and transparent rasters keep a safe fallback', () => {
  const image = paper();
  assert.deepEqual(previewCropBounds(image), [0, 0, 200, 600]);
  image.data.fill(0);
  assert.deepEqual(previewCropBounds(image), [0, 0, 200, 600]);
});

test('margins stay four page points at both thumbnail and full preview scales', () => {
  const image = paper();
  mark(image, 30, 40, 150, 100);
  assert.deepEqual(previewCropBounds(image, { scale: 2 }), [0, 32, 200, 108]);
});

test('known copyright and the paired sheet count exclude their enclosing frame', () => {
  const content = { items: [item('1', 400, 1094), item('32', 427, 1101),
    item('이 문제지에 관한 저작권은 ', 500, 1116, 10), item('한국교육과정평가원에 있습니다.', 640, 1116, 10)] };
  assert.equal(previewPaperEnd(content, 1200, 842), 1078);
});

test('ordinary numbers and quoted copyright in the body are not footer boundaries', () => {
  const content = { items: [item('저작권은 한국교육과정평가원', 30, 300), item('12', 425, 1100),
    item('저작권은 한국교육과정평가원에 있다고 설명한 글이다.', 30, 1120)] };
  assert.equal(previewPaperEnd(content, 1200, 842), 1200);
});

test('the confirmation box top stroke is excluded along with its heading', () => {
  const content = { items: [item('*', 449, 1019, 11), item('確認', 100, 800), item('확인 사항', 459, 1019, 11)] };
  const end = previewPaperEnd(content, 1200, 842);
  assert.equal(end, 996);
  const image = paper(200, 600);
  mark(image, 20, 20, 150, 25); mark(image, 20, 400, 180, 420);
  mark(image, 10, 503, 195, 504);
  assert.deepEqual(previewCropBounds(image, { box: [420, 500, 620, 1100], paperEnd: end }), [0, 16, 200, 424]);
});

test('stop an oversized indexed region before the next printed question, not before diagram labels', () => {
  const question = { no: 4, box: [420, 600, 820, 1140] };
  const content = { items: [item('4. 두 사건', 445, 616, 14),
    item('5. 그림 번호', 470, 650, 10), item('5. 다음 문항', 445, 820, 14)] };
  assert.deepEqual(previewQuestionBox(question, content, 1200), [420, 600, 820, 802]);
  assert.deepEqual(question.box, [420, 600, 820, 1140]);
});

test('a passage displayed above a question retains its own separate region', () => {
  const question = { no: 1, box: [20, 500, 400, 750], displayBox: [20, 100, 400, 450] };
  const content = { items: [item('[1~3] 다음 글', 30, 118), item('1. 물음', 30, 518), item('2. 물음', 30, 800)] };
  assert.deepEqual(previewQuestionBox(question, content, 1200), question.displayBox);
});
