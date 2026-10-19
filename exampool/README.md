# 5E 문항 틀 (기출 → 한글)

과학탐구 기출을 「한글 변환」할 때 5E ExamPool 「변형」과 같은 문항 틀(발문·자료·〈보기〉·선지 칸, 그림 가운데,
나란한 그림은 2×N 표, 글 옆 그림은 어울림)로 만든다. AI를 쓰지 않는다.

- `frame.mjs` — 연결부. 문항 변환(`convertFrame`), 문항 문서를 시험지 한 문서로 모으기(`assembleFrameCollection`).
- `convert/` — 5E `assets/exampool/convert` (kice-engine·rules·figures). PDF 글자·그림 위치로 ExamPool 문항을 만든다.
- `es/` — 기출 탐색기 변환기 중 5E가 고친 세 파일(live-convert·live-tables·pdf-drawings). 나머지는 저장소 루트 모듈을 같이 쓴다.
- `sheet/`, `authoring/schema.js` — 5E `assets/exampool/sheet` 중 상세 조판(문항 한 개 한글 문서)과 시험지 쪽 나눔에 필요한 것만.
- `records.json` — 2024~2026 과탐 1,440문항 조사 기록(틀 유형·자료 구조·배치·선지 배열)과 잘린 영역 보정 18건.
- `rhwp/rhwp.js` — rhwp 0.8.7 wasm-bindgen 연결 코드(MIT). 엔진 파일은 `studio/assets/rhwp_bg-BkVWMBaR.wasm`을 같이 쓴다.
- `studio/`, `editor/` — 5E 본체와 같은 rhwp-studio·@rhwp/editor 0.8.7. 5E 틀 문서는 이 편집기로 연다
  (기존 0.8.6 편집기로 열면 수식 줄·그림 위치가 최대 300px 어긋나고 저장할 때 줄 배치가 바뀐다).
- `vendor/` — JSZip, SheetJS(한글 저장본의 CFB 읽기·쓰기).

출처: 5E `integration/1.7.0` 51db3a1b (assets/exampool, vendor/rhwp-studio, vendor/rhwp-editor). 같은 저자.

검사: `npm run qa:frame` (5E 하네스와 같은 채점표, 1,440문항), `npm run qa:frame-e2e` (화면 흐름·내려받은 HWPX),
`node --test test_frame_integration.mjs`.
