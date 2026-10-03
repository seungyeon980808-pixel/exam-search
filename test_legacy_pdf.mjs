import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { documentSegments } from './editable-convert.mjs';
import { questionBoxFromPage } from './live-convert.mjs';

const workerSource = await readFile(new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url), 'utf8');

test('old KICE PDFs labelled Unidocs-Korea1 use the Adobe-Korea1 Unicode table', () => {
  // 2015~2017 papers embed Korean fonts as "Unidocs" Korea1 without a ToUnicode map.
  assert.match(workerSource, /registry === "Unidocs" && properties\.cidSystemInfo\.ordering === "Korea1" \? "Adobe"/u);
});

test('a <보기> title and its ㄱ/ㄴ/ㄷ lines become one boxed segment', () => {
  const text = (value) => [{ kind: 'text', value }];
  const segments = documentSegments([text('1. 본문'), text('<보기>'), text('ㄱ. 첫째'), text('ㄴ. 둘째'), [], text('① ㄱ')]);
  assert.deepEqual(segments.map((segment) => segment.kind), ['paragraph', 'box', 'paragraph', 'paragraph']);
  assert.equal(segments[1].rows.length, 2);
  assert.deepEqual(documentSegments([text('<보기>'), text('① ㄱ')]).map((segment) => segment.kind), ['paragraph', 'paragraph']);
});

test('a wrong indexed box is replaced by the printed question number column', () => {
  const at = (str, x, top) => ({ str, width: 20, transform: [10, 0, 0, 10, x, 1000 - top], fontName: 'f' });
  const pdf = { pageHeight: 1000, pageWidth: 800, fonts: { f: { name: 'Batang' } },
    content: { items: [at('3.', 60, 300), at('그림은', 80, 300), at('4.', 60, 600), at('5.', 420, 120), at('6.', 420, 500)] } };
  const box = questionBoxFromPage({ no: 3, box: [410, 280, 800, 480] }, pdf);
  assert.deepEqual(box.map(Math.round), [54, 288, 412, 588]);
  assert.equal(questionBoxFromPage({ no: 9, box: [0, 0, 1, 1] }, pdf), null);
});
