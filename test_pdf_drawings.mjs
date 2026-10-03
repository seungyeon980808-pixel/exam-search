import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingPrimitives, figureRegions, insideFigure, tableGrids, textItemBox } from './pdf-drawings.mjs';

// Operator codes from pdf.js 6.x (src/shared/util.js OPS) and path codes (DrawOPS).
const OPS = { save: 10, restore: 11, transform: 12, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23,
  fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27, endPath: 28, clip: 29, eoClip: 30,
  setLineWidth: 2, setDash: 6, setGState: 9, setStrokeRGBColor: 58, setFillRGBColor: 59, shadingFill: 62,
  paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, beginGroup: 76, endGroup: 77,
  paintImageMaskXObject: 83, paintImageXObject: 85, paintInlineImageXObject: 86, constructPath: 91 };
const H = 800;

// Small builder for operator lists in top-left page points.
function ops() {
  const fnArray = [], argsArray = [];
  const add = (fn, args = null) => { fnArray.push(fn); argsArray.push(args); };
  const y = (top) => H - top;
  const path = (paintOp, data) => {
    const xs = [], ys = [];
    for (let i = 0; i < data.length;) {
      const code = data[i++];
      const n = code === 0 || code === 1 ? 1 : code === 2 ? 3 : code === 3 ? 2 : 0;
      for (let k = 0; k < n; k += 1) { xs.push(data[i++]); ys.push(data[i++]); }
    }
    add(OPS.constructPath, [paintOp, [new Float32Array(data)], new Float32Array([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])]);
  };
  const api = {
    list: { fnArray, argsArray },
    add,
    color(stroke = '#000000', fill = null) { add(OPS.setStrokeRGBColor, [stroke]); if (fill) add(OPS.setFillRGBColor, [fill]); return api; },
    rect(x0, t0, x1, t1, paint = OPS.stroke) { path(paint, [0, x0, y(t1), 1, x1, y(t1), 1, x1, y(t0), 1, x0, y(t0), 4]); return api; },
    line(x0, t0, x1, t1) { path(OPS.stroke, [0, x0, y(t0), 1, x1, y(t1)]); return api; },
    curve(x0, t0, x1, t1) { path(OPS.stroke, [0, x0, y(t0), 2, x0, y(t1), x1, y(t1), x1, y(t1)]); return api; },
    // Filled triangle, the arrowhead KICE draws at the end of axes.
    arrow(x, top, size = 3) { path(OPS.fill, [0, x - size, y(top - size), 1, x + size, y(top), 1, x - size, y(top + size), 4]); return api; },
    image(x0, t0, x1, t1) { add(OPS.save); add(OPS.transform, [x1 - x0, 0, 0, t1 - t0, x0, y(t1)]); add(OPS.paintImageXObject, ['img']); add(OPS.restore); return api; },
  };
  return api;
}

// pdf.js text item: transform[4], transform[5] is the baseline start, bottom-left origin.
const text = (str, x, baseTop, size = 10, width = str.length * size * 0.9) =>
  ({ str, transform: [size, 0, 0, size, x, H - baseTop], width, height: size, fontName: 'f' });

// A question body of running text that sets the body size.
const body = (top) => [
  text('다음은 물체의 운동을 알아보기 위한 실험이다.', 40, top),
  text('이에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른 것은?', 40, top + 16),
];

test('drawingPrimitives tracks the CTM and flips to a top-left origin', () => {
  const b = ops();
  b.add(OPS.save);
  b.add(OPS.transform, [2, 0, 0, 2, 10, 20]);
  b.add(OPS.constructPath, [OPS.stroke, [new Float32Array([0, 0, 0, 1, 50, 0])], new Float32Array([0, 0, 50, 0])]);
  b.add(OPS.restore);
  b.add(OPS.constructPath, [OPS.fill, [new Float32Array([0, 100, 100, 1, 200, 100, 1, 200, 150, 1, 100, 150, 4])], new Float32Array([100, 100, 200, 150])]);
  b.add(OPS.paintFormXObjectBegin, [new Float32Array([1, 0, 0, 1, 300, 300]), null]);
  b.add(OPS.save);
  b.add(OPS.transform, [40, 0, 0, 30, 0, 0]);
  b.add(OPS.paintImageXObject, ['img']);
  b.add(OPS.restore);
  b.add(OPS.paintFormXObjectEnd);
  const prims = drawingPrimitives(b.list, OPS, H);
  const line = prims.find((p) => p.type === 'line');
  assert.deepEqual([line.x0, line.y0, line.x1, line.y1], [10, H - 20, 110, H - 20]);
  assert.equal(line.orient, 'h');
  assert.equal(line.width, 2);
  const rect = prims.find((p) => p.type === 'rect');
  assert.deepEqual(rect.box, [100, H - 150, 200, H - 100]);
  assert.equal(rect.paint, 'fill');
  const image = prims.find((p) => p.type === 'image');
  assert.deepEqual(image.box, [300, H - 330, 340, H - 300]);
});

test('drawingPrimitives splits paths into lines, curves and rectangles and skips clip paths', () => {
  const b = ops();
  b.add(OPS.constructPath, [OPS.stroke, [new Float32Array([0, 0, 0, 1, 30, 40, 2, 40, 40, 50, 50, 60, 40])], new Float32Array([0, 0, 60, 40])]);
  b.add(OPS.clip);
  b.add(OPS.constructPath, [OPS.endPath, [new Float32Array([0, 0, 0, 1, 500, 0, 1, 500, 500, 1, 0, 500, 4])], new Float32Array([0, 0, 500, 500])]);
  const prims = drawingPrimitives(b.list, OPS, H);
  assert.deepEqual(prims.map((p) => p.type + (p.orient || '')), ['lined', 'curve']);
});

test('drawingPrimitives drops strokes hidden by an empty or distant clip', () => {
  const b = ops();
  b.add(OPS.save);
  b.add(OPS.clip);
  b.add(OPS.constructPath, [OPS.endPath, [new Float32Array([0, 0, 0, 1, 10, 0, 1, 10, 10, 1, 0, 10, 4])], new Float32Array([0, 0, 10, 10])]);
  b.add(OPS.constructPath, [OPS.stroke, [new Float32Array([0, 100, 100, 1, 200, 100])], new Float32Array([100, 100, 200, 100])]);
  b.add(OPS.restore);
  b.add(OPS.constructPath, [OPS.stroke, [new Float32Array([0, 100, 100, 1, 200, 100])], new Float32Array([100, 100, 200, 100])]);
  assert.equal(drawingPrimitives(b.list, OPS, H).filter((p) => p.type === 'line').length, 1);
});

test('a 보기 frame is not a figure and keeps its text', () => {
  const b = ops().color().rect(40, 100, 360, 170);
  const items = [...body(60),
    text('<보 기>', 180, 104),
    text('ㄱ. A의 속력은 일정하다.', 50, 125),
    text('ㄴ. B는 운동 방향이 바뀐다.', 50, 145),
    text('ㄷ. 1초일 때 A와 B의 위치가 같다.', 50, 165)];
  const prims = drawingPrimitives(b.list, OPS, H);
  const regions = figureRegions(prims, items, H);
  assert.equal(regions.length, 0);
  assert.equal(items.filter((item) => insideFigure(item, regions, H)).length, 0);
  assert.equal(tableGrids(prims, items, H, [0, 0, 400, 800]).length, 0);
});

test('a framed passage with a column rule and background shading stays text', () => {
  const b = ops().color('#000000', '#eeeeee').rect(40, 100, 360, 160, OPS.fill).color().line(385, 20, 385, 780).rect(36, 96, 364, 164);
  const items = [...body(60), text('[실험 과정] 물체를 빗면에 놓고 가만히 놓는다.', 50, 120), text('(가) 수레의 속력을 측정한다.', 50, 140), text('(나)', 50, 155)];
  const prims = drawingPrimitives(b.list, OPS, H);
  const regions = figureRegions(prims, items, H);
  assert.equal(regions.length, 0);
  assert.equal(items.filter((item) => insideFigure(item, regions, H)).length, 0);
});

test('a line graph is a figure and its axis labels are dropped, the stem is kept', () => {
  const b = ops().color()
    .line(100, 300, 100, 200).line(100, 300, 260, 300)
    .curve(100, 290, 250, 210).line(150, 300, 200, 250).line(200, 250, 240, 230);
  const labels = [text('속', 88, 230, 7), text('력', 88, 238, 7), text('0', 94, 308, 7), text('시간(s)', 228, 312, 7, 24), text('A', 252, 214, 7), text('(가)', 170, 328, 9, 16)];
  const items = [...body(60), ...labels, text('이 실험에 대한 설명으로 옳은 것은?', 40, 360)];
  const prims = drawingPrimitives(b.list, OPS, H);
  const regions = figureRegions(prims, items, H);
  assert.equal(regions.length, 1);
  const dropped = items.filter((item) => insideFigure(item, regions, H)).map((item) => item.str);
  assert.deepEqual(dropped.sort(), labels.map((item) => item.str).sort());
});

test('a picture is a figure but running text beside it is not a label', () => {
  const b = ops().image(250, 90, 360, 180);
  const items = [text('그림과 같이 물체가 운동한다.', 40, 100), text('물체의 가속도는 일정하다.', 40, 116), text('A', 300, 130, 8), text('B', 330, 170, 8)];
  const prims = drawingPrimitives(b.list, OPS, H);
  const regions = figureRegions(prims, items, H);
  assert.equal(regions.length, 1);
  assert.deepEqual(items.filter((item) => insideFigure(item, regions, H)).map((item) => item.str), ['A', 'B']);
});

const dialogue = (left, top) => [text('정치는 좁은 의미와 넓은 의미로', left, top, 8),
  text('구분해 이해할 수 있어요. 둘 중', left, top + 10, 8), text('여러분이 생각하는 의미를 말해요.', left, top + 20, 8)];

test('speech-bubble dialogue above a cartoon is kept, the name under a person is dropped', () => {
  const b = ops().image(40, 150, 360, 260).color().rect(60, 90, 200, 140);
  const items = [...body(40), ...dialogue(64, 102), text('갑', 300, 250, 8)];
  const prims = drawingPrimitives(b.list, OPS, H);
  const regions = figureRegions(prims, items, H);
  const dropped = items.filter((item) => insideFigure(item, regions, H)).map((item) => item.str);
  assert.deepEqual(dropped, ['갑']);
});

test('a picture with running text on it is a background and nothing on it is dropped', () => {
  const b = ops().image(40, 90, 360, 260);
  const items = [...body(40), ...dialogue(64, 110), text('갑', 300, 250, 8)];
  const prims = drawingPrimitives(b.list, OPS, H);
  const regions = figureRegions(prims, items, H);
  assert.equal(regions.length, 0);
  assert.equal(items.filter((item) => insideFigure(item, regions, H)).length, 0);
});

test('choice markers next to a figure are never dropped', () => {
  const b = ops().color().line(60, 100, 160, 100).line(60, 100, 60, 40).arrow(160, 100).arrow(60, 40)
    .curve(60, 90, 150, 50).line(60, 60, 150, 95);
  const items = [...body(10), text('①', 44, 45), text('0', 54, 108, 7), text('t', 150, 108, 7)];
  const prims = drawingPrimitives(b.list, OPS, H);
  const regions = figureRegions(prims, items, H);
  assert.equal(insideFigure(items.find((item) => item.str === '①'), regions, H), false);
  assert.equal(insideFigure(items.find((item) => item.str === 't'), regions, H), true);
});

function tableOps(merged = false) {
  const b = ops().color();
  const xs = [50, 130, 210, 290], ys = [100, 120, 140, 160];
  b.line(xs[0], ys[0], xs[3], ys[0]).line(xs[0], ys[3], xs[3], ys[3]);
  b.line(xs[0], ys[0], xs[0], ys[3]).line(xs[3], ys[0], xs[3], ys[3]);
  b.line(xs[0], ys[1], xs[3], ys[1]);
  // merged: the lower-right 2 x 2 block has no inner rules.
  if (merged) b.line(xs[0], ys[2], xs[1], ys[2]);
  else b.line(xs[0], ys[2], xs[3], ys[2]);
  b.line(xs[1], ys[0], xs[1], ys[3]);
  if (merged) b.line(xs[2], ys[0], xs[2], ys[1]);
  else b.line(xs[2], ys[0], xs[2], ys[3]);
  return b;
}

test('a ruled data table becomes a grid and its text is kept', () => {
  const items = [...body(60), text('실험', 70, 114), text('I', 165, 114), text('II', 245, 114),
    text('질량', 70, 134), text('1 kg', 160, 134), text('2 kg', 240, 134), text('속력', 70, 154), text('2 m/s', 155, 154), text('4 m/s', 235, 154)];
  const prims = drawingPrimitives(tableOps().list, OPS, H);
  const regions = figureRegions(prims, items, H);
  assert.equal(items.filter((item) => insideFigure(item, regions, H)).length, 0);
  const [grid, ...rest] = tableGrids(prims, items, H, [30, 50, 380, 400]);
  assert.equal(rest.length, 0);
  assert.equal(grid.rows, 3);
  assert.equal(grid.cols, 3);
  assert.equal(grid.cells.length, 9);
  assert.deepEqual(grid.box, [50, 100, 290, 160]);
  assert.equal(tableGrids(prims, items, H, [30, 50, 250, 400]).length, 0, 'tables must lie inside the question box');
});

test('an unambiguous merged cell is reported with its span', () => {
  const items = [...body(60), text('실험', 70, 114), text('I', 165, 114), text('II', 245, 114),
    text('질량', 70, 134), text('1 kg로 같다', 190, 144), text('속력', 70, 154)];
  const prims = drawingPrimitives(tableOps(true).list, OPS, H);
  const [grid] = tableGrids(prims, items, H, [30, 50, 380, 400]);
  assert.ok(grid);
  const merged = grid.cells.filter((cell) => cell.rowSpan > 1 || cell.colSpan > 1);
  assert.deepEqual(merged.map(({ row, col, rowSpan, colSpan }) => ({ row, col, rowSpan, colSpan })), [{ row: 1, col: 1, rowSpan: 2, colSpan: 2 }]);
  assert.equal(grid.cells.length, 6);
});

test('text that straddles a cell rule makes the grid ambiguous', () => {
  const items = [...body(60), text('실험', 70, 114), text('I', 165, 114), text('II', 245, 114),
    text('질량', 70, 134), text('1 kg로 같다', 190, 144), text('속력', 70, 154)];
  const prims = drawingPrimitives(tableOps().list, OPS, H);
  assert.equal(tableGrids(prims, items, H, [30, 50, 380, 400]).length, 0);
});

test('a grid with a rule that stops halfway is not returned', () => {
  const b = tableOps();
  b.line(50, 130, 170, 130);
  const items = [...body(60), text('실험', 70, 114), text('I', 165, 114), text('II', 245, 114), text('질량', 70, 134), text('속력', 70, 154)];
  const prims = drawingPrimitives(b.list, OPS, H);
  assert.equal(tableGrids(prims, items, H, [30, 50, 380, 400]).length, 0);
});

test('a plotted grid (graph paper) is a figure, not a table', () => {
  const b = ops().color();
  for (let x = 100; x <= 220; x += 20) b.line(x, 100, x, 200);
  for (let t = 100; t <= 200; t += 20) b.line(100, t, 220, t);
  b.curve(100, 200, 140, 160).curve(140, 160, 180, 125).curve(180, 125, 220, 110).line(100, 190, 220, 120);
  const items = [...body(40), text('0', 92, 208, 7), text('10', 196, 208, 7), text('시간', 223, 204, 7)];
  const prims = drawingPrimitives(b.list, OPS, H);
  assert.equal(tableGrids(prims, items, H, [30, 20, 380, 400]).length, 0);
  const regions = figureRegions(prims, items, H);
  assert.equal(regions.length, 1);
  assert.deepEqual(items.filter((item) => insideFigure(item, regions, H)).map((item) => item.str), ['0', '10', '시간']);
});

test('textItemBox converts the baseline to a top-left box', () => {
  const { box, size } = textItemBox(text('A', 100, 200, 10, 7), H);
  assert.equal(size, 10);
  assert.deepEqual(box.map((v) => Math.round(v * 10) / 10), [100, 191.5, 107, 202]);
});




test('a shallow standalone sequence image is a figure, while an inline image remains text-owned', () => {
  // Exact embedded-image dimensions from b2_2025_11_18 (PDF page 4).
  const b = ops().image(106.260002, 642.301025, 400.199997, 655.500977);
  const items = [...body(605), text('다음 조건을 만족한다.', 106, 682, 11.5)];
  const regions = figureRegions(drawingPrimitives(b.list, OPS, H), items, H);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].kind, 'image');
  const inline = [...items, text('이 자료와 연결되는 문장의 내용이다.', 401, 653, 11.5)];
  assert.equal(figureRegions(drawingPrimitives(b.list, OPS, H), inline, H).length, 0);
});

test('a one-column two-row source panel is editable while an undivided passage frame is not a table', () => {
  const b = ops().rect(40,100,240,180).line(40,120,240,120);
  const items = [...body(60), text('특징',130,115),text('∙세균이 관여한다.',50,140),text('∙질소가 전환된다.',50,160)];
  const grids = tableGrids(drawingPrimitives(b.list,OPS,H),items,H,[0,0,400,800]);
  assert.equal(grids.length,1); assert.equal(grids[0].cols,1); assert.equal(grids[0].rows,2);
  const frame = ops().rect(40,100,240,180);
  assert.equal(tableGrids(drawingPrimitives(frame.list,OPS,H),items,H,[0,0,400,800]).length,0);
});
