# 개발과 배포

[프로젝트 소개](../README.md) · [데이터와 출처](DATA.md) · [기여 안내](../CONTRIBUTING.md)

## 로컬 준비

```bash
npm ci
npx playwright install chromium webkit
python3 -m http.server 8768 --bind 127.0.0.1
```

학습 모드는 `http://127.0.0.1:8768/?view=study&group=imyong`에서 엽니다. `file://` 직접 열기는 지원하지 않습니다. 브라우저 검사는 공개 원본 PDF와 네트워크에 의존할 수 있습니다.

```bash
npm test
npm run test:imyong
npm run test:study
npm run test:hakpyeong
```

화면 변경에는 관련 `qa:*` 명령을 사용합니다. 출력 경로·로컬 원본 대체 설정은 각 도구와 아래 운영 절차를 확인합니다. 문서만 고칠 때는 링크와 명령·자료 수치를 대조하고 원본 전체를 재생성하지 않습니다.

## 검색 엔진과 기본 색인

첫 화면에서 과목을 고르면 가벼운 문항 목록부터 표시합니다. 본문 검색 색인은 과목별로 필요한 시점에 준비하며, 검색 중에도 이전 결과와 입력한 검색어를 유지합니다. 학년도는 시작·종료 범위를 고른 뒤 적용하며, 기존 단일 학년도 주소도 사용할 수 있습니다. 교육과정·단원·성취기준은 검색어 앞에서 설정하고, 선택한 과목과 학년도 범위에 맞춰 좁혀집니다. 좁은 화면에서는 검색창 앞의 `조건` 버튼으로 모든 검색 조건을 엽니다. 문항 표시 개수는 6·9·18·36개 중 고를 수 있습니다. 상단 컨트롤은 선택값의 길이에 따라 움직이지 않으며, 누를 때 위치 이동 없이 색상으로 즉시 반응합니다.

`data/catalog.json`과 `data/browser/`는 기존 원본 색인에서 생성한 브라우저용 자료입니다. 원본 색인을 변경한 뒤에는 `npm run build:catalog`를 실행하고 생성물을 함께 배포합니다. 검수는 `npm test`, `npm run qa:library`, `npm run qa:library-state`, `npm run qa:search-response`, `npm run qa:toolbar`로 수행합니다. 상단 검수는 실제 자료의 범위 검색, 초안 취소, 한 번의 적용 검색, 주소 복원, 컨트롤 위치 안정성, 좁은 화면과 동작 줄이기 설정을 Chromium·WebKit에서 확인합니다. 측정 조건과 성능·품질 검수 결과는 [검색 반응성 개선 기록](SEARCH_RESPONSIVENESS.md)에 있습니다.

- `data/questions.json`: 과학탐구·국어·영어·수학·사회탐구 19,760개 문항의 텍스트 색인과 메타데이터
- `cards/`: PDF에서 미리 만든 문항별 WebP 이미지
- `data/files.json`: 시험지의 페이지 수와 공개 공유 폴더 내 상대 경로. PDF 바이트나 비공개 파일 ID는 포함하지 않음
- `thumbnails/`: 시험지 첫 페이지 미리보기
- `search.mjs`: 5E 로컬 검색 규칙을 브라우저용으로 옮긴 코드
- `drive-source.mjs`: 5E 공개 게이트웨이를 통해 원본 PDF를 가져옴
- `pdf-viewer.mjs`: 받은 PDF 바이트를 PDF.js로 문항과 스크롤 가능한 시험지 페이지에 렌더링
- `data/editable/`: 대표 문항의 구조화 초안과 편집 가능한 HWPX, 지원 여부 목록
- `editable-editor.mjs`: 문항 화면에서 rhwp 편집기를 열고 수정본을 내려받는 기능

`build_static.py`는 기존 과학탐구 색인을 재생성할 때 로컬 색인·PDF 폴더·공유 폴더의 `pack.json`을 입력받습니다. 확장 과목 색인은 별도의 비공개 원본 수집·검토 절차에서 생성했으며, 이 명령만으로 19,760문항 전체를 재생성할 수는 없습니다. 개인 Google Drive 경로와 PDF 원본은 저장소에 기록하지 않습니다.

```bash
uv run build_static.py \
  --pdf-dir "/path/to/PDF-folder" \
  --index "/path/to/exam-search/.cache/questions.json" \
  --synonyms "/path/to/5E/assets/exam-library/synonyms.json" \
  --public-pack "/path/to/5E_공유폴더테스트_0916/pack.json"
```

로컬 확인:

```bash
python3 -m http.server 8768
npm ci
npm run qa
```

`npm run qa`는 공개 게이트웨이에서 실제 PDF를 읽으므로 로컬 PDF가 필요하지 않습니다. 네트워크 없이 화면을 점검하려면 `EXAM_PDF_DIR="/path/to/PDF-folder" npm run qa`로 로컬 PDF를 모의 응답에 사용합니다.

## 원본 자료 갱신

임용 원본 수집·OCR·색인 생성과 학평 생성 명령은 [데이터 안내](DATA.md)에 있습니다. PDF·비공개 원본·개인 경로는 커밋하지 않습니다. `build_static.py` 하나로 전체 과목을 재생성할 수는 없습니다.

## 이미지 생성과 성능

측정 조건, 개선 전후 수치와 기능 검수 결과는 [이미지 로딩 개선 보고](IMAGE_LOADING_PERFORMANCE.md)에 기록했습니다.

`preview-loader.mjs`는 화면과 인접한 문항만 불러오며, 화면에 보이는 이미지에 우선순위를 둡니다. 정적 이미지 4개와 원본 대체 렌더링 2개의 동시 작업 수를 따로 제한합니다. 검색·페이지 전환으로 필요 없어진 대기 작업을 취소하고, 제거된 카드의 이미지 URL을 해제합니다. 이미지 너비·높이를 목록에 포함해 이미지가 뜰 때 카드가 밀리지 않게 합니다. 목록용 이미지는 한글 변환 입력으로 사용하지 않습니다.

새 원본을 색인한 뒤 로컬에 보관된 PDF로 미리보기를 생성하고 목록을 갱신합니다. 기존 과학탐구 카드, 원본 PDF, 검색 본문과 한글 변환 메타데이터는 유지됩니다. 브라우저의 실제 PDF 렌더·크롭 코드를 사용하며 AI 호출은 없습니다.

```bash
# 로컬 서버를 먼저 실행한 뒤 실제 원본 폴더를 지정합니다.
EXAM_SEARCH_URL=http://127.0.0.1:8813/ npm run build:previews -- /path/to/exam-search-public
npm run build:catalog
EXAM_SOURCE_ROOT=/path/to/exam-search-public npm run qa:images
npm run measure:images -- after
```

원본 폴더에는 `pdfs/`와 `기출확장_국영수사탐/`가 있어야 합니다. 생성 결과는 `previews/`, 원본 버전·이미지 크기·파일 목록은 `data/preview-assets.json`에 보관합니다. 공개 경로나 원본 내용이 바뀌면 먼저 색인을 갱신한 뒤 다시 생성합니다. 이미지 생성으로 기존의 미검증 문항 경계가 검증되는 것은 아닙니다.

## GitHub Pages 배포

- `main` 브랜치 루트를 사용하는 기존 Pages/Jekyll 배포를 유지합니다.
- **`.nojekyll`을 추가하지 않습니다.** `_config.yml`이 학평 카드와 원본 색인·도구·검사·docs를 게시본에서 제외합니다.
- 학평 카드는 같은 저장소의 raw 주소로 제공합니다. 제외 규칙을 없애면 게시 용량 제한을 넘을 수 있습니다.
- 데이터 변경은 생성된 목록·본문 색인·해시·원본 경로의 일치를 확인한 뒤 함께 커밋합니다.
- 푸시 후 Pages 실행 결과와 실제 검색·원본 보기를 확인합니다. `5e.ai.kr/examlibrary` 부모 화면의 주소 연동도 함께 확인합니다.
- 버전은 [저장소와 버전 안내](REPOSITORIES.md)를 따릅니다. 문서만 바꿀 때에는 앱 버전·데이터 판·기존 태그를 바꾸지 않습니다.
