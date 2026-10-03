import test from 'node:test';
import assert from 'node:assert/strict';
import { columnViewport, columnPresentation, studioZoomSlider } from './editor-viewport.mjs';
const page = { width: 794, columns: [{ x: 38, width: 348 }, { x: 408, width: 348 }] };
test('column fitting uses native coordinates and keeps the right column outside the viewport', () => {
  const view = columnViewport(page, 400);
  assert.ok(Math.abs(view.zoom * page.columns[0].width + 48 - 400) < 1e-9);
  assert.equal(view.left, columnPresentation(page, 400, view.zoom).cropStart);
  const visibleRight = page.width * (1 - view.rightCrop / 100);
  assert.ok(visibleRight < page.columns[1].x);
  assert.equal(page.columns.length, 2);
});
test('column viewport handles narrow hosts, bad geometry, and maximum zoom', () => {
  assert.equal(columnViewport(page, 40), null);
  assert.equal(columnViewport({ width: 0, columns: [] }, 900), null);
  assert.equal(columnViewport({ width: 794, columns: [{ x: 38, width: 0 }] }, 900), null);
  assert.equal(columnViewport(page, 10000).zoom, 1.5);
});
test('native slider mapping round-trips practical fitting scales to within one percent', () => {
  for (const zoom of [.1, .5, 1, 1.25, 2.44, 3, 5]) {
    const value = studioZoomSlider(zoom);
    const result = value <= 500 ? Math.round(10 * 10 ** (value / 500))
      : Math.round(100 * 5 ** ((value - 500) / 500));
    assert.ok(Math.abs(result - zoom * 100) <= 1, `${zoom}: ${result}`);
  }
});

test('visible question paper is centered at the native zoom without leaving an empty right half', () => {
  for (const zoom of [.75, 1, 1.24, 1.5]) {
    const view = columnPresentation(page, 1000, zoom);
    const width = page.width * zoom * (1 - (view.leftCrop + view.rightCrop) / 100);
    assert.ok(Math.abs(view.offset + width / 2 - 500) < 1e-9);
    assert.ok((page.width * (1 - view.rightCrop / 100)) < page.columns[1].x);
  }
});
