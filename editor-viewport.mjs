// Geometry remains in native paper coordinates, so text selection and caret hit
// testing continue to use the editor's own zoom and scrolling implementation.
export function columnViewport(geometry, viewportWidth, padding = 24) {
  const column = geometry?.columns?.[0];
  if (!column || !Number.isFinite(geometry.width) || geometry.width <= 0
    || !Number.isFinite(column.x) || !Number.isFinite(column.width) || column.width <= 0
    || !Number.isFinite(viewportWidth) || viewportWidth <= padding * 2) return null;
  const zoom = Math.max(.1, Math.min(1.5, (viewportWidth - padding * 2) / column.width));
  const presentation = columnPresentation(geometry, viewportWidth, zoom, padding);
  return { zoom, left: presentation.cropStart, rightCrop: presentation.rightCrop };
}
// The bundled studio's native slider uses two logarithmic ranges (10–100–500%).
export function studioZoomSlider(zoom) {
  const percent = Math.max(10, Math.min(500, Math.round(zoom * 100)));
  return Math.round(percent <= 100 ? Math.log10(percent / 10) * 500
    : 500 + Math.log(percent / 100) / Math.log(5) * 500);
}

export function columnPresentation(geometry, viewportWidth, zoom, padding = 24) {
  const column = geometry.columns[0];
  const gap = geometry.columns[1]?.x - column.x - column.width;
  const margin = Math.min(padding, Number.isFinite(gap) && gap > 0 ? gap * zoom / 2 : padding);
  const left = Math.max(0, column.x * zoom - margin);
  const right = Math.min(geometry.width * zoom, (column.x + column.width) * zoom + margin);
  return { leftCrop: left / (geometry.width * zoom) * 100,
    rightCrop: (geometry.width * zoom - right) / (geometry.width * zoom) * 100,
    cropStart: left, offset: Math.max(padding, (viewportWidth - (right - left)) / 2) };
}
