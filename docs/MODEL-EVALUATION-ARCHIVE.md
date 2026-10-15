# 과거 유료 모델 검증 자료

공개 전환일: 2026-10-15. **실제 유료 API 호출로 수행했던 모델 비교와 대화 검증은 이전 실패와 재검사까지 보존했다.** 이번 공개 준비에서 모델을 다시 호출하거나 과거 결과를 최신 결과로 바꾸지 않았다. [최신 자동 검사 144개](portfolio/LATEST-VALIDATION.md), [기존 응답을 재생한 시연 영상](demo/README.md)과 구분한다.

## 평가 흐름과 원문

| 단계 | 당시 확인한 내용 | 원문과 설명 |
| --- | --- | --- |
| 2026-10-08 초기 모델 비교 | gpt-4.1-mini, gpt-6-luna, gpt-5.4-mini, gpt-6-sol의 기억과 응답 비교, 최종 14개 사례 | [평가 방법과 비교](EVALUATION.md), [최종 14건](evidence/live-eval.json), [초기 구현 검증](VALIDATION.md) |
| 100개 합성 메시지의 기억 실험 | 앞부분의 약속을 압축 인용과 최근 40개 메시지로 회상 | [입력, 인용과 실제 답변](evidence/live-episode-eval.json). 실제 사용자와 100턴 대화하거나 모델을 100회 호출한 실험은 아님 |
| 테일비 개편 당시 검사 | 16종 시나리오, 최초 13회와 수정 후 4회, 최종 회귀 7회. 차단과 설정 오류도 기록 | [개편 검증](TALEVI-VALIDATION.md#실제-모델-평가와-수정), [13회](evidence/talevi-live-eval.json), [4회](evidence/talevi-live-eval-revision.json), [7회](evidence/talevi-live-eval-canon.json) |
| 30명 개선 전 기준선 | 240회 중 238회 완료, 2회 차단. 기억 소실과 반복 표현 등의 문제 재현 | [문제 분석](QUALITY-AUDIT-2026-10-10.md), [당시 전체 대사](evidence/cast-audit-2026-10-10/TRANSCRIPTS.md) |
| 중간 수정과 재검증 | 실패 입력, 기억 편집, 약속 정정과 관계/서사 개선을 반복 검사 | 아래 버전별 보존 목록. 현재 결과와 합쳐 성공률을 만들지 않음 |
| 2026-10-10 최종 v11 | 완료된 평가 응답 1,256건. 30명 각각 30턴, 실제 압축 후 정정된 5개 사실 회상 | [30명별 개선 보고서](QUALITY-IMPROVEMENTS-2026-10-10.md), [최종 원문 안내](evidence/cast-v11-2026-10-10/README.md), [공개 요약](portfolio/VALIDATION.md) |

## 최종 v11의 1,256건 구성

| 검사 | 완료 응답 |
| --- | ---: |
| 30명 기본, 각 8회 | 240 |
| 30명 연속 대화, 각 30턴 | 900 |
| 6명 모드 비교 | 12 |
| 이전 차단 입력 재검사 | 4 |
| 30명 첫 만남 / 깊은 신뢰 상태 비교 | 60 |
| 6명 허구 약속 / 현실 만남 구분 | 12 |
| 실제 HTTP / DB / 워커 / SSE 기억 처리 | 8 |
| 추가 회귀 입력 | 14 |
| 자연스러운 한국어 기억 표현 | 6 |
| **합계** | **1,256** |

1,256은 v11에서 완료한 평가 응답 수다. 초기 모델 비교와 이전 버전까지 포함한 누적 총호출 수, 전체 과금 요청 수 또는 오류 없는 운영 요청 수가 아니다. 초안 보완, moderation, 압축 호출, 실패와 재시도는 별도로 발생할 수 있다. 공급자의 청구액이나 모든 과금 요청을 재계산한 자료는 아니다.

압축 요청의 시간 초과로 평가가 중단됐을 때 먼저 저장된 817건을 보존하고 미완료 항목만 재개했다. [중단/재개 기록](evidence/cast-v11-2026-10-10/interruption-and-resume.json)과 [경로만 가린 원본 실행 로그](evidence/cast-v11-2026-10-10/extended-run.log)도 공개한다. 원래 기록된 로그 해시는 정리 전 파일을 가리키며, [전후 해시 목록](publication-evidence-preservation.json)으로 현재 파일과 연결할 수 있다.

## 이전 버전도 그대로 보존

다음 수량은 파일 수이며 모델 호출 수가 아니다. 모든 디렉터리에는 당시 JSON/JSONL, 입력과 출력, 상태, 보고서, 실행 로그 또는 화면 증거가 포함된다.

| 위치 | 보존 파일 수 |
| --- | ---: |
| [초기 및 개편 평가와 화면](evidence/)의 최상위 파일 | 28 |
| [cast-audit](evidence/cast-audit-2026-10-10/) | 7 |
| [cast-final](evidence/cast-final-2026-10-10/) | 14 |
| [cast-revalidation](evidence/cast-revalidation-2026-10-10/) | 7 |
| [cast-v9](evidence/cast-v9-2026-10-10/) | 14 |
| [cast-v10](evidence/cast-v10-2026-10-10/) | 22 |
| [cast-v11](evidence/cast-v11-2026-10-10/) | 34 |
| **합계** | **126** |

123개는 정리 전 파일과 바이트 단위로 동일하다. 나머지 3개 `extended-run.log`는 로컬 프로젝트 경로 36곳만 `<PROJECT_ROOT>`로 치환했다. 대사, 입력, 관계/기억 상태, 모델 ID, 프롬프트 버전, 측정값과 실패 내용은 삭제하지 않았다. [보존 검증 상세](HISTORY-REWRITE-2026-10-15.md)

## 결과를 읽을 때

모든 입력은 평가용 합성 대화다. 독립적인 사람 평가자, 경쟁 서비스와의 동일 조건 사용자 평가, 수개월의 기억, 공개 운영 부하 검증을 수행한 것은 아니다. 30명 관계 단계 비교는 상태를 직접 넣은 실험이며 자연스럽게 깊은 관계에 도달했다는 증거가 아니다. 문자열 검사와 Codex의 정성 검토도 구분해 기록했다.

재현 도구는 [초기 평가](../apps/api/yeoun/evaluate.py), [이전 장면 기억](../apps/api/yeoun/evaluate_episodes.py), [30명 기본](../apps/api/yeoun/audit_cast.py), [긴 대화](../apps/api/yeoun/audit_extended.py), [관계](../apps/api/yeoun/audit_relationship.py), [기억 API 흐름](../apps/api/yeoun/audit_memory_flow.py)에 보존했다. 실제 실행에는 유료 모델 호출이 필요하며, 기존 증거를 덮어쓰지 않는 별도 출력 경로를 사용해야 한다. 이 도구들을 일반 CI나 공개 준비 검사에서 다시 실행하지 않았다.
