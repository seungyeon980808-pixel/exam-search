import { typography, hwpToPixels } from './document-typography.mjs';
// The imported core lays out equation ink below the text line's top, and its
// baseline property does not move that ink. Measure the imported layout instead
// of guessing a percentage from the equation script (or changing font sizes).
const read = JSON.parse;
const context = (item, text = false) => item.cellIdx === undefined
  ? [item.secIdx, item.paraIdx]
  : [item.secIdx, text ? item.parentParaIdx : item.paraIdx, item.controlIdx, item.cellIdx, item.cellParaIdx];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function equationLineGeometry(document) {
  const result = [];
  for (let page = 0; page < document.pageCount(); page += 1) {
    const info = read(document.getPageInfo(page));
    const column = (x) => Math.max(0, (info.columns || []).findLastIndex((c) => x >= c.x - 1));
    const rows = [];
    const flow = (address, x) => address.length === 2 ? `body:${address[0]}:${column(x)}` : address.slice(0, 4).join(':');
    for (const run of read(document.getPageTextLayout(page)).runs) {
      const address = context(run, true);
      let row = rows.find((r) => same(r.address, address) && Math.abs(r.y - run.y) < .2 && r.flow === flow(address, run.x));
      if (!row) rows.push(row = { page, address, flow: flow(address, run.x), y: run.y, bottom: run.y, equations: [] });
      row.fontSize = Math.max(row.fontSize || 0, run.fontSize || 0);
      row.lineHeight = Math.max(row.lineHeight || 0, run.h);
      row.bottom = Math.max(row.bottom, run.y + (run.fontSize || run.h));
    }
    for (const control of read(document.getPageControlLayout(page)).controls) {
      if (control.type !== 'equation') continue;
      const address = context(control);
      let candidates = rows.filter((r) => same(r.address, address) && r.flow === flow(address, control.x));
      // Cursor rectangles use a different baseline from rendered text for
      // imported equations and can even point to another wrapped line. Match
      // actual visible row origins, never synthesize a second row from a caret.
      let row = candidates.filter((r) => control.y >= r.y - 1
        && control.y <= r.y + (r.lineHeight || 0) + 1)
        .sort((a, b) => Math.abs(a.y - control.y) - Math.abs(b.y - control.y))[0];
      if (!row) {
        rows.push(row = { page, address, flow: flow(address, control.x), y: control.y, bottom: control.y, lineHeight: control.h, equations: [] });
      }
      row.bottom = Math.max(row.bottom, control.y + control.h);
      row.equations.push({ x: control.x, y: control.y, width: control.w, height: control.h });
    }
    result.push(...rows.sort((a, b) => a.y - b.y));
  }
  return result;
}

export function equationLineCollisions(document, gap = 2) {
  const rows = equationLineGeometry(document);
  return rows.flatMap((row) => {
    if (!row.equations.length) return [];
    const next = rows.find((other) => other.page === row.page && other.flow === row.flow && other.y > row.y + .2);
    return next && row.bottom + gap > next.y + .2
      ? [{ address: row.address, page: row.page, bottom: row.bottom, nextTop: next.y, fontSize: row.fontSize || hwpToPixels(typography.body), deficit: row.bottom + gap - next.y }] : [];
  });
}

/** Call on the HWPX-reopened document before pagination. Ordinary paragraphs
 * retain their exact formatting; only equation paragraphs with measured overlap
 * are changed. Fixed/AtLeast are deliberately avoided: this core either ignores
 * their advance or silently parses an unsupported type as Percent. */
export function repairEquationSpacing(document) {
  const changes = [];
  for (let pass = 0; pass < 24; pass += 1) {
    const collisions = equationLineCollisions(document);
    if (!collisions.length) return changes;
    const targets = new Map();
    for (const hit of collisions) {
      const key = JSON.stringify(hit.address);
      if (!targets.has(key) || targets.get(key).deficit < hit.deficit) targets.set(key, hit);
    }
    for (const { address, deficit, fontSize } of targets.values()) {
      const cell = address.length > 2;
      const props = read(cell ? document.getCellParaPropertiesAt(...address) : document.getParaPropertiesAt(...address));
      // Use the measured text size. Re-measure after every pass.
      const previous = props.lineSpacingType === 'Percent' ? props.lineSpacing : 100;
      const lineSpacing = previous + Math.max(10, Math.ceil(deficit * 100 / fontSize));
      const format = JSON.stringify({ lineSpacingType: 'Percent', lineSpacing });
      const applied = read(cell ? document.applyParaFormatInCell(...address, format) : document.applyParaFormat(...address, format));
      if (!applied.ok) throw new Error('수식 줄 간격을 보정하지 못했습니다.');
      if (cell) {
        // Imported cell paragraphs retain their old line segments after format
        // changes. A balanced text edit invalidates those segments without
        // changing text, equation controls, or their logical offsets.
        if (!read(document.insertTextInCell(...address, 0, ' ')).ok
          || !read(document.deleteTextInCell(...address, 0, 1)).ok)
          throw new Error('수식 표의 줄 배치를 갱신하지 못했습니다.');
      }
      if (!cell) {
        if (!read(document.insertText(...address, 0, ' ')).ok
          || !read(document.deleteText(...address, 0, 1)).ok)
          throw new Error('수식 문단의 줄 배치를 갱신하지 못했습니다.');
      }
      changes.push({ address, previous, lineSpacing, deficit });
    }
  }
  throw new Error('수식 줄 겹침을 해소하지 못했습니다. ' + JSON.stringify(equationLineCollisions(document)));
}
