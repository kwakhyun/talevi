# 테일비 오리지널 이미지

## 향후 제작 기준

2026-10-09 사용자 요청에 따라 여성 캐릭터의 보이시한 숏컷, 근육질 체형, 어두운 피부는 각각 명시적으로 요청받은 경우에만 적용한다. 반실사와 애니메이션 모두에 해당한다. 아래 자산과 기존 프롬프트는 제작 이력이며, 새 제작에는 [프로젝트 작업 기준](../AGENTS.md)을 적용한다.

## 2026-10-09 추가 남성 캐릭터

신규 남성 10명을 추가해 전체 카탈로그는 30명(남성 15명, 여성 15명)이 됐다. 신규 인물은 모두 19~25세 성인이다. 반실사 5명과 애니메이션 5명으로 나눴으며 각 이미지를 기본 내장 Imagegen으로 개별 생성했다.

| 인물 | 나이 | 그림체 | 성격과 역할 | 저장 파일 |
| --- | --- | --- | --- | --- |
| 윤태오 | 25 | 반실사 | 야생미, 과묵, 츤데레 / 바다가 잠잠해질 때까지 곁을 지키는 선박 정비사 | [taeo.png](../apps/web/public/characters/taeo.png) |
| 이은호 | 19 | 애니메이션 | 대형견, 쾌활, 장난꾸러기 / 길을 잘못 들고 당신을 만난 배달 라이더 | [eunho.png](../apps/web/public/characters/eunho.png) |
| 차도윤 | 25 | 반실사 | 냉미남, 지적, 의외의 다정함 / 완벽한 도면에 당신의 자리를 남겨 둔 건축가 | [doyun.png](../apps/web/public/characters/doyun.png) |
| 하유준 | 23 | 반실사 | 온미남, 다정, 느긋함 / 당신의 아침을 조금 일찍 굽는 제빵사 | [yujun.png](../apps/web/public/characters/yujun.png) |
| 류시혁 | 24 | 애니메이션 | 퇴폐미, 까칠, 솔직함 / 앙코르가 끝나도 당신 앞에서 떠나지 못하는 베이시스트 | [sihyeok.png](../apps/web/public/characters/sihyeok.png) |
| 백이결 | 22 | 애니메이션 | 기사도, 과묵, 헌신 / 당신의 걸음에 맞춰 검을 내리는 호위무사 | [igyeol.png](../apps/web/public/characters/igyeol.png) |
| 강로한 | 24 | 반실사 | 마초, 쾌활, 다정 / 긴 하루 뒤에 당신의 안부를 먼저 묻는 소방관 | [rohan.png](../apps/web/public/characters/rohan.png) |
| 노시우 | 20 | 애니메이션 | 미소년, 댕댕이, 낯가림 / 당신의 칭찬 한마디에 웃어 버리는 의상 제작자 | [siu.png](../apps/web/public/characters/siu.png) |
| 서유찬 | 23 | 반실사 | 계략남, 온미남, 여유 / 다음 수보다 당신의 대답이 궁금한 체스 선수 | [yuchan.png](../apps/web/public/characters/yuchan.png) |
| 아스텔 | 25 | 애니메이션 | 세계관 최강자, 장난꾸러기, 리더 / 지도를 벗어난 하늘로 당신을 초대하는 선장 | [astel.png](../apps/web/public/characters/astel.png) |

모든 이미지는 1024×1536 PNG다. 얼굴형, 피부 톤, 헤어 길이와 질감, 체격, 의상과 배경을 나눠 설계했다. 하유준과 강로한의 초안에서 곱슬머리 실루엣이 비슷해 보이는 점을 확인해, 로한은 이마가 드러나는 아주 짧은 곱슬머리로 같은 도구에서 한 번 수정했다. 모든 최종 이미지를 직접 시각 검토했다. 실제 사용자 대상 식별률 평가는 수행하지 않았다.

[생성 프롬프트와 수정 지시](character-prompts-men-2026-10-09.json)를 보관했다. CLI/API fallback은 사용하지 않았다. [catalog.py](../apps/api/yeoun/catalog.py)에 말투, 세계관, 첫 대사, 비밀과 시작 질문 3개를 각각 등록했다. 웹 카탈로그와 React Native 번들에서 동일한 최종 이미지를 사용한다.

## 2026-10-09 추가 여성 캐릭터

기본 내장 Imagegen으로 여성 10명을 개별 생성하고 웹 및 React Native의 실제 카탈로그에 추가했다. 모두 1024×1536 PNG다. 반실사 5명, 애니메이션 5명이며 모두 19~25세 성인으로 설정했다. 이 여성 캐릭터를 추가한 시점의 전체 카탈로그는 기존 10명을 포함해 20명이었다.

| 인물 | 나이 | 그림체 | 성격과 이야기 | 저장 파일 |
| --- | --- | --- | --- | --- |
| 채아린 | 21 | 반실사 | 청순하고 다정한 초보 플로리스트 | [arin.png](../apps/web/public/characters/arin.png) |
| 백나리 | 19 | 애니메이션 | 귀엽고 쾌활한 편지 마녀 | [nari.png](../apps/web/public/characters/nari.png) |
| 오리나 | 23 | 반실사 | 성숙하고 여유로운 재즈 보컬 | [rina.png](../apps/web/public/characters/rina.png) |
| 유지우 | 20 | 애니메이션 | 장난기와 승부욕이 있는 파티시에 | [jiwoo.png](../apps/web/public/characters/jiwoo.png) |
| 신소율 | 22 | 반실사 | 청초하고 조심스러운 피아니스트 | [soyul.png](../apps/web/public/characters/soyul.png) |
| 엘리세 | 24 | 애니메이션 | 우아한 쿨뷰티, 정원의 마법사 | [elise.png](../apps/web/public/characters/elise.png) |
| 홍채린 | 25 | 반실사 | 도도하고 매혹적인 조향사 | [chaerin.png](../apps/web/public/characters/chaerin.png) |
| 남루미 | 21 | 애니메이션 | 호기심 많고 엉뚱한 사서 | [rumi.png](../apps/web/public/characters/rumi.png) |
| 이다은 | 22 | 반실사 | 밝고 청순한 여행 사진가 | [daeun.png](../apps/web/public/characters/daeun.png) |
| 세레나 | 25 | 애니메이션 | 장난스러운 매력 뒤에 외로움을 숨긴 뱀파이어 | [serena.png](../apps/web/public/characters/serena.png) |

캐릭터별 말투, 세계관, 비밀, 첫 대사, 대화 시작 선택지와 외형을 [catalog.py](../apps/api/yeoun/catalog.py)에 함께 등록했다. 프롬프트와 수정 지시는 [character-prompts-2026-10-09.json](character-prompts-2026-10-09.json)에 기록했다. 오리나와 홍채린은 단정한 의상으로 수정한 프롬프트를 사용했고, 유지우는 애니메이션 선화와 셀 채색이 더 명확하도록 이미지 편집을 한 번 진행했다. 모든 최종 이미지를 시각 검토하고 프로젝트 공개 자산 경로에 복사했다. 생성 CLI/API fallback은 사용하지 않았다.

## 2026-10-08 기존 자산 이력

10개 이미지는 기본 내장 Imagegen 도구로 개별 생성했다. 모두 1024×1536 PNG이며 웹과 React Native에서 같은 자산을 사용한다. 서지한과 카이렌은 1차 결과의 실사 느낌을 줄이기 위해 같은 도구로 2D 선화와 셀 채색을 적용해 수정했다.

| 인물 | 성별 | 그림체 | 저장 파일 |
| --- | --- | --- | --- |
| 윤세아 | 여성 | 반실사 | [seah.png](../apps/web/public/characters/seah.png) |
| 강시온 | 남성 | 애니메이션 | [sion.png](../apps/web/public/characters/sion.png) |
| 차유라 | 여성 | 반실사 | [yura.png](../apps/web/public/characters/yura.png) |
| 서지한 | 남성 | 애니메이션 | [jihan.png](../apps/web/public/characters/jihan.png) |
| 민하루 | 여성 | 애니메이션 | [haru.png](../apps/web/public/characters/haru.png) |
| 권도건 | 남성 | 반실사 | [dogeon.png](../apps/web/public/characters/dogeon.png) |
| 한서윤 | 여성 | 반실사 | [seoyun.png](../apps/web/public/characters/seoyun.png) |
| 카이렌 | 남성 | 애니메이션 | [kairen.png](../apps/web/public/characters/kairen.png) |
| 류이안 | 여성 | 애니메이션 | [ian.png](../apps/web/public/characters/ian.png) |
| 이도하 | 남성 | 반실사 | [doha.png](../apps/web/public/characters/doha.png) |

최종 프롬프트와 수정 지시는 [character-prompts.json](character-prompts.json)에 저장했다. 생성 CLI/API fallback은 사용하지 않았다. 원본은 도구의 기본 저장소에 유지하고 프로젝트에서 사용하는 파일은 위 경로에 복사했다. 이전 캐릭터 이미지 4개는 공개 경로에서 제거했다.

모든 결과를 직접 시각 검토했다. 외부 서비스의 캐릭터 이미지나 기존 IP는 사용하지 않았다. 얼굴형, 피부, 체격, 헤어스타일, 표정, 의상과 배경을 여러 축으로 바꿨다. 지각적인 외모 차이를 정량적으로 검증한 사용자 연구나 권리 심사를 수행했다는 의미는 아니다.
