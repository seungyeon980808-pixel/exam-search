import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityChecks, controlBounds, textBounds, horizontalInlineCollisions, renderedProseFindings, sourceChargePairs, analyzeMode } from './tools/qa-readability.mjs';

const sourceRegion = { id: 'sequence', kind: 'raster', page: 4, box: [40, 50, 200, 80] };
const mode = () => ({ includeImages: true, sourcePage: 4, provenance: 'pdf', nativeRuns: [], warnings: [], pages: [],
  sourceScripts: [], scripts: [], nativeContent: '① ② ③ ④ ⑤', equationMetrics: [], equationCollisions: [],
  quality: { state: 'review', scope: 'observed-source-regions', regions: [], unresolvedCount: 0, excludedCount: 0 } });
const failures = (checks) => checks.filter((c) => c.status === 'fail').map((c) => c.name);

test('a saveable native document cannot hide a missing critical sequence image', () => {
  const observed = mode();
  observed.quality.regions = [{ ...sourceRegion, state: 'image' }];
  assert.deepEqual(failures(qualityChecks(observed, [{ ...sourceRegion, label: 'dna' }])), ['region-image:sequence', 'critical-source-region:dna']);
  observed.nativeRuns = [{ kind: 'figure', sourcePage: 4, sourceBox: [35, 45, 205, 85] }];
  assert.deepEqual(failures(qualityChecks(observed, [{ ...sourceRegion, label: 'dna' }])), []);
});

test('explicit image exclusion is accounted for without being called restored', () => {
  const observed = mode(); observed.includeImages = false;
  observed.quality = { ...observed.quality, state: 'excluded', regions: [{ ...sourceRegion, state: 'excluded' }], excludedCount: 1 };
  const checks = qualityChecks(observed, [{ ...sourceRegion, label: 'dna' }]);
  assert.deepEqual(failures(checks), []);
  assert.equal(checks.find((c) => c.name === 'critical-source-region:dna').status, 'acknowledged-exclusion');
  observed.nativeRuns = [{ kind: 'figure', sourcePage: 4, sourceBox: sourceRegion.box }];
  assert.ok(failures(qualityChecks(observed)).includes('image-exclusion-option'));
});

test('unresolved inventory requires incomplete status and visible warning', () => {
  const observed = mode(); observed.quality.regions = [{ ...sourceRegion, state: 'unresolved' }]; observed.quality.unresolvedCount = 1;
  assert.ok(failures(qualityChecks(observed)).includes('missing-regions-are-explicit'));
  observed.quality.state = 'incomplete'; observed.warnings = ['원본 자료 1개 영역의 복원을 확인해야 합니다.'];
  assert.deepEqual(failures(qualityChecks(observed)), ['source-region-coverage']);
});

test('source charges must stay attached to native formulas, not merely appear elsewhere', () => {
  const sourceItems = [
    { text: '(NH4', x: 40, y: 80, w: 30, h: 10 }, { text: '+', x: 72, y: 75, w: 4, h: 6 },
    { text: '(NO3', x: 100, y: 80, w: 30, h: 10 }, { text: '−', x: 132, y: 75, w: 4, h: 6 },
  ];
  const record = { id: 'charge', questionText: '①②③④⑤', sourceChargePairs: sourceChargePairs(sourceItems) };
  const observed = mode(); observed.nativeContent += ' NH4 NO3 + −';
  const expected = { nativeCharges: ['NH4⁺', 'NO3⁻'] };
  assert.deepEqual(failures(analyzeMode(record, observed, expected)), ['native-charge:NH4⁺', 'native-charge:NO3⁻']);
  observed.nativeContent += ' (NH4⁺) (NO3⁻)';
  assert.deepEqual(failures(analyzeMode(record, observed, expected)), []);
  assert.equal(analyzeMode(record, observed, expected).find((c) => c.name === 'charge-digit-subscript-source-proof').status, 'uncovered');
});

test('control bounds reject left-column escape and footer overflow', () => {
  const pages = [{ page: 0, info: { columns: [{ x: 30, width: 200 }], footerArea: { y: 700 } }, controls: [
    { type: 'equation', x: 35, y: 100, w: 210, h: 20 }, { type: 'table', x: 35, y: 690, w: 150, h: 30 },
  ] }];
  assert.deepEqual(controlBounds(pages).map((f) => f.type), ['outside-left-column', 'below-body']);
});

test('reference-attested word breaks are separate from harmless short rendered lines', () => {
  const observed = { paragraphText: ['매수', '인이 계약을 체결한다.'], pages: [{ page: 0, textRuns: [
    { text: '그', secIdx: 0, paraIdx: 0, x: 30, y: 40 },
  ] }] };
  const findings = renderedProseFindings(observed, '매수인이 계약을 체결한다.');
  assert.deepEqual(findings.attestedParagraphWordBreaks.map((f) => f.attested), ['매수인이']);
  assert.equal(findings.singletonRows.length, 1);
  observed.paragraphText = ['매수인이 계약을 체결한다.'];
  assert.deepEqual(renderedProseFindings(observed, '매수인이 계약을 체결한다.').attestedParagraphWordBreaks, []);
});

test('lost source choice labels and index-draft fallback fail even if layout opens', () => {
  const observed = mode(); observed.nativeContent = '①②③④'; observed.provenance = 'index-draft';
  assert.deepEqual(failures(analyzeMode({ questionText: '①②③④⑤' }, observed)), ['actual-resolver-conversion', 'source-choice-labels-preserved']);
});

test('a reviewed shared-passage word oracle catches wrong spaces inside an otherwise merged paragraph', () => {
  const observed = mode(); observed.paragraphText = ['마음이 참 따뜻하 게 느껴져요.'];
  const expected = { proseOracle: { joinedWords: ['따뜻하게'], sourceNote: 'Original page 1 radio passage wrap.' } };
  assert.deepEqual(failures(analyzeMode({ subject: 'kor' }, observed, expected)), ['source-prose-word:따뜻하게']);
  observed.paragraphText = ['마음이 참 따뜻하게 느껴져요.'];
  assert.deepEqual(failures(analyzeMode({ subject: 'kor' }, observed, expected)), []);
});

test('a novel shared-passage oracle rejects physical line fragments misclassified as verse', () => {
  const observed = mode();
  const expected = { proseOracle: { joinedWords: ['청죄한데', '북경에'],
    joinedParagraphFragments: ['경업이옥에갇혀생각하되'], sourceNote: 'Reviewed novel passage printed wraps.' } };
  observed.paragraphText = ['옥에 가두니, 경업이', '옥에 갇혀 생각하되,',
    '상을 뵙고 청죄', '한데, 상이 경업을 보시고', '속아 북경', '에 잡혀갔다가'];
  assert.deepEqual(failures(analyzeMode({ subject: 'kor' }, observed, expected)),
    ['source-prose-word:청죄한데', 'source-prose-word:북경에', 'source-prose-paragraph-continuation']);
  observed.paragraphText = ['옥에 가두니, 경업이 옥에 갇혀 생각하되,',
    '상을 뵙고 청죄한데, 상이 경업을 보시고', '속아 북경에 잡혀갔다가'];
  assert.deepEqual(failures(analyzeMode({ subject: 'kor' }, observed, expected)), []);
});

test('poetry lineation requires distinct source and saved native paragraphs without losing either line', () => {
  const observed = mode();
  const expected = { proseOracle: { separateParagraphFragments: [['새로 돋은 정맥이', '바르르 떤다.']] } };
  observed.paragraphText = ['새로 돋은 정맥이 바르르 떤다.'];
  assert.deepEqual(failures(analyzeMode({}, observed, expected)), ['source-verse-lineation']);
  observed.paragraphText = ['새로 돋은 정맥이', '바르르 떤다.'];
  observed.pages = [{ page: 0, info: { columns: [{ x: 30, width: 300 }], footerArea: { y: 700 } }, controls: [], textRuns: [
    { secIdx: 0, paraIdx: 3, text: '새로 돋은 정맥이 바르르 떤다.' },
  ] }];
  assert.ok(failures(analyzeMode({}, observed, expected)).includes('saved-verse-lineation'));
  observed.pages[0].textRuns = [
    { secIdx: 0, paraIdx: 3, text: '새로 돋은 정맥이' },
    { secIdx: 0, paraIdx: 4, text: '바르르 떤다.' },
  ];
  assert.ok(!failures(analyzeMode({}, observed, expected)).includes('saved-verse-lineation'));
  observed.paragraphText = ['새로 돋은 정맥이'];
  assert.ok(failures(analyzeMode({}, observed, expected)).includes('source-verse-lineation'));
});

test('text can overflow a column even when every equation control fits', () => {
  const pages = [{ page: 0, info: { columns: [{ x: 37.8, width: 347.7 }], footerArea: { y: 1077.1 } },
    controls: [{ type: 'equation', x: 363.7, y: 73.2, w: 9.1, h: 13.3, secIdx: 0, paraIdx: 2 }],
    textRuns: [{ text: '에 크기가 ', x: 372.8, y: 73.2, w: 41, h: 13.6, fontSize: 13.3, secIdx: 0, paraIdx: 2 }] }];
  assert.deepEqual(controlBounds(pages), []);
  assert.equal(textBounds(pages)[0].type, 'text-outside-left-column');
  assert.ok(textBounds(pages)[0].excess > 28);
  assert.deepEqual(horizontalInlineCollisions(pages), []);
});

test('horizontal native equation/text overlap is distinguished from adjacent rows', () => {
  const pages = [{ page: 0, controls: [{ type: 'equation', x: 100, y: 80, w: 40, h: 20, secIdx: 0, paraIdx: 2 }],
    textRuns: [{ text: '잘못 겹침', x: 120, y: 82, w: 30, h: 13, secIdx: 0, paraIdx: 2 },
      { text: '다음 줄', x: 120, y: 102, w: 30, h: 13, secIdx: 0, paraIdx: 2 }] }];
  assert.equal(horizontalInlineCollisions(pages).length, 1);
  assert.equal(horizontalInlineCollisions(pages)[0].text, '잘못 겹침');
});
