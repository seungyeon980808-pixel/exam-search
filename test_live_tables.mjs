import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionTableItems, tableFlow, restoreTableBlocks } from './live-tables.mjs';
import { createPreparedHwpx, validateParagraphs } from './editable-convert.mjs';
import { sectionXml } from './test-hwpx-content.mjs';
import { HwpDocument } from './vendor/rhwp-studio/assets/rhwp-core.js';

const grid = { box: [0, 20, 100, 80], rows: 2, cols: 2, cells: [
  { row: 0, col: 0, rowSpan: 1, colSpan: 2, box: [0, 20, 100, 50] },
  { row: 1, col: 0, rowSpan: 1, colSpan: 1, box: [0, 50, 50, 80] },
  { row: 1, col: 1, rowSpan: 1, colSpan: 1, box: [50, 50, 100, 80] },
] };
const item = (value, x, top, math = false) => ({ value, raw: value, x, y: 100 - top, height: 10, width: 10, math });
const items = [item('머리', 10, 35), item('x', 10, 65, true), item('52', 70, 65, true), item('본문', 0, 95)];

test('ruled merged cells retain every positioned item exactly once', () => {
  const result = partitionTableItems(items, [grid], 100);
  assert.equal(result.tables.length, 1);
  assert.deepEqual(result.tables[0].cells.map((cell) => cell.items.map((entry) => entry.value)), [['머리'], ['x'], ['52']]);
  assert.deepEqual(result.rest, [items[3]]);
  assert.deepEqual(new Set([...result.rest, ...result.tables.flatMap((table) => table.cells.flatMap((cell) => cell.items))]), new Set(items));
});

test('ambiguous boundary and choice overlap retain original flow', () => {
  const boundary = [...items, item('경계', 45, 65)];
  assert.equal(partitionTableItems(boundary, [grid], 100).tables.length, 0);
  const choices = [...items, item('①', 0, 75)];
  assert.equal(partitionTableItems(choices, [grid], 100).tables.length, 0);
  assert.deepEqual(partitionTableItems(boundary, [grid], 100).rest, boundary);
});

test('table anchor becomes one ordered table block and keeps equations', () => {
  const flow = tableFlow(partitionTableItems(items, [grid], 100), 100, (cell) => cell.map((entry) => entry.math
    ? { kind: 'equation', script: entry.value } : { kind: 'text', value: entry.value }));
  const blocks = restoreTableBlocks([
    { role: 'stem', runs: [{ kind: 'text', value: '앞' }] },
    { role: 'stem', runs: [{ kind: 'text', value: flow.tables[0].marker }] },
    { role: 'ask', runs: [{ kind: 'text', value: '뒤' }] },
  ], flow.tables);
  assert.equal(blocks[1].kind, 'table');
  assert.deepEqual(blocks[1].rows[1].map((runs) => runs[0].script), ['x', '52']);
  assert.equal(blocks[2].role, 'ask');
});

test('merged HWP cells preserve separate lines and editable equations after reload', async () => {
  const table = { kind: 'table', role: 'stem', rows: [
    [[{ kind: 'text', value: '합친 제목' }], []],
    [[{ kind: 'text', value: '첫째\n둘째' }], [{ kind: 'equation', script: '\\frac{1}{2}' }]],
  ], spans: grid.cells.map(({ row, col, rowSpan, colSpan }) => ({ row, col, rowSpan, colSpan })) };
  const bytes = await createPreparedHwpx({ schema: 'exam-editable-v1', status: 'needs_review', number: 1, blocks: [table] });
  const xml = sectionXml(bytes);
  assert.equal((xml.match(/<hp:tbl\b/gu) || []).length, 1);
  assert.equal((xml.match(/<hp:tc\b/gu) || []).length, 3);
  assert.match(xml, /colSpan="2"/u);
  for (const value of ['합친 제목', '첫째', '둘째']) assert.ok(xml.includes(value));
  assert.match(xml, /<hp:script>\{\{1\} over \{2\}\}<\/hp:script>/u);
  const document = new HwpDocument(bytes);
  try {
    const [control] = JSON.parse(document.getControls()).filter((entry) => entry.ctrlId === 'tbl');
    assert.ok(control);
    assert.equal(document.getCellParagraphCount(0, control.para, control.controlIndex, 1), 2);
    assert.match(document.renderPageSvg(0).replace(/<[^>]*>|\s/gu, ''), /합친제목/u);
  } finally { document.free(); }
});

test('content-covering merges cannot discard cells', () => {
  const table = { rows: [[[ { kind: 'text', value: 'a' } ], [ { kind: 'text', value: 'b' } ]]],
    spans: [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }] };
  assert.throws(() => validateParagraphs([[{ kind: 'table', table }]]), /표 병합/u);
});

test('ambiguous cell equations restore all original items to line flow', () => {
  const flow = tableFlow(partitionTableItems(items, [grid], 100), 100, () => { throw new Error('ambiguous equation'); });
  assert.equal(flow.tables.length, 0);
  assert.deepEqual(new Set(flow.items), new Set(items));
});

test('side-by-side table anchors both become native table blocks', () => {
  const blocks = restoreTableBlocks([{ role: 'stem', runs: [{ kind: 'text', value: 'markerA markerB' }] }],
    [{ marker: 'markerA', kind: 'table', rows: [[[]]] }, { marker: 'markerB', kind: 'table', rows: [[[]]] }]);
  assert.deepEqual(blocks.map((block) => block.kind), ['table', 'table']);
});

test('adjacent table captions follow their own panel instead of joining after both panels', () => {
  const right = { ...grid, box:[120,20,220,80], cells:grid.cells.map(c=>({...c,box:c.box.map((n,i)=>i%2?n:n+120)})) };
  const source = [...items.slice(0,3), ...items.slice(0,3).map(i=>({...i,x:i.x+120})),
    { ...item('(',40,93),width:3 },{ ...item('가',43,93),width:10 },{ ...item(')',53,93),width:3 },
    { ...item('(나)',160,93),width:16 }];
  const flow = tableFlow(partitionTableItems(source,[grid,right],100),100,cell=>cell.map(i=>({kind:'text',value:i.value})));
  assert.equal(flow.tables.length,2);
  assert.ok(!flow.items.some(i=>/[가나]/u.test(i.value)));
  const blocks=restoreTableBlocks([{role:'stem',runs:[{kind:'text',value:flow.tables.map(t=>t.marker).join(' ')}]}],flow.tables);
  assert.deepEqual(blocks.map(b=>b.kind==='table'?'table':b.runs.map(r=>r.value).join('')),['table','(가)','table','(나)']);
});

test('Korean panel bullets use a supported text glyph while equation multiplication is untouched', () => {
  const data=partitionTableItems(items,[grid],100);
  const flow=tableFlow(data,100,()=>[{kind:'text',value:'∙세균이 관여한다.'},{kind:'equation',script:'a∙b'}]);
  assert.equal(flow.tables[0].rows[0][0][0].value,'·세균이 관여한다.');
  assert.equal(flow.tables[0].rows[0][0][1].script,'a∙b');
});
