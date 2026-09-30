const checked = (json, message) => {
  const result = JSON.parse(json);
  if (!result.ok) throw new Error(message);
  return result;
};

export function validateDataTable(table, validateRuns) {
  if (!table || !Array.isArray(table.rows) || !table.rows.length || !Array.isArray(table.rows[0]) || !table.rows[0].length
    || table.rows.some((row) => !Array.isArray(row) || row.length !== table.rows[0].length)) throw new Error('잘못된 표입니다.');
  for (const row of table.rows) for (const runs of row) {
    if (!Array.isArray(runs) || runs.some((run) => run?.kind === 'table')) throw new Error('중첩 자료 표는 지원하지 않습니다.');
    validateRuns([runs]);
  }
  const occupied = new Set();
  for (const span of table.spans || []) {
    if (![span.row, span.col, span.rowSpan, span.colSpan].every(Number.isInteger) || span.row < 0 || span.col < 0
      || span.rowSpan < 1 || span.colSpan < 1 || span.row + span.rowSpan > table.rows.length
      || span.col + span.colSpan > table.rows[0].length) throw new Error('잘못된 표 병합입니다.');
    for (let row = span.row; row < span.row + span.rowSpan; row += 1) for (let col = span.col; col < span.col + span.colSpan; col += 1) {
      const key = `${row}:${col}`;
      if (occupied.has(key) || ((row !== span.row || col !== span.col) && table.rows[row][col].length)) throw new Error('표 병합이 겹칩니다.');
      occupied.add(key);
    }
  }
}

export function insertDataTable(document, index, table, equationScript) {
  const widthSum = table.widths?.reduce((sum, width) => sum + width, 0);
  const colWidths = widthSum > 0 ? table.widths.map((width) => Math.round(width / widthSum * 48000)) : undefined;
  const made = checked(document.createTableEx(JSON.stringify({ sectionIdx: 0, paraIdx: index, charOffset: 0,
    rowCount: table.rows.length, colCount: table.rows[0].length, colWidths, treatAsChar: false })), '자료 표를 만들지 못했습니다.');
  const parent = made.paraIdx;
  const control = made.controlIdx;
  for (const span of table.spans || []) if (span.rowSpan > 1 || span.colSpan > 1) {
    checked(document.mergeTableCells(0, parent, control, span.row, span.col, span.row + span.rowSpan - 1, span.col + span.colSpan - 1), '자료 표를 병합하지 못했습니다.');
  }
  // Merging removes covered cells; surviving cells are indexed in row-major order.
  let cellIndex = 0;
  for (const [row, cells] of table.rows.entries()) for (const [col, runs] of cells.entries()) {
    if ((table.spans || []).some((span) => row >= span.row && row < span.row + span.rowSpan
      && col >= span.col && col < span.col + span.colSpan && (row !== span.row || col !== span.col))) continue;
    const span = table.spans?.find((entry) => entry.row === row && entry.col === col);
    checked(document.setCellProperties(0, parent, control, cellIndex, JSON.stringify({
      ...(colWidths ? { width: colWidths.slice(col, col + (span?.colSpan || 1)).reduce((sum, width) => sum + width, 0) } : {}),
      applyInnerMargin: true, paddingTop: 220,
      paddingBottom: runs.some((run) => run.kind === 'equation' && /\\(?:frac|sum|int)|cases\{/u.test(run.script)) ? 1000 : 220,
    })), '표 칸의 크기를 설정하지 못했습니다.');
    const paragraphs = [[]];
    for (const run of runs) {
      if (run.kind === 'equation') paragraphs.at(-1).push(run);
      else for (const [part, value] of run.value.split('\n').entries()) {
        if (part) paragraphs.push([]);
        if (value) paragraphs.at(-1).push({ kind: 'text', value });
      }
    }
    for (let para = 1; para < paragraphs.length; para += 1) checked(document.splitParagraphInCell(0, parent, control, cellIndex, 0, 0), '표의 줄을 나누지 못했습니다.');
    for (const [para, contents] of paragraphs.entries()) {
      let text = '';
      const equations = [];
      for (const run of contents) {
        if (run.kind === 'equation') equations.push({ offset: text.length, script: run.script });
        else text += run.value;
      }
      if (text) checked(document.insertTextInCell(0, parent, control, cellIndex, para, 0, text), '표의 글자를 넣지 못했습니다.');
      for (const equation of equations.reverse()) {
        const scratch = parent + 1;
        checked(document.insertParagraph(0, scratch), '표 수식의 작업 문단을 만들지 못했습니다.');
        try {
          checked(document.insertEquation(0, scratch, 0, equationScript(equation.script), 1200, 0), '표 수식을 만들지 못했습니다.');
          JSON.parse(document.copySelection(0, scratch, 0, scratch, 1));
          checked(document.pasteInternalInCell(0, parent, control, cellIndex, para, equation.offset), '표 수식을 넣지 못했습니다.');
        } finally { document.deleteParagraph(0, scratch); }
      }
      checked(document.applyParaFormatInCell(0, parent, control, cellIndex, para,
        JSON.stringify({ alignment: 'center', lineSpacing: 180, lineSpacingType: 'Percent',
          spacingAfter: contents.some((run) => run.kind === 'equation' && /\\(?:frac|sum|int)|cases\{/u.test(run.script)) ? 700 : 0 })), '표 문단을 정렬하지 못했습니다.');
    }
    cellIndex += 1;
  }
  return parent;
}
