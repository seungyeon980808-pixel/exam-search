// Text-font fractions have a drawn rule, not an equation-font fraction glyph.
// A rule and two tightly stacked, centred rows are required; ordinary prose is untouched.
const right = item => item.x + item.width;
// 끝 띄어쓰기를 뺀 오른쪽 끝(글자 수 비율로 어림) — 「C 」처럼 띄어쓰기가 붙은 분모가 가운데에서 벗어난 것으로 잡혔다.
const inkRight = item => { const all = [...item.value], kept = [...item.value.trimEnd()];
  return all.length && kept.length < all.length ? item.x + item.width * kept.length / all.length : right(item); };
// 한글 없는 분수(A＋C/T＋G, 11/4): 영문·숫자·연산 기호만 든 짧은 줄.
const PLAIN = /^[A-Za-z0-9.,()\s＋+−\-×\u0391-\u03c9\u2080-\u2089\u2460-\u24ff\u3260-\u327f]{1,12}$/u;
// 기울인 본문 글꼴(…,It) 영문 조각은 수식의 기울인 글자로 쓴다(t₁ 등). 나머지 본문 글자는 \text{}로 바로 선 글자.
const italic = item => /(?:,|-)It(?:alic)?\b|Italic/u.test(item.font || '');
// 글 조각과 수식 글자 사이의 띄어쓰기(조각 끝 띄어쓰기나 벌어진 틈)는 수식 띄어쓰기(~)로 남긴다 —
// \text{…}만 쓰면 경계 띄어쓰기가 지워져 「일 때A(g)의」처럼 붙었다(10-25 c2_2026_09_11).
function rowScript(items) {
  let script = '', text = '', previous, space = false;
  const flush = () => { if (!text.trim()) { space ||= !!text; text = ''; return; }
    if (script && (space || /^\s/u.test(text))) script += '~';
    // 숫자만이면 수식 숫자 그대로(\\text{1} 대신 1).
    script += /^[0-9.]+$/u.test(text.trim()) ? text.trim() : `\\text{${text.trim()}}`; space = /\s$/u.test(text); text = ''; };
  // 첨자: 줄에서 큰 글자 높이의 80%보다 작고 기준선에서 1pt 넘게 내려가/올라간 조각(X_{a}Y_{3a}, OH^{-}, t_{1}).
  const tall = Math.max(...items.map((item) => item.height)), base = Math.max(...items.filter((item) => item.height >= tall * .8).map((item) => item.y));
  let mark = null;
  const sorted = [...items].sort((a, b) => a.x - b.x), skip = new Set();
  for (const [index, item] of sorted.entries()) {
    const gap = previous && item.x - right(previous) > Math.max(1.5, item.height * .2);
    const dy = item.y - base, tiny = item.height < tall * .8 && Math.abs(dy) >= 1 && item.value.trim();
    // 앞 첨자(질량수 ᵐX): 작은 조각 바로 뒤에 큰 영문 글자가 붙어 있으면 그 글자의 앞 첨자.
    if (tiny && dy > 0 && !skip.has(item)) {
      const run = [item];
      for (let j = index + 1; j < sorted.length; j++) { const o = sorted[j];
        if (o.height < tall * .8 && o.y - base >= 1 && Math.abs(o.x - right(run.at(-1))) <= 1.6) run.push(o); else break; }
      const next = sorted[index + run.length];
      if (next && next.height >= tall * .8 && /^[A-Z]/u.test(next.value.trim()) && Math.abs(next.x - right(run.at(-1))) <= 1.6) {
        flush(); if (script && (space || gap)) script += '~';
        script += `{}^{${run.map((o) => o.value.trim()).join('').replace(/[＋+]/gu, '+').replace(/[−－-]/gu, '-')}}`;
        run.forEach((o) => skip.add(o)); mark = null; space = false; previous = run.at(-1); continue;
      }
    }
    if (skip.has(item)) continue;
    // 이온 전하(OH⁻)는 밑글자에서 1.6pt쯤 떨어져 찍힌다 — 작은 조각은 2.2pt까지 붙은 것으로 본다(10-25 c1_2026_11_16).
    const small = tiny && previous && item.x - right(previous) <= 2.2;
    if (small) {
      flush(); const m = dy < 0 ? '_' : '^', v = item.value.trim().replace(/[＋+]/gu, '+').replace(/[−－-]/gu, '-');
      if (mark === m) script = script.replace(/\}$/u, `${v}}`); else script += `${m}{${v}}`;
      mark = m; space = false; previous = item; continue;
    }
    mark = null;
    if (item.math || (italic(item) && /^[A-Za-z]+$/u.test(item.value.trim()))) {
      flush();
      if (script && (space || gap)) script += '~';
      script += item.value.trim(); space = false;
    } else {
      if (gap && !text) space = true;
      text += `${gap && text && !/\s$/u.test(text) && !/^\s/u.test(item.value) ? ' ' : ''}${item.value}`;
    }
    previous = item;
  }
  flush();
  return script;
}

export function ruledTextFractions(items, primitives, pageHeight) {
  const used = new Set(), fractions = [];
  for (const rule of primitives.filter(p => p.type === 'line' && p.orient === 'h' && !p.dash && p.width <= 1)) {
    const [left, top, end] = rule.box, width = end - left;
    if (width < 4 || width > 500) continue;
    // Grid borders separate rows, not numerators and denominators.
    if (primitives.some(p => p.type === 'line' && p.orient === 'v'
      && (Math.abs(p.box[0] - left) < 1 || Math.abs(p.box[0] - end) < 1)
      && p.box[1] <= top + 1 && p.box[3] >= top - 1)) continue;
    const y = pageHeight - top;
    const nearby = items.filter(item => !used.has(item) && item.value.trim()
      && item.x >= left - 2 && right(item) <= end + 2 && item.height > 0
      && Math.abs(item.y - y) < item.height * 1.5);
    const upper = nearby.filter(item => item.y - y >= 1 && item.y - y <= item.height * .6);
    const lower = nearby.filter(item => y - item.y >= item.height * .65 && y - item.y <= item.height * 1.3);
    if (!upper.length || !lower.length) continue;
    // 한글이 든 분수는 줄이 15pt 넘게 길다. 한글 없는 분수는 짧고(4pt~), 분자·분모 사이가 본문 줄 간격(글자 높이의 1.45배)보다 확실히 좁아야 한다(1.38배 이하 — 10-25 b2_2025_09_13 A/C 1.15배, c2_2026_09_11 수식 글꼴 1/4 1.3배).
    const korean = [...upper, ...lower].some(item => /[가-힣]/u.test(item.value));
    const plain = !korean && [upper, lower].every(row => PLAIN.test(row.map(item => item.math ? 'X' : item.value).join('')));
    if (korean ? width < 15 : !plain) continue;
    const height = Math.max(...upper.map(item => item.height), ...lower.map(item => item.height));
    const baseline = row => Math.max(...row.filter(item => item.height >= height * .8).map(item => item.y));
    const u = baseline(upper), l = baseline(lower), separation = u - l;
    const centred = row => Math.abs((Math.min(...row.map(item => item.x)) + Math.max(...row.map(inkRight))) / 2
      - (left + end) / 2) <= Math.max(2, width * .08);
    if (!Number.isFinite(separation) || separation < height * 1.05 || separation > height * (korean ? 1.5 : 1.38)
      || !centred(upper) || !centred(lower)
      || upper.some(item => item.height >= height * .8 && Math.abs(item.y - u) > 2) || lower.some(item => item.height >= height * .8 && Math.abs(item.y - l) > 2)
      || [...upper, ...lower].some(item => /[{}"\\]/u.test(item.math ? '' : item.value))) continue;
    // 아래·위 첨자(t₁의 「1」처럼 글자 높이가 작은 조각)는 제 높이로 재면 어느 줄에도 안 들어가 따로 떨어졌다 — 가까운 줄에 붙인다.
    for (const item of items.filter(item => !used.has(item) && item.value.trim() && item.x >= left - 2 && right(item) <= end + 2 && item.height > 0)) {
      if (upper.includes(item) || lower.includes(item) || item.height >= height * .8) continue;
      const du = Math.abs(item.y - u), dl = Math.abs(item.y - l);
      if (Math.min(du, dl) <= height * .5) (du <= dl ? upper : lower).push(item);
    }
    const parts = [...upper, ...lower];
    parts.forEach(item => used.add(item));
    fractions.push({ ...upper[0], x: left, y: (u + l) / 2, width, height,
      raw: parts.map(item => item.raw).join(''), math: true, recovered: true,
      value: `\\frac{${rowScript(upper)}}{${rowScript(lower)}}` });
  }
  return [...items.filter(item => !used.has(item)), ...fractions];
}
