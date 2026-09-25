# 기출 탐색기

5E의 기출 검색 화면을 별도 정적 사이트로 분리한 저장소입니다. 서버나 켜진 Mac 없이 GitHub Pages에서 동작합니다. 검색은 브라우저에서 최대 세 단어를 AND 조건으로 수행하며, 문항 카드·고해상도 원본·시험지별 PDF 스크롤 보기·교육과정/성취기준 확인을 제공합니다.

## 구성

- `data/questions.json`: 8,420개 문항의 텍스트 색인과 메타데이터
- `cards/`: PDF에서 미리 만든 문항별 WebP 이미지
- `pdfs/`: 시험지 원본 PDF
- `thumbnails/`: 시험지 첫 페이지 미리보기
- `search.mjs`: 5E 로컬 검색 규칙을 브라우저용으로 옮긴 코드
- `pdf-viewer.mjs`: PDF.js로 선택 문항과 스크롤 가능한 시험지 페이지를 필요할 때 렌더링

`build_static.py`는 로컬 색인과 PDF 폴더를 입력받아 배포 파일을 다시 생성합니다. 개인 Google Drive 경로는 저장소에 기록하지 않습니다.

```bash
uv run build_static.py \
  --pdf-dir "/path/to/PDF-folder" \
  --index "/path/to/exam-search/.cache/questions.json" \
  --synonyms "/path/to/5E/assets/exam-library/synonyms.json"
```

로컬 확인:

```bash
python3 -m http.server 8768
npm ci
npm run qa
```

## 배포와 주의

GitHub Pages는 `main` 브랜치의 루트를 배포합니다. 정적 파일 총량은 약 855 MiB이며, 현재 무료 Pages 사이트 용량 한도인 1 GiB 미만입니다. 월간 전송량의 소프트 한도와 서비스 이용 조건은 사용량에 따라 다시 확인해야 합니다. 문항 색인이 현재 2개의 읽을 수 없는 PDF를 표시하고, 해당 파일은 배포에서 제외합니다. 특수 글꼴 PDF 일부는 텍스트 검색이 불완전할 수 있으므로 이미지와 원본으로 대조하세요.

코드 라이선스는 [LICENSE](LICENSE)를 따릅니다. PDF와 문항 이미지의 저작권은 각 원저작자에게 있으며, 코드 라이선스가 이 자료의 재배포 권리를 부여하지는 않습니다. 공개 운영 전에 원자료의 이용 조건을 별도로 확인해야 합니다.
