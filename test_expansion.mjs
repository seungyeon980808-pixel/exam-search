import {createCatalogMetadata} from './catalog-metadata.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { catalogFiles, curriculumDisplayState, curriculumYearMismatch, prepareQuestions, searchFiles, searchQuestions } from './search.mjs';

const fixture = prepareQuestions([
  { id: 'ko_2026_06_01', pdfFile: '국어_2026_06_홀수형.pdf', subject: 'ko', subjectLabel: '국어', year: 2026, month: 6, no: 1, page: 1, exam: '2026학년도 6월 모평', text: '서술 방식 인물 관점', curriculum: { framework: '2015 개정', unit: '독서', standards: [{ code: '[12독서01-01]', unit: '독서', text: '독서 성취기준' }] } },
  { id: 'math_2026_06_22', pdfFile: '수학_2026_06_확통.pdf', subject: 'math', subjectLabel: '수학 확률과 통계', year: 2026, month: 6, no: 22, page: 6, exam: '2026학년도 6월 모평', text: '확률 분포', curriculum: { framework: '2015 개정', unit: '확률', standards: [{ code: '[12확통03-01]', unit: '확률', text: '분포' }] } },
]);

test('new subject and variable question count come from metadata, not science filename pattern', () => {
  const files = catalogFiles([{ pdfFile: '국어_2026_06_홀수형.pdf' }, { pdfFile: '수학_2026_06_확통.pdf' }], fixture);
  assert.equal(files.length, 2);
  assert.deepEqual(files.map((file) => file.questionCount), [1, 1]);
  assert.equal(files[0].subjectLabel, '국어');
});

test('curriculum and answer text do not enlarge body search, but metadata filters work', () => {
  assert.equal(searchQuestions(fixture, '성취기준').length, 0);
  assert.equal(searchQuestions(fixture, '인물 관점').length, 1);
  assert.equal(searchQuestions(fixture, '인물 관점 분포').length, 0);
  assert.equal(searchQuestions(fixture, '', { framework: '2015 개정', unit: '독서', standard: '[12독서01-01]' }).length, 1);
  assert.equal(searchQuestions(fixture, '', { framework: '2009 개정' }).length, 0);
  const files = catalogFiles(fixture.map((item) => item.pdfFile), fixture);
  assert.equal(searchFiles(files, fixture, '', { unit: '독서' }).length, 1);
  assert.equal(searchFiles(files, fixture, '인물 관점', { standard: '[12독서01-01]' })[0].matchedCount, 1);
});

test('UI keeps answer state ephemeral and separate from body index', async () => {
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  const data = await readFile(new URL('./data.mjs', import.meta.url), 'utf8');
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /type="checkbox" id="answer-toggle"/);
  assert.doesNotMatch(html, /id="answer-toggle"[^>]*checked/);
  assert.match(app, /answerToggle\.checked = false/);
  assert.doesNotMatch(app, /(?:localStorage|sessionStorage)\.(?:getItem|setItem)\([^;]*(?:answerToggle|answer-toggle)/);
  assert.match(app, /localStorage\.setItem\('exam-paper-profiles', JSON\.stringify\(savedProfiles\)\)/);
  assert.match(data, /\.\/data\/answers\.json/);
  assert.match(data, /verificationStatus === 'verified'/);
  assert.match(app, /source\.removeAttribute\('href'\)/);
  assert.match(app, /source\.hidden = !href/);
});

test('answer index is lazy, separate, and only verified answers are returned', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  const requests = [];
  const files = fixture.map((item) => ({ pdfFile: item.pdfFile, publicPath: `기출문제/${item.pdfFile}`, pageCount: 8 }));
  const payloads = {
    'questions.json': { pdfCount: 2, questionCount: 2, items: fixture },
    'files.json': files,
    'synonyms.json': { map: {} },
    'answers.json': { items: [
      { questionId: 'ko_2026_06_01', answer: '3', sourcePath: '정답/국어.pdf', sourcePage: 1, verificationStatus: 'verified' },
      { questionId: 'math_2026_06_22', answer: '42', verificationStatus: 'candidate' },
    ] },
  };
  globalThis.location = { href: 'https://example.test/' };
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').at(-1);
    requests.push(name);
    return { ok: true, status: 200, json: async () => payloads[name] };
  };
  try {
    const { getJson } = await import(`./data.mjs?test=${Date.now()}`);
    assert.equal(searchQuestions(fixture, '42').length, 0);
    assert.equal(requests.length, 0);
    assert.equal(requests.includes('answers.json'), false);
    const verified = await getJson('/api/answer?id=ko_2026_06_01');
    assert.equal(verified.answer, '3');
    assert.equal(await getJson('/api/answer?id=math_2026_06_22'), null);
    assert.equal(requests.filter((name) => name === 'answers.json').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.location = originalLocation;
  }
});

test('2015 links before 2021, including 2020, are unverified and absent from curriculum filters', async () => {
  const make = (year, code) => ({ id: `science_${year}`, subject: 'p1', subjectLabel: '물리학Ⅰ',
    pdfFile: `p1_${year}_11.pdf`, year, month: 11, no: 1, page: 1, text: '운동 분석',
    curriculum: { framework: '2015 개정 교육과정', reviewStatus: 'verified', unit: '역학',
      standards: [{ code, unit: '역학', text: '운동을 분석한다', reviewStatus: 'verified' }] } });
  const old = make(2019, '12물리Ⅰ01-01');
  const transition = make(2020, '12물리Ⅰ01-02');
  const applicable = make(2021, '12물리Ⅰ01-03');
  const items = prepareQuestions([old, transition, applicable]);
  assert.equal(curriculumYearMismatch(old), true);
  assert.equal(curriculumYearMismatch(transition), true);
  assert.equal(curriculumYearMismatch(applicable), false);
  assert.deepEqual(curriculumDisplayState(transition), { yearMismatch: true, verifiedCount: 0, candidateCount: 1 });
  assert.deepEqual(curriculumDisplayState(applicable), { yearMismatch: false, verifiedCount: 1, candidateCount: 0 });
  assert.equal(searchQuestions(items, '운동').length, 3);
  assert.deepEqual(searchQuestions(items, '', { framework: '2015 개정 교육과정' }).map((item) => item.year), [2021]);
  assert.equal(searchQuestions(items, '', { unit: '역학' }).length, 1);
  assert.equal(searchQuestions(items, '', { standard: '12물리Ⅰ01-02' }).length, 0);
  const files = catalogFiles(items.map((item) => item.pdfFile), items);
  assert.deepEqual(searchFiles(files, items, '', { framework: '2015 개정 교육과정' }).map((file) => file.year), [2021]);
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(app, /해당 학년도 적용 불일치/);
  assert.match(app, /적용 연도 불일치 · 확인 필요/);
});

test('status options and mismatch count exclude pre-2021 wrong links', () => {
  const make = (year, code) => ({ id: `q${year}`, subject: 'p1', subjectLabel: '물리학Ⅰ',
    pdfFile: `p1_${year}_11.pdf`, year, month: 11, no: 1, page: 1, text: '운동',
    curriculum: { framework: '2015 개정 교육과정', unit: code,
      standards: [{ code, unit: code, text: code }] } });
  const questions = [make(2019, 'old-unit'), make(2020, 'transition-unit'), make(2021, 'valid-unit')];
  const status = createCatalogMetadata({pdfCount:3,questionCount:3,items:questions}).status;
  assert.equal(status.curriculumYearMismatchCount, 2);
  assert.deepEqual(status.units, ['valid-unit']);
  assert.deepEqual(status.standards.map((s) => s.value), ['valid-unit']);
});
