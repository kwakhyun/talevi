# 최종 대화 엔진 v11 증거

보고서: [개선 내용과 30명 재검증](../../QUALITY-IMPROVEMENTS-2026-10-10.md).

실제 OpenAI 모델을 사용한 합성 입력이다. 기존 이용자의 대화나 잔액은 사용하지 않았다. 독립적인 사람의 평가자는 0명이고, 경쟁 서비스와 동일 조건의 대화 비교도 하지 않았다.

## 생성 결과

| 자료 | 범위 | 해석 |
| --- | --- | --- |
| [manifest.json](manifest.json) | 프롬프트, 모델, 코드/카탈로그 해시, 입력 | 실행 설정 |
| [responses.jsonl](responses.jsonl) | 30명 × 기본 8회 | 3개 시작 문장, 자기 과거, 소개/위로/기억/거절 |
| [extended.jsonl](extended.jsonl) | 30명 × 30턴 + 모드 비교 12회 + 이전 실패 입력 4회 | 실제 압축과 상태 갱신을 적용한 엔진 검사 |
| [extended-manifest.json](extended-manifest.json) | 캐릭터 목록, 턴 수, 동시 실행 수 | 범위 확인 |
| [summary.json](summary.json) | 응답 완료, 문자 회상, 분량, 지연 | 기계적 진단이며 사람의 품질 점수가 아님 |
| [TRANSCRIPTS.md](TRANSCRIPTS.md) | 캐릭터별 기본/후속 원문 | 답변 문맥 검토용 |
| [relationship-stage.jsonl](relationship-stage.jsonl) | 30명 × 첫 만남/깊은 신뢰 2회 | 관계 상태를 주입한 통제 검사. 90턴 실제 관계 형성을 뜻하지 않음 |
| [content-review.json](content-review.json) | 개인 과거/거리 요청/최종 회상 검토 | 검토한 범위를 명시하며 전체 응답의 의미적 무결함을 주장하지 않음 |
| [qualitative-review.json](qualitative-review.json) | 30명 대사 관찰 | Codex의 정성 검토. 블라인드 인물 식별 점수가 아님 |
| [immersion.jsonl](immersion.jsonl) | 6명 × 허구 약속/현실 만남 2회 | 역할극 몰입과 AI 정체성 구분 |
| [memory-http.json](memory-http.json) | 새 합성 게스트 8턴 | 실제 HTTP, DB, 워커, SSE로 편집/삭제/잠금/격리 확인 |
| [adversarial-regression.json](adversarial-regression.json) | 14회 | 기억, 거절, 프롬프트 공격 회귀. 정답 문자 검사가 없는 항목은 null |
| [memory-variants.json](memory-variants.json) | 자연스러운 한국어 표현 6회 | 값이 원문 구절인 경우 명사만 기대한 exact_facts_pass는 false. 의미는 별도 검토 |

기본/후속 검사는 프로덕션 생성과 검수 함수를 호출하고 워커의 상태 갱신 함수를 재사용한다. HTTP/DB 대기나 브라우저 렌더링까지 포함한 지연과 구분한다. 실제 API 통합은 별도 8턴이며, 브라우저 검증은 집계에서 제외했다. 초안 재생성, moderation, 과거 인용 선택 호출은 답변 턴 수와 별개다.

후속 817건이 저장된 뒤 과거 인용 선택 요청이 `APITimeoutError`로 끝나 평가 도구가 중단됐다. 저장된 응답과 당시 상태를 보존하고 미완료 항목만 재개했다. 실제 서비스의 워커에는 이미 25초 제한과 최근 40개 메시지로 계속 응답하는 처리가 있어, 평가 도구에도 동일한 실패 처리를 적용했다. [중단과 재개 기록](interruption-and-resume.json)에 원본 로그와 저장된 앞부분의 해시를 남겼다. 완료된 결과 수를 전체 API 호출의 무장애율로 해석하지 않는다.

## 구현 검증

- [pytest.txt](pytest.txt): 전용 테스트 DB, 61개 통과.
- [lint.txt](lint.txt): 프로젝트에서 사용하는 Ruff F/I 규칙.
- [typecheck.txt](typecheck.txt), [web-build.txt](web-build.txt), [mobile-export.txt](mobile-export.txt): 최종 UI 변경 후 검사. 뒤의 v11 변경은 서버 프롬프트와 연기에 한정됐으므로 동일 UI의 성공 로그를 재사용했다. 실기기 설치 검증은 아니다.
- [relationship-policies.json](relationship-policies.json): 30명 × 2가지 관계 속도, 의미 없는 입력 85회. 실제 LLM 대화가 아닌 규칙 실행이다.
- [runtime-check.json](runtime-check.json): 게시 캐릭터 30명과 카탈로그 일치, 마이그레이션, 브라우저 응답 v11 확인.
- [source-snapshot.json](source-snapshot.json): 주요 구현 파일 해시와 재사용한 검사 설명.
- [웹 화면](relationship-desktop.png), [모바일 화면](relationship-mobile.png): 실제 웹 UI. React Native 실기기 캡처가 아니다.

## 재실행

다음 모듈은 `apps/api`에서 실행하며 실제 모델 사용료가 발생한다. 기존 증거를 덮어쓰지 않도록 `CAST_AUDIT_OUTPUT`을 새 경로로 지정한다. 기본 검사는 프롬프트/카탈로그/설정이 일치할 때만 이어서 실행한다.

```sh
CAST_AUDIT_OUTPUT=../../docs/evidence/new-run ../../.venv/bin/python -m yeoun.audit_cast
CAST_AUDIT_OUTPUT=../../docs/evidence/new-run AUDIT_CONCURRENCY=8 LONG_CAST=taeo,eunho,doyun,yujun,sihyeok,igyeol,rohan,siu,yuchan,astel,arin,nari,rina,jiwoo,soyul,elise,chaerin,rumi,daeun,serena,seah,sion,yura,jihan,haru,dogeon,seoyun,kairen,ian,doha ../../.venv/bin/python -m yeoun.audit_extended
CAST_AUDIT_OUTPUT=../../docs/evidence/new-run ../../.venv/bin/python -m yeoun.audit_relationship
CAST_AUDIT_OUTPUT=../../docs/evidence/new-run ../../.venv/bin/python -m yeoun.audit_immersion
CAST_AUDIT_OUTPUT=../../docs/evidence/new-run ../../.venv/bin/python -m yeoun.audit_memory_flow
CAST_AUDIT_OUTPUT=../../docs/evidence/new-run ../../.venv/bin/python -m yeoun.summarize_cast_audit
```

마지막 모듈은 240개 기본 결과와 916개 후속 결과, 각 캐릭터별 수량과 프롬프트 버전이 모두 맞지 않으면 요약 생성을 거부한다. 단어가 포함됐다는 것만으로 약속 합의나 답변의 몰입을 통과시키지 말고 원문을 함께 읽는다.
