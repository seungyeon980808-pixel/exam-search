# 5E 저장소 구성과 버전

[기출 탐색기 소개](../README.md) · [5E_print](https://github.com/seungyeon980808-pixel/print)

## 어떤 저장소를 고치나요

| 저장소 | 맡은 일 | 공개 주소 | 수정할 때 |
| --- | --- | --- | --- |
| [exam-search](https://github.com/seungyeon980808-pixel/exam-search) | 기출 검색·문항 이미지·원본 보기·임용 학습 모드 | [기출 탐색기](https://www.5e.ai.kr/examlibrary/) | 검색·학습 동작과 색인을 바꿀 때 |
| [print](https://github.com/seungyeon980808-pixel/print) | 제작 설문·AI 제작 규칙·Typst 서식·임용 원문 합성 | [교재 제작](https://www.5e.ai.kr/print/) | 제작 조건·서식·합성 도구를 바꿀 때 |
| [5E](https://github.com/seungyeon980808-pixel/5E) | 편집기 본체·서비스 진입 주소·연결 화면과 게시 절차 | [5E](https://www.5e.ai.kr/) | 부모 화면·서비스 경로·본체를 바꿀 때 |

```mermaid
flowchart LR
  H["5E · 서비스 진입 화면"] --> L["exam-search · 찾기와 학습"]
  L -->|"선택 범위"| P["print · 제작 요청과 도구"]
  D["공개 자료 폴더 · 원본 PDF"] -->|"공개 게이트웨이"| L
  D -->|"원본 해시 확인"| P
  P --> B["사용자 자료 폴더 · 교재 PDF와 문항표"]
```

원본 PDF는 공유 자료 폴더에, 생성·검색 코드는 각 저장소에 둡니다. 기출 탐색기의 검색·학습은 브라우저에서 동작하고, print의 맞춤 교재는 제작 요청을 받은 로컬 AI·스크립트가 만듭니다.

## 서로 다른 네 가지 버전

| 구분 | 기록 위치 | 의미 |
| --- | --- | --- |
| 앱·도구 버전 | 각 저장소 `version.json`, `CHANGELOG.md`, Git 태그 | 기능·수정이 반영된 코드 판 |
| 문항 자료판 | `dataVersion` | 어떤 수집·색인 자료를 사용했는지 |
| 주제 분류판 | `topicVersion` | 어떤 단원·주제 규칙을 사용했는지 |
| 교재 파일 판 | 파일명 `v1`, `v2`와 제작 설정·문항표 | 같은 사용자의 교재를 고친 횟수와 제작 근거 |

기출 탐색기와 print는 2026-11-09 기준 각각 `v1.1.1`, 문항 자료는 `imyong-2002-2026-v1`, 주제 분류는 `imyong-topics-v1`입니다. 5E 본체 버전은 별도로 관리합니다. 교재 파일의 `v2`가 앱 `v2.0.0`을 뜻하지 않습니다.

학습 기록에는 별도 스키마 1을 사용합니다. 메모·완료 여부는 앱 릴리스와 구분되며 브라우저 저장·JSON 백업으로 보관합니다.

## 변경을 반영할 때

1. 관련 저장소에서 수정하고 변경에 맞는 검사를 실행합니다.
2. 기능·오류 수정은 변경 내역과 버전 파일을 함께 정리합니다. 문서만 고칠 때는 앱·자료 버전과 기존 태그를 바꾸지 않습니다.
3. 릴리스 태그는 검증한 커밋에 새로 붙입니다. 이미 공개한 태그나 교재를 다른 내용으로 바꾸지 않습니다.
4. 코드 커밋·자료판·주제판·제작 설정·문항 ID를 함께 남겨 교재 범위를 재현합니다.
5. 게시된 서비스 주소에서 실제 동작을 확인합니다. 저장소에 푸시한 것과 서비스에 배포된 것을 구분합니다.

`exam-search`는 자체 GitHub Pages 배포입니다. `print/survey/index.html`은 5E 저장소의 `print/index.html`로 반영한 뒤 **Print Route** 절차로 게시하므로 print 저장소만 푸시해서 공개 설문이 바뀌지는 않습니다. [print 게시 절차](https://github.com/seungyeon980808-pixel/print/blob/main/docs/DEVELOPMENT.md)를 참고하세요.
