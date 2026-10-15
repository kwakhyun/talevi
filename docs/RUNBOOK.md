# 실행과 운영 인수인계

## 로컬 실행

현재 작업 환경에서 웹은 http://localhost:3000, API는 http://127.0.0.1:8000, PostgreSQL은 54329 포트에서 실행했다. 실행 세션이 끝났으면 다음 순서로 다시 시작한다. Node 22 이상, Python 3.11 이상을 사용한다.

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r apps/api/requirements.lock
```

`.env.local`이 없다면 `.env.example`을 복사한다. 체험 모드만 실행할 때 `DEMO_MODE=true`. 이미 저장된 `.env.local`을 덮어쓰지 않는다. API 키는 대화나 소스코드에 붙여 넣지 않고 보안 설정 흐름으로 저장한다.

터미널 1, 저장소 루트:

```sh
npm run db:start
```

터미널 2:

```sh
cd apps/api
../../.venv/bin/python -m yeoun.migrate
../../.venv/bin/uvicorn yeoun.main:app --host 127.0.0.1 --port 8000
```

터미널 3, 저장소 루트:

```sh
npm run dev
```

앱:

```sh
cd apps/mobile
npx expo start
```

실기기에서 `127.0.0.1`은 전화기 자신이다. `apps/mobile/.env`에 접근 가능한 API/이미지 서버 주소를 지정해야 한다. 공개 서비스는 HTTPS만 사용한다. 스토어 구매는 Expo Go가 아닌 네이티브 개발 빌드와 스토어 샌드박스 계정이 필요하다. 현재 결과는 양 플랫폼 JavaScript/Hermes 번들 생성까지 확인했으며 Xcode/Android 실기기 실행 확인과 다르다.

## 검증 명령

```sh
npm run typecheck
npm run test:chat-stream
npm run test:mobile-chat
npm run build
cd apps/api
../../.venv/bin/python -m pytest -q
../../.venv/bin/alembic check
```

테스트는 `yeoun_test` 전용 DB를 매번 초기화한다. `TEST_DATABASE_URL`을 운영 DB로 설정하지 않는다. 테스트 코드에도 DB 이름 검사를 넣었다.

API 테스트는 실제 모델 키를 비우고 외부 HTTP 전송을 차단한다. 기본 회귀 검사에 유료 모델 호출은 필요 없다. [재생성, 편집, 분기 검증](CHAT-BRANCHING.md)은 30명 전체의 상태 복원을 고정 응답으로 검사한다. 2026-10-15 기준 로컬 스키마 head는 `93acde81f204`다. 상태 기록이 없는 이전 메시지는 복원 기능을 제공하지 않으며 업데이트 이후 새 턴부터 사용한다.

```sh
cd apps/mobile
npx expo export --platform ios --platform android --output-dir dist
```

## 실제 모델 연결

OpenAI 키는 저장소 루트 `.env.local`의 `OPENAI_API_KEY`에서 API가 읽는다. 현재 이 작업 폴더에는 키가 보안 흐름으로 저장돼 있고 `DEMO_MODE=false`로 실제 대화를 실행한다. 키 값은 출력하거나 Git에 포함하지 않는다. 다른 환경에서 전환할 때에는 키 설정과 모드 변경 후 API/워커를 재시작한다. 키가 없는 실제 모드는 크레딧을 차감하기 전에 503을 반환한다. 기본 모델을 사용할 수 있는 프로젝트인지 확인하고 `MODEL_QUICK`, `MODEL_STORY`, `MODEL_MEMORY`, `MODEL_FALLBACK`을 검증한 모델 ID로 설정한다.

`docs/EVALUATION.md`에 실제 합성 대화 평가와 장기 문맥 실험 결과를 기록했다. 소규모 결과를 실제 이용자 만족도, 대규모 지연 목표나 원가 검증으로 확대 해석하지 않는다. 사용자 대화는 모델 공급자에게 전송되므로 서비스의 데이터 처리 고지에 반영한다. API 요청은 `store=false`를 사용하나 공급자 전체 보관 정책을 대신하는 설정은 아니다.

## 선택한 관리형 배포와 현재 상태

사용자는 Vercel 웹 + 관리형 API/PostgreSQL 구성을 선택한 뒤, 공개 배포를 보류하고 로컬 완성을 요청했다. Vercel의 `khyun/yeoun` 프로젝트를 생성하고 로컬에 연결했으나 소스를 배포하거나 도메인을 공개하지 않았다. Render에는 리소스를 생성하지 않았다. 2026-10-12에는 전체 소스를 비공개 GitHub 저장소 `kwakhyun/talevi`에, 소개 자료를 공개 `kwakhyun/talevi-portfolio`에 보관하는 구조를 선택했다. 이는 서비스 배포와 별개이며 [저장소 운영 방침](PUBLISHING.md)에 범위를 정리했다.

`render.yaml`은 싱가포르의 API, 독립 워커, PostgreSQL을 정의한다. DB 외부 접근은 차단하고 서비스 사이의 내부 주소를 사용한다. `WEB_ORIGIN`과 OpenAI 키는 Render 보안 입력으로 제공한다. API와 워커의 pre-deploy는 advisory lock으로 직렬화된 Alembic을 실행한다. Vercel의 `API_INTERNAL_URL`에는 실제 API HTTPS 주소를 설정하고 재빌드한다. `.vercelignore`는 비밀 파일과 로컬 DB를 제외한다. 해당 클라우드 설정은 아직 실제 배포 검증을 거치지 않았다.

근거: [Render Blueprint](https://render.com/docs/blueprint-spec), [백그라운드 워커](https://render.com/docs/background-workers), [Vercel 배포](https://vercel.com/docs/deployments).

## 운영 배포 구성

`compose.yml`과 `deployment/`에 API, 독립 워커, 웹, PostgreSQL, nginx 구성이 있다. 이 환경에는 Docker daemon이 없어 이미지 빌드와 컨테이너 기동은 아직 실행하지 못했다.

운영용 `.env.production`은 직접 배포 환경의 비밀 저장소에서 공급한다. 최소 값은 `ENVIRONMENT=production`, `DEMO_MODE=false`, `AUTO_CREATE_SCHEMA=false`, `DATABASE_URL=postgresql+psycopg://...@postgres:5432/yeoun`, `WEB_ORIGIN=https://선택한도메인`, 빈 `EXTRA_ORIGINS`, 실제 OpenAI 키다. 개발 DB 비밀번호를 운영에 사용하지 않는다. Compose 변수의 `POSTGRES_PASSWORD`와 DB URL의 암호를 일치시킨다.

```sh
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d
```

gateway는 호스트의 127.0.0.1:8080에만 바인딩된다. 선택한 도메인의 HTTPS 로드밸런서가 이 주소에 접근하도록 배포 환경에서 연결한다. API와 DB 포트는 외부에 노출하지 않는다. nginx가 직접 클라이언트를 받는 구성을 기준으로 X-Forwarded-For를 덮어쓴다. 별도 LB를 두면 **그 LB의 주소 대역만** nginx real_ip 신뢰 목록에 등록해야 사용자별 요청 제한이 올바르게 작동한다. 임의의 클라이언트 전달 헤더를 그대로 신뢰하지 않는다.

SSE 프록시 버퍼링은 끄고 idle timeout은 180초 이상으로 둔다. API 다중 프로세스보다 워커 수와 DB pool 예산부터 조절한다. 기본 워커는 프로세스당 4개다. 워커를 API 내부와 독립 프로세스에서 동시에 켜도 DB 선점으로 중복 처리하지 않지만 연결 수와 회수 주기를 산정해야 한다.

## 결제 연결

웹: 승인된 Toss 상점의 테스트 키를 서버 `TOSS_SECRET_KEY`, 공개 클라이언트 키를 `TOSS_CLIENT_KEY`로 설정한다. 테스트 결제, 승인 후 응답 유실, 새로고침, 중복 승인, 실패 복귀를 확인하고 상점 운영 키로 전환한다. 실제 모드의 충전은 저장된 계정만 허용한다.

앱: RevenueCat 프로젝트에 App Store/Google Play 앱과 소모성 상품 `yeoun.light.500`, `yeoun.light.1200`을 연결한다. Offering에 두 상품을 포함하고 공개 SDK 키를 앱의 iOS/Android 환경 변수로 설정한다. 서버에 `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_SIGNING_SECRET`, 쉼표로 구분한 `REVENUECAT_APP_IDS`를 설정한다. webhook URL은 `/api/v1/webhooks/revenuecat`, Authorization은 Bearer 값, HMAC 서명은 활성화한다. 개발은 SANDBOX, 운영은 PRODUCTION 이벤트만 받는다. Transfer/구독/가상화폐 기능은 지원 대상으로 켜지 않는다.

## 운영 대응

- 생성 장애: 완료되지 않은 Turn 상태, 마지막 started 시각과 원장 차감/환급을 조회한다. 로그에는 전체 프롬프트, 암호, 키를 남기지 않는다. 생성 180초/대기 600초를 넘은 작업은 회수 대상이며 별도 환급을 수동으로 중복하지 않는다.
- 결제 미충전: payment order ID 또는 스토어 거래 ID로 공급자의 승인 상태와 ledger를 대조한다. 같은 주문 승인 재시도 또는 인증 webhook 재전송을 사용한다. 잔액 숫자를 직접 변경하지 않는다.
- 백업: 관리형 PostgreSQL PITR와 암호화 백업, 일별 복구 확인, 월별 별도 환경 복원 훈련을 배포 담당자가 설정한다. 현재 저장소는 백업 서비스를 생성하지 않았다.
- 관측: 큐 대기 시간, 첫 토큰 시간, 완성률, provider 오류, 환급, 결제 미반영, DB 연결 수를 수집해야 한다. 현재는 구조화할 수 있는 Turn 시각/상태와 오류 유형 로그가 있으며 외부 대시보드와 알림은 연결하지 않았다.
- 데이터 보관: 대화와 SSE 이벤트의 보관 기간, 삭제 요청 처리, 결제 증빙 보관 및 백업 삭제 범위를 정한 뒤 정기 작업을 연결한다. 현재 자동 파기 작업과 계정 삭제 UI는 없다.

## 공개 출시 전 남은 조건

| 조건                                       | 현재 상태                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| OpenAI 프로젝트 키와 실제 대화 평가        | 연결 완료. 합성 회귀와 장기 문맥 실험 완료, 사람의 블라인드 평가/원가 분석 필요                        |
| Toss 상점과 앱 스토어/RevenueCat           | 연결 코드 있음, 외부 계정/상품/심사와 실제 거래 검증 필요                                              |
| 이메일 확인과 비밀번호 재설정              | 미구현. 계정 저장 화면에 제한 표시                                                                     |
| 장기 기억과 서사 품질                      | 최대 30개 사실 + 최근 문맥 + 최대 8개 원문 인용. 100 메시지 합성 실험 완료, 다회차 장기 품질 검증 필요 |
| 데이터 삭제/신고 운영, 정책과 고객지원     | 사용자 응답 의견과 JSON 내보내기는 있음. 운영 조직/처리 과정 미연결                                    |
| 배포 도메인, 클라우드, TLS, 백업, 모니터링 | 구성 파일 있음, 공개 배포 미실행                                                                       |
| 의존성 보안 검토                           | npm audit에서 Expo/Metro 도구 체인의 알려진 전이 의존성 경고 확인. 자세한 내용은 VALIDATION.md         |
| 실기기/접근성/장시간 부하                  | 웹 브라우저 검증과 번들 생성까지. 실제 기기와 출시 규모의 부하 시험 필요                               |

이 목록이 남아 있으므로 현재 결과는 운영을 고려해 구현한 초기 제품이며 공개 상용 운영 완료 상태가 아니다.
