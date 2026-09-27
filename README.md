# 기출 탐색기

5E의 기출 검색 화면을 별도 정적 사이트로 분리한 저장소입니다. 서버나 켜진 Mac 없이 GitHub Pages에서 동작합니다. 검색은 브라우저에서 최대 세 단어를 AND 조건으로 수행하며, 문항 카드·교육과정/성취기준 확인을 제공합니다. 고해상도 문항과 시험지 전체 페이지는 5E의 공개 Google Drive 게이트웨이에서 PDF 원본을 받아 PDF.js로 표시합니다. 방문자의 Google 로그인은 필요하지 않습니다.

## 구성

- `data/questions.json`: 8,420개 문항의 텍스트 색인과 메타데이터
- `cards/`: PDF에서 미리 만든 문항별 WebP 이미지
- `data/files.json`: 시험지의 페이지 수와 공개 공유 폴더 내 상대 경로. PDF 바이트나 비공개 파일 ID는 포함하지 않음
- `thumbnails/`: 시험지 첫 페이지 미리보기
- `search.mjs`: 5E 로컬 검색 규칙을 브라우저용으로 옮긴 코드
- `drive-source.mjs`: 5E 공개 게이트웨이를 통해 원본 PDF를 가져옴
- `pdf-viewer.mjs`: 받은 PDF 바이트를 PDF.js로 문항과 스크롤 가능한 시험지 페이지에 렌더링
- `data/editable/`: 대표 문항의 구조화 초안과 편집 가능한 HWPX, 지원 여부 목록
- `editable-editor.mjs`: 문항 화면에서 rhwp 편집기를 열고 수정본을 내려받는 기능

`build_static.py`는 로컬 색인·PDF 폴더·공유 폴더의 `pack.json`을 입력받아 배포 파일을 다시 생성합니다. 공유 폴더에 경로가 없는 시험지는 빌드가 실패합니다. 개인 Google Drive 경로와 PDF 원본은 저장소에 기록하지 않습니다.

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

## 편집 가능한 문항 초안

문항 원본에서 `한글 문서에서 보기`를 누르면 준비된 HWPX를 rhwp로 열 수 있습니다. 본문·발문·<보기>·선지를 수정하고 `HWPX 내려받기`로 별도 파일을 저장합니다. 수식은 HWPX의 편집 가능한 수식 개체이며, 그림·도표는 현재 변환 대상에서 제외됩니다. PDF 원본과 검색 자료는 변경되지 않습니다.

현재 첫 검증 묶음은 물리학Ⅱ 5문항입니다. `p2_2018_06_06`은 분수 수식 3개를 포함합니다. `p2_2018_06_15`는 ExamPool의 문항 행 구분이 실패해 편집본을 제공하지 않으며, 버튼을 누르면 실패 이유를 보여줍니다. 나머지 문항도 모두 `원본 대조 필요` 초안이며, PDF의 글꼴 인코딩에 따라 띄어쓰기·기호·문장 순서가 틀릴 수 있습니다. 원본을 확인하기 전에는 완성된 문항으로 사용하지 마세요.

추가 문항은 원본 PDF가 있는 로컬 환경에서 생성합니다. PDF와 ExamPool 소스는 이 저장소에 복사하지 않습니다.

```bash
UV_CACHE_DIR=/path/to/uv-cache uv run --no-project --python 3.12 \
  --with pymupdf==1.28.0 --with 'pydantic>=2' --with 'fonttools>=4.63' \
  --with pillow --with olefile \
  python tools/build_editable.py \
  --exampool-root /path/to/ExamPool \
  --pdf-root /path/to/exam-search-public/pdfs \
  p2_2018_06_06
node tools/render_editable.mjs --rhwp-core /path/to/5E/manual-library/vendor/rhwp-core
```

`vendor/rhwp-editor`와 `vendor/rhwp-studio`는 5E에서 이미 사용하던 rhwp 0.8.6 편집기 정적 자산을 재사용합니다. 편집기는 사이트에서 직접 제공하므로 방문자가 별도 앱을 설치하거나 외부 편집기 페이지에 접속할 필요가 없습니다.

## 공개 Google Drive 원본

1. 5E의 공유 폴더 `5E_공유폴더테스트_0916/기출문제`와 하위 시험지 PDF에 `링크가 있는 모든 사용자: 보기` 권한을 유지합니다.
2. `data/files.json`의 `publicPath`가 공유 폴더 안의 실제 파일 경로와 일치해야 합니다.
3. 사이트는 `drive-source.mjs`에 설정한 5E 게이트웨이의 공개 URL을 사용합니다. OAuth 클라이언트 ID나 방문자 로그인이 필요하지 않습니다.

새 파일을 추가하거나 Drive에서 파일을 교체한 경우에는 빌드를 다시 실행해 공개 경로·검색 색인·카드를 갱신해야 합니다. 공유 권한이나 5E 게이트웨이가 해제되면 고해상도 미리보기가 열리지 않으며, 이미 생성된 문항 카드는 계속 보입니다.

## 배포와 주의

GitHub Pages는 `main` 브랜치의 루트를 배포합니다. 기존 배포에서 추적하던 `pdfs/`는 배포 트리에서 제외해야 합니다. `.gitignore`는 새 PDF 추가를 막지만, 이미 추적된 421개를 자동으로 제거하지는 않습니다. 또한 새 커밋에서 PDF를 제거해도 과거 Git 기록의 용량은 줄지 않으므로 저장소 자체를 줄이려면 별도의 기록 정리가 필요합니다. 문항 색인이 현재 2개의 읽을 수 없는 PDF를 표시하고, 해당 파일은 배포에서 제외합니다. 특수 글꼴 PDF 일부는 텍스트 검색이 불완전할 수 있으므로 이미지와 원본으로 대조하세요.

코드 라이선스는 [LICENSE](LICENSE)를 따릅니다. PDF와 문항 이미지의 저작권은 각 원저작자에게 있으며, 코드 라이선스가 이 자료의 재배포 권리를 부여하지는 않습니다. 공개 운영 전에 원자료의 이용 조건을 별도로 확인해야 합니다.
