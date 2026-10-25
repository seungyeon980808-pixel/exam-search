# examlibrary: 5E 최신 조판 엔진 이식과 발전 (10-25 인수인계)

## 목표
1. **이식:** examlibrary의 5E 문항 틀(`exampool/`)을 5E 최신 엔진으로 올린다. 기준은 5E 커밋 `5e1a181a`(갈래 `feature/1.7.0/hwp-modes-palette`, 작업 폴더 `Desktop/project/5e-170-integration`).
2. **발전:** 그 엔진으로 기출 PDF → 한글 변환·조판 품질을 계속 고친다. 아래 「남은 문제」부터.
3. **되돌려 주기:** 여기서 고친 것은 나중에 5E로 옮긴다. 고칠 때마다 아래 「5E로 옮길 목록」에 파일·이유를 적는다. 두 사본이 따로 놀지 않게 하기 위해서다.

## 품질 기준 (사용자 10-25)
- 「눈으로 봤을 때 이상하지 않으면」 충분하다. 픽셀 단위 일치는 쫓지 않는다(몇 px·표 15px 차이 등은 그대로 둔다).
- 단, 사용자가 특정 부분을 짚어 맞추라고 하면(예: 선지 위치) 그 부분은 맞춘다.
- AI·구독 없이 도는 변환이라 100% 정확할 필요는 없다.

## 지금 examlibrary 사본 상태
- `exampool/`은 5E integration/1.7.0 `51db3a1b`(10-20)의 convert·sheet 일부 복사본이다. `exampool/frame.mjs`가 변환·조판·모으기를 맡는다.
- 51db3a1b → 5e1a181a 사이 5E에서 바뀐 파일:
  - `convert/kice-engine.js`, `convert/figures.js`, `convert/es/live-convert.mjs`, `convert/es/live-tables.mjs`(그리고 `pdf-viewer`·`pdf-worker` 조금)
  - `sheet/handoff.js`(크게), `sheet/typeset-model.js`, `sheet/native-text-measure.js`, `sheet/model.js`, `sheet/exams.js`, `sheet/exam-layout.js`, `sheet/question-page.js`
- 새 `handoff.js`는 `typeset-standard.js`(`KICE_STANDARD`·`layoutValues`·`standardForPaper`·`mmToPx`)를 import한다. examlibrary 사본에는 이 파일이 없으니 함께 가져온다.
- 5E에서 조판 순서는 `assets/exampool/sheet/typeset.js`의 `generate()`에 있다. `frame.mjs`도 이 순서에 맞춰야 한다.
  - `standardForPaper(std, 'B4')`로 틀 만들기 → `buildQuestionHtml(..., {standard})`
  - `normalizeQuestionImport(..., {standard})` → `applyReferenceBogiIndent` → `reflowLinesegs` → **`applyCellFloatingPictures(styled, plan.cellFloats)`** → `centerCellPictures` → `applyQuestionIndent(..., {hangPx: plan.bodyIndent})` → 떠 있는 그림·표 → `fitQuestionPage` → `exportLayoutHwpx` → `applyCellEquationLines`
  - 글자 폭 재기 배율은 `buildQuestionHtml`이 `measureText.factor`에 넣는다(장평 + 자간 = 0.92).
- **examlibrary에만 있는 고침(덮어쓰지 말 것):** `typeset-model.js` `settleFloatingPictures`가 표가 아닌 개체에 `getTableProperties`를 부르던 버그 수정(b1_2013_06_08). 5E 쪽에는 아직 없다 → 이식할 때 지키고 「5E로 옮길 목록」 첫 줄에 적는다.
- 바꾼 모듈은 `?v=frame-…` 꼬리표를 함께 올린다(캐시).
- 작업 폴더에 커밋하지 않은 변경이 있다: `tools/frame-qa/e2e.mjs`. 누가 왜 바꿨는지 확인하기 전에는 지우거나 덮지 않는다.

## 이번(10-25)에 5E에서 고친 것 — 이식 뒤 확인할 점
- 수능 B4 틀 글자: 원본 PDF 실측(PDF 쪽은 A3 = 시험지 B4 × 1.156)대로 본문 11.5pt·장평 95%·자간 −3%·줄 간격 145%(〈보기〉·상자도 같음), 상자 좌우 여백 7.2pt. `standardForPaper`에서 KICE 틀일 때만 적용.
- 선지: 원본 탭 간격(5칸 61.2pt, 3+2 102pt, 2묶음 159pt). 대응표는 값이 짧으면 3묶음, 값 칸 폭은 내용대로. ⑤가 조금 넘치면 간격은 두고 그 선지만 자간 좁힘. 62문항이 원본과 4px 안.
- 글자 폭 재기: 장평·자간은 기호·띄어쓰기까지 모든 글자에 걸린다. 표는 들여오면 바깥 여백 7.55px만큼 좁아졌다가 다시 넓어지므로 칸 안 글 폭에 더한다(`TABLE_OUT`).
- 줄 나눔(`wrapHangingText`): 문단 끝 짧은 낱말은 자간을 좁혀 한 줄에(최대 15%), 문단 가운데 줄은 띄어쓰기 줄임 50% 안이면 자간 좁힘. 좁힘은 글자색 `#0A0BNN` 표시 → `normalizeQuestionImport`가 자간으로 바꾼다. 줄 첫머리 수식 앞에는 1pt U+2060.
- 〈보기〉 제목 칸은 B4로 키우지 않는다. 여는 따옴표 ‘는 Times New Roman.
- 표: 원본 폭·원본 행 높이(`rowHeights`, 분수 칸은 늘림), 범례는 표 오른쪽 끝, 칸 안 원본 줄바꿈은 풀어서 다시 나눔.
- 상자 안 「글 | 그림」은 그림 어울림: 그림 높이만큼만 좁은 줄. 세로 자리는 변환기가 `figure.besideAt = {item, line}`로 기록.
- 변환기: 범례 판정($ 빼고), 행 높이·그림 세로 자리 기록, `tidyStrays`(옆 띠 글자, 한글 뒤 (가)·㉠ 앞 띄어쓰기, 범례 다음 이어지는 문장 잇기).

## 남은 문제 (우선순위 순, 「눈으로 이상한 것」만)
1. **수식 읽기:** 94문항 중 6문항이 눈에 띄게 깨진다. 변환 뒤 사람이 고쳐야 해서 실무에서 가장 걸린다.
   - 분수가 흩어짐: b2_2026_09_11 (A+C)/(T+G)=11/4, b1_2024_06_15, b2_2025_09_13
   - 위첨자 질량수가 붙음: c1_2026_09_11 「bX1mol」
   - 분수 안 한글이 붙거나 겹침: c2_2026_09_11 〈보기〉 「= 1/4」, b1_2024_06_12, c2 반응 속도 식
   - 분수 E₂/E₁가 문장과 뒤섞임: c1_2024_09_11
   - 그 밖에 화학식 기울임, `\text` 띄어쓰기, 분수 `_{4}^{1}`
2. **그림·표 배치:**
   - c1_2025_09_04: 장치 그림이 과정 옆이 아니라 결론 아래로 감
   - e2_2024_09_11: 원본은 표와 지도가 나란한데 위아래로 쌓임
   - e2_2025_06_01: 그림 이름 「(가) 구리 전선 (나) 유리컵」이 본문 줄로 들어감
3. 덜 급한 것:
   - b1_2026_06_06 상자 위 여백 3~4px, 결과 표가 (가) 글 영역 가운데보다 15px 왼쪽
   - p2_2024_06_03 그림 옆 줄이 양쪽 정렬로 벌어짐
   - p2_2024_09_11 「2Ω, 4Ω」 쉼표 빠짐
   - 엔진 SVG 그리기 오류(p2_2024_09_11 겹쳐 보기만 실패)

## 도구 (5E 저장소 `tools/kice-convert/visual/`, 설명은 그 폴더 README.md)
- 원본 자르기 `origshots.cjs`, 우리 카드 찍기 `cardshots.cjs`(webkit, 10문항 이하씩), 나란히 모아 보기 `grid.cjs`
- 원본 위에 겹쳐 보기 `overlay.cjs` + `orignum.cjs`(문항 번호 맞춤점)
- 엔진 실측 `runs-dump.cjs`·`measure-symbols.cjs`·`measure-spacing.cjs`, 원본 PDF 글 조각 `origwords.cjs`, 선지 좌표 `choicepos.cjs`·`choicecheck.cjs`
- 검사 문항: `ids-62.txt`(맞춘 문항), `ids-new32.txt`(처음 보는 시험 문항)
- 도구들은 5E 저장소 경로(`R`)를 기준으로 돈다. examlibrary 쪽에서 쓰려면 이 폴더에 맞게 옮기거나, 기존 `tools/frame-qa/board.mjs`(캔버스 비교판)와 합친다.
- 과적합을 막으려고, 고칠 때마다 처음 보는 문항을 새로 뽑아 확인한다. `tools/kice-convert/corpus.json` 1,440문항에서 과목마다 고루 뽑는다.

## 검사
- examlibrary: `npm run qa:frame`(1,440문항 채점, 10-20 기준 1377 = 95.6%), `npm run qa:frame-e2e`, `tools/frame-qa/board.mjs`.
- 이식 뒤 합격 수가 10-20보다 떨어지면 원인을 먼저 찾는다.

## 지킬 것
- 보고·커밋 메시지는 모두 한국어.
- 커밋은 이 갈래(`feature/examlibrary-5e-frame`)에서 한다. **푸시·배포(main 앞당김)는 사용자 승인 뒤에.** 되돌리기 기준은 main `5698a62d`.
- 원본 저장소 폴더 `Documents/Codex/2026-09-06/x20/exam-search-public`은 건드리지 않는다.
- 5E 작업 폴더(`5e-170-integration`)는 읽기만 한다. 5E 쪽 수정은 5E 세션이 한다.
- 서버나 브라우저는 자기가 띄운 것(PID)만 끈다. `pkill` 같은 넓은 종료는 쓰지 않는다.

## 5E로 옮길 목록 (여기서 고칠 때마다 한 줄씩)
- `typeset-model.js` `settleFloatingPictures`: 표가 아닌 개체에 `getTableProperties` 부르지 않기(10-20, b1_2013_06_08)
- `typeset.js` `generate()`: 높이 맞춤(`fitQuestionPage`) 전에 한 번 저장해 다시 열기 — 내어쓰기(`applyQuestionIndent` hangPx) 뒤 엔진이 〈보기〉·선지 표의 세로 자리를 옛 값으로 들고 있어(reflowLinesegs로도 안 풀림) 높이를 낮게 재 문항이 둘째 쪽으로 넘어감(10-25, b2_2025_06_06: 〈보기〉가 발문 위 185px에 겹쳐 잡힘). examlibrary는 `frame.mjs`에서 고침
- `convert/es/ruled-text-fractions.mjs`: 한글 없는 짧은 분수(A＋C/T＋G, 11/4, ㉠/㉡ — 분자·분모 사이 글자 높이 1.38배 이하), 분모 끝 띄어쓰기 빼고 가운데 판정, 줄의 아래·위·앞 첨자(t₁, X_aY_3a, OH⁻, ᵐ⁺²X), 글–수식 경계 띄어쓰기 ~, 숫자는 \text 없이, 기울인 영문은 수식 글자로(10-25, b2_2026_09_11·b2_2025_09_13·b1_2024_06_15·c2_2026_09_11·c1_2024_06_09). 단위 시험 `test_ruled_text_fractions.mjs`
- `convert/es/live-convert.mjs`: 앞 첨자 `leadingScripts`(질량수 ᵇX → `{}^{b}X`), 수식 글자 사이 2.2pt 넘는 틈은 수식 띄어쓰기(`/~)(10-25, c1_2026_09_11)
- `convert/es/live-equations.mjs` `bindScripts`: 밑글자보다 1.2배 넘게 큰 글자는 첨자로 묶지 않기(10-25, 표 칸 ᵐ⁺²X가 `2_{X}`가 됨, c1_2024_06_09)
- `convert/rules.js` `clean()`: `$…$` 짝으로 읽어 빈 수식만 빼고, 띄어쓰기로 떨어진 두 수식은 ~로 잇기(예전 `/\$\s*\$/` 지우기가 「$X$ $1mol$」→「$X1mol$」). 수식 밖 ∼(U+223C, 함초롬바탕에서 ∞처럼 보임)→～, ․(U+2024)→·(10-25)
- `convert/kice-engine.js`: 대응표 문항에서 선지표 머리줄만 되풀이한 본문 글 덩이(「X Y X Y」) 빼기(10-25, c1_2025_06_02)
- `sheet/typeset-model.js` `normalizeEquationScript`: 빈 밑글자 앞 첨자 `{}^`·`{}_` → `` {`}^ ``(rhwp가 `{}`의 위 첨자를 기준선 아래로 그림 — 핵 기호 `{}^{A}_{Z}X`도 같음), `\text{…}` 안 띄어쓰기 → ~(rhwp가 지움)(10-25)
- `sheet/typeset-model.js` `applyFloatingTable`: 번호 문단 앞에 이어진 표 문단(자료 표 + 범례 「(단위: kcal)」 표)을 함께 띄우고 뒤 표는 앞 표 높이만큼 내림, 띄운 표 문단은 줄 높이 1pt(10-25, b1_2026_06_02: 범례만 글 옆으로 가고 자료 표는 번호 위에 남음 — 범례가 따로 문단이 된 5E 10-25 변경 뒤 생김)
- `sheet/typeset-model.js` `settleFloatingPictures`: 띄운 개체만 든 문단은 건너뛰고 그 아래 글 문단까지 좁히기, 한 문단은 한 번만 좁히기, 개체 윗변과 같은 높이에서 시작하는 문단은 길어도 좁힌 채 두기(10-25, b1_2026_11_09: 표가 발문을 덮음)
- `sheet/typeset-model.js` `growCellsToContent`(새 함수) + `typeset.js generate()`에서 높이 맞춤 전에 부르기: 칸 높이(cellSz)가 들여온 뒤 바뀐 줄 간격을 따라가지 않아 상자 마지막 줄이 잘림(10-25, b1_2026_06_09 상자 안 글|그림). 칸 상자 안에서 시작하는 조각만, 60px 넘게 늘리지 않음
- `convert/kice-engine.js`: 〈보기〉 칸이 있으면 「<보 기>」 제목만 든 본문 글 덩이 빼기, 문장 끝 「…다.」 뒤에 붙은 과목 띠 로마 숫자(I, Ⅱ) 떼기(10-25, b1_2025_06_04)
- `convert/rules.js` `uprightScript`(clean 안): 단위(수 뒤 kg·km·mol·Mpc, 0.2 m, 210 N, km/s, 5×10⁻⁷ m, 단독 mol·cal/kg·℃)와 실제 원소 화학식(KCl, H₂O, NaOH, Ca²⁺, CO(g))을 `{rm …}`로. 변수(3m의 m, B₀, v₀, PV)·가상 원소(X, Y⁻, A(aq), B(s))는 그대로(10-25, 단위 시험 `test_frame_text_rules.mjs`)
- `convert/es/live-convert.mjs`: 본문 글꼴 아래 첨자 — 조각 「X1」의 폭이 글자 폭 합보다 좁으면(끝 숫자 45~85% 크기) X₁, 영문 뒤 작게 내려 찍힌 숫자 조각(d 뒤 「1～」)은 d₁～(10-25, b2_2026_09_11·b1_2026_06_13). 띄어쓰기 든 조각(「X2, Y1」)은 띄어쓰기 폭이 0으로 나와 아직 못 함

## 10-25 examlibrary 세션 결과 (이식 + 수식·배치)
- 커밋: `0bf577bd` 이식, `b9f77c2e` 수식, 그 뒤 배치·단위·첨자 커밋. 푸시·배포 안 함.
- qa:frame(1,440): 10-20 1377 → 이식 1367(줄어든 10 = 글 옆 표를 원본처럼 옆에 놓아 읽는 순서만 바뀐 8 + 대응표 3묶음 머리줄 수식 수 2, 눈으로 확인) → 최종 1367. 엄격 모양 일치 1087(75.5%) → 1241(86.2%). 모으기 실패 0.
- 검사 도구: `tools/frame-qa/run.mjs --root <사본>`(채점 중 코드를 고쳐도 안 섞이게), `board.mjs --root <사본>`(이전 커밋과 나란히).
- 남은 문제(눈에 띄는 것):
  - 대응표·학생 선지 「⑤ A, B, C」가 다음 줄로 넘어감(c2_2026_06_01, e1_2024_06_01) — 수식 폭을 좁게 재는 듯(handoff 선지 배열)
  - 한 글자 원소(O, K, C)·LED 같은 약어는 기울어진 채(가상 원소와 구분 불가)
  - 빈칸 상자(☐, ㉠ 상자) 테두리가 빠짐(c1_2025_09_04, c2_2024_06_01)
  - e2_2024_09_11 표와 지도 위아래로 쌓임, e2_2025_06_01 그림 이름 줄이 본문으로(글 옆 단독 그림은 handoff가 이름을 안 그림), c1_2025_09_04 장치 그림 위치
  - b2_2025_09_11 염기 서열 줄(3'-㉡㉠…-5')이 빠짐(이식 전부터)
  - 글 옆 그림·표 옆 줄의 양쪽 정렬 벌어짐, 반응식 줄 가운데 맞춤·큰 띄움(2A(g) → … v=k[A])
