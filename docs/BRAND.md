# 테일비 대표 로고

2026-10-09 적용. ‘이야기가 대화가 되는 순간’을 펼쳐진 책의 두 페이지로 표현했다. 오른쪽 페이지의 끝은 아래로 이어지는 말풍선 꼬리다. 두 페이지 사이의 여백은 작은 크기에서도 형태가 붙지 않게 유지한다. 기성 아이콘이나 외부 로고를 사용하지 않고 베지어 곡선으로 직접 설계했다.

## 형태와 색상

- 128 단위 그리드, 페이지 사이 8 단위 여백. 작은 크기에 불필요한 장식과 텍스트를 넣지 않는다.
- 대표 아이콘: 코럴 그라데이션 `#FF96A6 → #FF718E → #EE4F78`, 아이보리 심볼 `#FFF8F4`.
- 단색 심볼: 코럴 `#FF718E`, 어두운 배경용 아이보리 버전 별도 제공.
- 워드마크는 기존 `talevi.`를 유지하고 아이콘을 왼쪽에 배치한다. 웹 30~36px, React Native 32px로 표시한다.
- 아이콘 최소 권장 크기 24px. 브라우저용 32px PNG도 제공하며 16px까지 축소되는 파비콘은 SVG를 우선한다.
- 아이콘 옆에 이름이 있을 때 이미지는 장식 요소로 취급하고 홈 링크에 ‘테일비 홈’ 접근성 이름을 제공한다.

## 파일과 적용 위치

| 용도 | 파일 |
| --- | --- |
| 대표 벡터 아이콘 | [talevi-icon.svg](../apps/web/public/brand/talevi-icon.svg) |
| 코럴 단색 심볼 | [talevi-mark.svg](../apps/web/public/brand/talevi-mark.svg) |
| 아이보리 단색 심볼 | [talevi-mark-white.svg](../apps/web/public/brand/talevi-mark-white.svg) |
| 32/180/192/512/1024px PNG | `apps/web/public/brand/talevi-icon-{size}.png` |
| iOS 및 Expo 앱 아이콘 | [icon.png](../apps/mobile/assets/icon.png) |
| Android 적응형 전경 | [adaptive-icon.png](../apps/mobile/assets/adaptive-icon.png) |
| Android 테마 아이콘 | [monochrome-icon.png](../apps/mobile/assets/monochrome-icon.png) |

웹 데스크톱 사이드바, 모바일 헤더, 결제 완료 화면, favicon, Apple touch icon과 웹 manifest에 연결했다. React Native 헤더와 Expo 앱 설정에서도 같은 심볼을 사용한다. iOS 원본은 투명 영역 없는 1024px 정사각형이며 Android 전경과 단색 레이어는 중앙 안전 영역에 맞췄다.

벡터 원본과 모든 파생 파일은 [build-brand.mjs](../scripts/build-brand.mjs)의 단일 도형 정의로 관리한다. `node scripts/build-brand.mjs`로 재생성한다. 이 로고는 코드로 제작한 벡터이며 이미지 생성 도구를 사용한 캐릭터와 별개다.
