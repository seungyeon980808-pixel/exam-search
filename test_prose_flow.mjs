import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreProseBlocks, lineSeparator } from './prose-flow.mjs';
import { paragraphsForPrepared, createPreparedHwpx } from './editable-convert.mjs';
import { documentScripts } from './test-hwpx-content.mjs';
const text = (value) => ({ kind: 'text', value });
const line = (value, row, overrides = {}) => ({ role: 'stem', label: '', runs: [text(value)],
  sourceLine: { left: 40, right: 340, columnRight: 350, height: 12, y: 600 - row * 18, region: 'a', ...overrides } });
const content = (blocks) => blocks.map(b => b.runs.map(r => r.value || r.script).join(''));

test('PDF line ends inside Korean words use the source-attested joined spelling', () => {
  const blocks = [line('하자로 인해 매수', 0), line('인이 계약을 해제한다.', 1, { right: 220 })];
  assert.deepEqual(content(restoreProseBlocks(blocks, { referenceText: '매수인이 손해를 입었다.' })), ['하자로 인해 매수인이 계약을 해제한다.']);
  assert.deepEqual(content(blocks), ['하자로 인해 매수', '인이 계약을 해제한다.']);
});
test('inflections corroborate split stems, while an attested space has priority', () => {
  assert.equal(lineSeparator([text('실현')], [text('되는데')], '실현된다.'), '');
  assert.equal(lineSeparator([text('문제')], [text('되는데')], '문제 되는데 문제된다.'), ' ');
  assert.equal(lineSeparator([text('그')], [text('책임의 내용')], '그 책임의 내용'), ' ');
  assert.equal(lineSeparator([text('채권자')], [text('에게')]), '');
  assert.equal(lineSeparator([text('계약')], [text('과는')]), '');
  assert.equal(lineSeparator([text('서명')], [text('이나')]), '');
  assert.equal(lineSeparator([text('무효')], [text('이지만')]), '');
  assert.equal(lineSeparator([text('보증인이라')], [text('하고')]), ' ');
  assert.equal(lineSeparator([text('금과')], [text('은')]), ' ');
  assert.equal(lineSeparator([text('적용되는')], [text('지가 문제 되는데')]), '');
  assert.equal(lineSeparator([text('좋은')], [text('지가')]), ' ');
});
test('English wrapped prose receives a word boundary and becomes one paragraph', () => {
  assert.deepEqual(content(restoreProseBlocks([line('The community needs', 0), line('a shared understanding.', 1, { right: 200 })])),
    ['The community needs a shared understanding.']);
});
test('a paragraph first-line indent can continue, but the next indent starts a new paragraph', () => {
  const blocks = [line('첫 문단의 긴 내용이 단 끝까지 이어져', 0, { left: 52 }), line('다음 줄로 이어진다.', 1),
    line('새로운 문단이 시작된다.', 2, { left: 52 }), line('그 문단의 계속된 내용이다.', 3, { right: 220 })];
  assert.deepEqual(content(restoreProseBlocks(blocks)), ['첫 문단의 긴 내용이 단 끝까지 이어져 다음 줄로 이어진다.',
    '새로운 문단이 시작된다. 그 문단의 계속된 내용이다.']);
});
test('blank vertical space and short verse lines remain separate', () => {
  assert.equal(restoreProseBlocks([line('시의 첫 행', 0, { right: 160 }), line('다음 행', 1, { right: 130 })]).length, 2);
  assert.equal(restoreProseBlocks([line('긴 문장의 끝', 0), line('다른 연의 시작', 3)]).length, 2);
});
test('credited poems preserve even full-width verses before a prose essay', () => {
  const poem = ['두고 온 것들이 빛나는 때가 있다', '빛나는 때를 위해 소금을 뿌리며', '우리는 이 저녁을 떠돌고 있는가', '사방을 둘러보아도'].map((s,i)=>line(s,i));
  const credit = line('-이시영, ｢그리움｣ -',4,{right:160});
  const prose = [line('그 뒤에 오는 산문의 첫 줄은',5),line('계속된 설명으로 이어진다.',6,{right:220})];
  const output = restoreProseBlocks([...poem,credit,...prose],{preserveVerse:true});
  assert.deepEqual(content(output).slice(0,4),content(poem));
  assert.equal(output.length,6);
});
test('tables, drawings, standalone equations, headings and choices are hard boundaries', () => {
  for (const boundary of [
    { kind: 'table', role: 'stem', rows: [[[text('자료')]]], runs: [] },
    { kind: 'figure', role: 'figure', runs: [] },
    { ...line('', 1), runs: [{ kind: 'equation', script: 'x=1' }] },
    line('(가)', 1), { ...line('선지 내용', 1), role: 'choice', label: '①' },
  ]) assert.equal(restoreProseBlocks([line('앞의 내용', 0), boundary, line('뒤의 내용', 2)]).length, 3);
});
test('dialogue continuation joins within a turn and preserves the next speaker', () => {
  const blocks = [line('갑 : 우리의 생각과 사회에 대한 긴 설명', 0), line('이 다음 줄로 이어진다.', 1),
    line('을 : 서로 다른 의견을 제시한 두 번째 설명', 2), line('이다.', 3, { right: 70 })];
  assert.equal(restoreProseBlocks(blocks).length, 2);
});
test('continuation across source columns preserves a split Korean word', () => {
  const blocks = [line('계약이 성립', 0), line('하려면 의사 합치가 필요하다.', 0, { region: 'b', right: 200 })];
  assert.deepEqual(content(restoreProseBlocks(blocks, { referenceText: '성립하려면 의사 합치가 필요하다.' })), ['계약이 성립하려면 의사 합치가 필요하다.']);
});
test('prepared semantic paragraphs without PDF geometry are not guessed or merged', () => {
  const blocks = [{ role: 'stem', runs: [text('첫 문단')] }, { role: 'stem', runs: [text('둘째 문단')] }];
  assert.deepEqual(restoreProseBlocks(blocks), blocks);
});
test('reflow preserves native equations through the actual HWPX writer', async () => {
  const equation = { kind: 'equation', script: String.raw`\frac{x}{2}` };
  const first = line('변수의 값은 ', 0); first.runs.push(equation, text('이며'));
  const prepared = { schema: 'exam-editable-v1', status: 'needs_review', number: 1,
    blocks: [first, line('다음 조건을 만족한다.', 1, { right: 220 })] };
  const paragraphs = paragraphsForPrepared(prepared);
  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].find(r => r.kind === 'equation'), equation);
  assert.equal(documentScripts(await createPreparedHwpx(prepared)).length, 1);
});

test('science data indentation does not control the separate question prompt', () => {
  const blocks = [
    ...Array.from({ length: 5 }, (_, i) => line('자료의 상세 설명', i, { left: 119, right: 398, columnRight: 421 })),
    ...['이에 대한 설명으로 옳은 것만을 <보기>에서 있는 대로 고른',
      '것은? (단, 제시된 돌연변이 이외의 핵산 염기 서열 변화는 고려', '하지 않는다.) [3점]']
      .map((value, i) => ({ ...line(value, i + 6, { left: i ? 99 : 109, right: i === 2 ? 190 : 405, columnRight: 421 }), role: 'ask' })),
  ];
  const output = restoreProseBlocks(blocks).filter(b => b.role === 'ask');
  assert.equal(output.length, 1);
  assert.match(plainText(output[0]), /고른 것은\?/u);
  assert.match(plainText(output[0]), /고려하지 않는다/u);
});
const plainText = b => b.runs.map(r => r.value || r.script).join('');
test('indented science bullet continuations reflow without joining the next bullet', () => {
  const blocks = [line('◦X는 8개의 아미노산으로 구성되고, Y는 5개의 아미노산으로', 0, { left: 106, right: 398, columnRight: 421 }),
    line('구성된다.', 1, { left: 119, right: 163, columnRight: 421 }),
    line('◦X와 Y의 합성은 개시 코돈에서 시작한다.', 2, { left: 106, right: 398, columnRight: 421 })];
  const output = restoreProseBlocks(blocks);
  assert.equal(output.length, 2);
  assert.equal(plainText(output[0]), '◦X는 8개의 아미노산으로 구성되고, Y는 5개의 아미노산으로 구성된다.');
});

test('inline references such as (가)의 continue prose rather than becoming section headings', () => {
  const blocks = [line('표 (가)는 두 가지 특징을, (나)는', 0, { left: 87, opening: true }),
    line('(가)의 특징 중 A와 B가 갖는 특징의 개수를 나타낸 것이다.', 1, { left: 99, right: 340 }),
    line('(나)', 2, { left: 99, right: 120 })];
  const result = restoreProseBlocks(blocks);
  assert.equal(result.length, 2);
  assert.equal(plainText(result[0]), '표 (가)는 두 가지 특징을, (나)는 (가)의 특징 중 A와 B가 갖는 특징의 개수를 나타낸 것이다.');
  assert.equal(plainText(result[1]), '(나)');
});

test('bound Korean endings split at PDF line ends join without erasing attested spaces', () => {
  for (const [left, right] of [['따뜻하', '게'], ['보이', '네요'], ['속상하', '겠구나'],
    ['즐겁', '겠어요'], ['생각하', '면서'], ['변화되', '도록']]) {
    assert.equal(lineSeparator([text(left)], [text(right)], `${left}\n${right}`), '', `${left}/${right}`);
    assert.equal(lineSeparator([text(left)], [text(right)], `${left} ${right}`), ' ', 'printed space wins');
  }
  assert.equal(lineSeparator([text('그런')], [text('게')]), ' ');
  assert.equal(lineSeparator([text('해야')], [text('한다')]), ' ');
  assert.equal(lineSeparator([text('나는')], [text('네')]), ' ');
});

test('credited short narrative dialogue is not classified as poetry by average line length', () => {
  const values = ['그는 문으로 들어와 주인에게 청죄', '한데, 주인이 반겨 가로되,',
    '“먼 길을 돌아와 반가움이 크다.', '여기에 앉으라.”',
    '그가 고개를 숙이며 대답하여 왈,', '“우리는 머나먼 북경', '에 갔다가 돌아왔습니다.”',
    '주인이 다시 손님에게 물어 왈,', '“가족도 함께 돌아왔느냐.', '모두 잘 지내느냐.”',
    '그가 대답하고 방으로 들어갔다.', '주인은 손님에게 긴 이야기를 전하였다.', '-작자 미상, ｢어느 이야기｣-'];
  const blocks=values.map((value,i)=>line(value,i,{right: value.endsWith('”')||value.endsWith('되,')||value.endsWith('왈,')?210:340}));
  const output=restoreProseBlocks(blocks,{preserveVerse:true});
  assert.ok(output.some(b=>plainText(b).includes('청죄한데')));
  assert.ok(output.some(b=>plainText(b).includes('북경에')));
  assert.equal(output.filter(b=>/^[“]/u.test(plainText(b))).length,3,'dialogue turns remain separate');
  for (const [open, close] of [['‘','’'], ["'","'"]]) {
    const quoted = blocks.map(b=>({...b,runs:b.runs.map(r=>({...r,value:r.value.replaceAll('“',open).replaceAll('”',close)}))}));
    const single=restoreProseBlocks(quoted,{preserveVerse:true});
    assert.equal(single.filter(b=>plainText(b).startsWith(open)).length,3,'single-quoted dialogue stays separate after narrative classification');
  }
  assert.ok(output.length<blocks.length);
  assert.deepEqual(restoreProseBlocks(blocks.map(b=>plainText(b).startsWith('-')?{...b,runs:[text('-작자 미상, 가사-')]}:b),{preserveVerse:true}),
    blocks.map(b=>plainText(b).startsWith('-')?{...b,runs:[text('-작자 미상, 가사-')]}:b),'explicit verse credit retains lineation');
});


test('classical narrative bound endings join only at eligible source-line boundaries', () => {
  for(const [left,right] of [['청죄','한데'],['없거','늘'],['되었사','오니'],['엄치','하소서']]) {
    assert.equal(lineSeparator([text(left)],[text(right)],`${left}\n${right}`),'');
    assert.equal(lineSeparator([text(left)],[text(right)],`${left} ${right}`),' ');
  }
  assert.equal(lineSeparator([text('회사')],[text('오니')]),' ');
  assert.equal(lineSeparator([text('우리')],[text('늘')]),' ');
});

test('dialogue continuation retains its relative indent across a source column boundary', () => {
  const blocks = [line('그가 주인에게 청하여 왈,',0,{left:40,right:170}),
    line('첫 번째 서술 문단',1,{left:40,right:180}),line('두 번째 서술 문단',2,{left:40,right:180}),
    line('“이 일에 대해서는 엄치',3,{left:50,right:340}),
    line('하소서.”',0,{region:'b',left:450,right:490,columnRight:750}),
    line('그가 말했다.',1,{region:'b',left:440,right:510,columnRight:750}),
    line('새로운 서술 문단',2,{region:'b',left:440,right:530,columnRight:750}),
    line('또 다른 서술 문단',3,{region:'b',left:440,right:530,columnRight:750})];
  assert.ok(restoreProseBlocks(blocks).some(b=>plainText(b)==='“이 일에 대해서는 엄치하소서.”'));
});

test('frequent indented dialogue does not replace the narrative left margin', () => {
  const blocks=[line('서술 문단의 첫 줄이 끝까지 이어져',0,{left:52}),
    line('다음 줄에서도 사건을 설명하며',1,{left:40}),line('그 문단을 끝낸다.',2,{left:40,right:180}),
    line('별도의 짧은 서술이다.',3,{left:40,right:180}),
    ...Array.from({length:5},(_,i)=>[line('“인물의 대화가 이어지고',4+i*2,{left:52}),
      line('그 말을 마친다.”',5+i*2,{left:52,right:180})]).flat()];
  const output=restoreProseBlocks(blocks);
  assert.equal(plainText(output[0]),'서술 문단의 첫 줄이 끝까지 이어져 다음 줄에서도 사건을 설명하며 그 문단을 끝낸다.');
  assert.equal(output.filter(b=>plainText(b).startsWith('“')).length,5);
});
