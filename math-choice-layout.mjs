import { typography, bodyCharFormat } from './document-typography.mjs?v=typography-20261003-3';
const labels = ['①', '②', '③', '④', '⑤'];
const checked = (value) => {
  const result = JSON.parse(value);
  if (!result.ok) throw new Error('수학 보기 배치에 실패했습니다.');
  return result;
};
const borders = Object.fromEntries(['Left', 'Right', 'Top', 'Bottom'].map((side) =>
  [`border${side}`, { type: 0, width: 0, color: '#000000' }]));

// Any subject may use compact choices; rendered width decides whether they fit.
export function findMathChoiceGroups(paragraphs) {
  const groups = [];
  for (let index = 0; index <= paragraphs.length - 5; index += 1) {
    const group = paragraphs.slice(index, index + 5);
    if (group.every((runs, position) => runs[0]?.kind === 'text'
      && new RegExp(`^${labels[position]}(?:\\s|$)`, 'u').test(runs[0].value.trimStart()))) {
      groups.push(group);
      index += 4;
    }
  }
  return groups;
}

function content(runs, normalizeEquation) {
  let text = '';
  const equations = [];
  for (const run of runs) {
    if (run.kind === 'text') text += run.value;
    else equations.push({ offset: text.length, script: normalizeEquation(run.script) });
  }
  return { text, equations };
}

function measure(document, choices, normalizeEquation) {
  const scratch = document.constructor.createEmpty();
  let reopened;
  try {
    scratch.createBlankDocument();
    for (const [index, runs] of choices.entries()) {
      const paragraph = index + 1;
      checked(scratch.insertParagraph(0, paragraph));
      const { text, equations } = content(runs, normalizeEquation);
      if (text) checked(scratch.insertText(0, paragraph, 0, text));
      for (const equation of equations.reverse()) checked(scratch.insertEquation(0, paragraph, equation.offset, equation.script, typography.equation, 0));
      checked(scratch.applyCharFormat(0, paragraph, 0, scratch.getLogicalLength(0, paragraph), JSON.stringify(bodyCharFormat)));
    }
    reopened = new document.constructor(scratch.exportHwpx());
    const pieces = [];
    for (let page = 0; page < reopened.pageCount(); page += 1) {
      pieces.push(...JSON.parse(reopened.getPageTextLayout(page)).runs,
        ...JSON.parse(reopened.getPageControlLayout(page)).controls);
    }
    return choices.map((_, index) => {
      const parts = pieces.filter((part) => part.paraIdx === index + 1 && (part.w > 0));
      const textLines = pieces.filter((part) => part.paraIdx === index + 1 && part.text?.trim());
      if (!parts.length || new Set(textLines.map((part) => part.y)).size > 1) return { width: Infinity, height: Infinity };
      return { width: Math.ceil((Math.max(...parts.map((part) => part.x + part.w)) - Math.min(...parts.map((part) => part.x))) * 75),
        height: Math.ceil((Math.max(...parts.map((part) => part.y + (part.h || 0))) - Math.min(...parts.map((part) => part.y))) * 75) };
    });
  } finally { reopened?.free(); scratch.free(); }
}

function fitSavedRows(document, table) {
  // Imported inline formulas can extend below the cell's nominal line height.
  // Check the saved representation and align real label baselines within each row.
  for (let pass = 0; pass < 8; pass += 1) {
    const reopened = new document.constructor(document.exportHwpx());
    const deficits = new Map();
    const baselineAdjustments = new Map();
    let geometry;
    try {
      for (let page = 0; page < reopened.pageCount(); page += 1) {
        const controls = JSON.parse(reopened.getPageControlLayout(page)).controls;
        const candidate = controls.find((c) => c.type === 'table' && c.secIdx === 0
          && c.paraIdx === table.paraIdx && c.controlIdx === table.controlIdx);
        if (!candidate) continue;
        geometry = candidate;
        const labelInk = [...reopened.renderPageSvg(page).matchAll(/<text\b([^>]*)>([①②③④⑤])(?:\s*)<\/text>/gu)]
          .map((match) => ({ label: match[2], x: Number(/\bx="([^"]+)"/u.exec(match[1])?.[1]),
            baseline: Number(/\by="([^"]+)"/u.exec(match[1])?.[1]) }));
        const anchors = candidate.cells.flatMap((cell) => {
          const label = labelInk.find((ink) => ink.label === labels[cell.cellIdx]
            && ink.x >= cell.x && ink.x < cell.x + cell.w
            && ink.baseline >= cell.y && ink.baseline <= cell.y + cell.h);
          return label ? [{ cell, baseline: label.baseline }] : [];
        });
        for (const { cell, baseline } of anchors) {
          const target = Math.max(...anchors.filter((a) => a.cell.row === cell.row).map((a) => a.baseline));
          if (target - baseline > .05) baselineAdjustments.set(cell.cellIdx, Math.ceil((target - baseline) * 75));
        }
        const content = [...controls.filter((c) => c.type === 'equation' && c.paraIdx === table.paraIdx && c.cellIdx !== undefined),
          ...JSON.parse(reopened.getPageTextLayout(page)).runs.filter((r) => r.parentParaIdx === table.paraIdx && r.text.trim())];
        for (const piece of content) {
          const cell = candidate.cells.find((c) => c.cellIdx === piece.cellIdx);
          if (!cell) continue;
          const height = piece.type === 'equation' ? piece.h : piece.fontSize;
          const deficit = Math.max(cell.y + 4 - piece.y, piece.y + height + 4 - cell.y - cell.h, 0);
          if (deficit > .2) deficits.set(cell.row, Math.max(deficits.get(cell.row) || 0, deficit));
        }
      }
    } finally { reopened.free(); }
    if (!geometry) throw new Error('선택지 표의 배치를 확인하지 못했습니다.');
    if (!deficits.size && !baselineAdjustments.size) return;
    for (const cell of geometry.cells) {
      if (!deficits.has(cell.row) && !baselineAdjustments.has(cell.cellIdx)) continue;
      const props = JSON.parse(document.getCellProperties(0, table.paraIdx, table.controlIdx, cell.cellIdx));
      // Top alignment preserves the label baseline when the row grows.
      checked(document.setCellProperties(0, table.paraIdx, table.controlIdx, cell.cellIdx,
        JSON.stringify({ height: props.height + Math.ceil((deficits.get(cell.row) || 0) * 75)
          + (baselineAdjustments.get(cell.cellIdx) || 0) + 75,
          paddingTop: props.paddingTop + (baselineAdjustments.get(cell.cellIdx) || 0) })));
    }
  }
  throw new Error('선택지의 수식 높이를 확보하지 못했습니다.');
}

export function insertChoiceLayout(document, index, choices, availableWidth, normalizeEquation = (script) => script) {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0 || choices.length !== 5 || findMathChoiceGroups(choices).length !== 1
    || choices.some((runs) => runs.some((run) => !['text', 'equation'].includes(run.kind)
      || (run.kind === 'text' && /\n/u.test(run.value))))) return null;
  const sizes = measure(document, choices, normalizeEquation);
  // Equal column slots retain the familiar 1–5 or 1–3 / 4–5 reading order.
  const padding = 300;
  const columns = [5, 3].find((count) => sizes.every((size) => size.width + 2 * padding <= Math.floor(availableWidth / count)));
  if (!columns) return null;
  const rows = Math.ceil(5 / columns);
  const width = Math.floor(availableWidth / columns);
  const made = checked(document.createTableEx(JSON.stringify({ sectionIdx: 0, paraIdx: index, charOffset: 0,
    rowCount: rows, colCount: columns, colWidths: Array(columns).fill(width), treatAsChar: true })));
  checked(document.setTableProperties(0, made.paraIdx, made.controlIdx, JSON.stringify({ ...borders,
    pageBreak: 0, outerLeft: 0, outerRight: 0, outerTop: 0, outerBottom: 0,
    paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0 })));
  for (let cell = 0; cell < rows * columns; cell += 1) {
    const rowStart = Math.floor(cell / columns) * columns;
    const height = Math.max(...sizes.slice(rowStart, rowStart + columns).map((size) => size.height)) + 600;
    checked(document.setCellProperties(0, made.paraIdx, made.controlIdx, cell, JSON.stringify({ ...borders,
      width, height, applyInnerMargin: true, paddingLeft: padding, paddingRight: padding,
      paddingTop: 300, paddingBottom: 300, verticalAlign: 0 })));
    if (!choices[cell]) continue;
    const { text, equations } = content(choices[cell], normalizeEquation);
    if (text) checked(document.insertTextInCell(0, made.paraIdx, made.controlIdx, cell, 0, 0, text));
    for (const equation of equations.reverse()) {
      const scratchIndex = made.paraIdx + 1;
      checked(document.insertParagraph(0, scratchIndex));
      try {
        checked(document.insertEquation(0, scratchIndex, 0, equation.script, typography.equation, 0));
        JSON.parse(document.copySelection(0, scratchIndex, 0, scratchIndex, 1));
        checked(document.pasteInternalInCell(0, made.paraIdx, made.controlIdx, cell, 0, equation.offset));
      } finally { checked(document.deleteParagraph(0, scratchIndex)); }
    }
    checked(document.applyCharFormatInCell(0, made.paraIdx, made.controlIdx, cell, 0, 0,
      document.getCellParagraphLength(0, made.paraIdx, made.controlIdx, cell, 0), JSON.stringify(bodyCharFormat)));
    checked(document.applyParaFormatInCell(0, made.paraIdx, made.controlIdx, cell, 0,
      JSON.stringify({ alignment: 'left', lineSpacing: 100, lineSpacingType: 'Percent', spacingAfter: 0 })));
  }
  fitSavedRows(document, made);
  return { paraIdx: made.paraIdx, controlIdx: made.controlIdx, columns, rows };
}
