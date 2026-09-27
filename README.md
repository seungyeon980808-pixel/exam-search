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

## 공개 Google Drive 원본

1. 5E의 공유 폴더 `5E_공유폴더테스트_0916/기출문제`와 하위 시험지 PDF에 `링크가 있는 모든 사용자: 보기` 권한을 유지합니다.
2. `data/files.json`의 `publicPath`가 공유 폴더 안의 실제 파일 경로와 일치해야 합니다.
3. 사이트는 `drive-source.mjs`에 설정한 5E 게이트웨이의 공개 URL을 사용합니다. OAuth 클라이언트 ID나 방문자 로그인이 필요하지 않습니다.

새 파일을 추가하거나 Drive에서 파일을 교체한 경우에는 빌드를 다시 실행해 공개 경로·검색 색인·카드를 갱신해야 합니다. 공유 권한이나 5E 게이트웨이가 해제되면 고해상도 미리보기가 열리지 않으며, 이미 생성된 문항 카드는 계속 보입니다.

## 배포와 주의

GitHub Pages는 `main` 브랜치의 루트를 배포합니다. 기존 배포에서 추적하던 `pdfs/`는 배포 트리에서 제외해야 합니다. `.gitignore`는 새 PDF 추가를 막지만, 이미 추적된 421개를 자동으로 제거하지는 않습니다. 또한 새 커밋에서 PDF를 제거해도 과거 Git 기록의 용량은 줄지 않으므로 저장소 자체를 줄이려면 별도의 기록 정리가 필요합니다. 문항 색인이 현재 2개의 읽을 수 없는 PDF를 표시하고, 해당 파일은 배포에서 제외합니다. 특수 글꼴 PDF 일부는 텍스트 검색이 불완전할 수 있으므로 이미지와 원본으로 대조하세요.

코드 라이선스는 [LICENSE](LICENSE)를 따릅니다. PDF와 문항 이미지의 저작권은 각 원저작자에게 있으며, 코드 라이선스가 이 자료의 재배포 권리를 부여하지는 않습니다. 공개 운영 전에 원자료의 이용 조건을 별도로 확인해야 합니다.
