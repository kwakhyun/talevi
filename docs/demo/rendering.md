# 로컬 시연 영상 렌더링

`scripts/render_demo.py`는 실제 앱에서 캡처한 PNG 또는 MP4와 내레이션 음성을 편집한다. 앱을 조작하거나 화면을 캡처하지 않으며, 외부 서비스나 AI API를 호출하지 않는다. 소개와 기술 설명 장면만 Pillow로 만든다.

Python 3.10 이상, Pillow, ffmpeg와 ffprobe가 필요하다. macOS의 Apple SD Gothic Neo를 기본 지원하며, Noto Sans KR 또는 Noto Sans CJK가 있으면 우선 사용한다. 다른 환경에서는 `--font`로 한글 글꼴을 지정한다.

```sh
python3 scripts/render_demo.py .local/video-capture/manifest.json \
  --output .local/video-capture/talevi-demo.mp4 \
  --work-dir .local/video-capture/render \
  --validate-only

python3 scripts/render_demo.py .local/video-capture/manifest.json \
  --output .local/video-capture/talevi-demo.mp4 \
  --work-dir .local/video-capture/render
```

## Manifest

경로는 manifest 파일 위치를 기준으로 해석한다. 절대 경로도 가능하다. `scenes`의 순서가 영상 순서이며, 전체 길이는 장면 길이를 모두 더한 값이다. 150초 정도로 구성하면 2분 30초 영상이 된다.

```json
{
  "title": "테일비 — 기억과 관계가 이어지는 대화",
  "brand": "talevi",
  "fps": 30,
  "crf": 22,
  "transition": 0.28,
  "scenes": [
    {
      "id": "intro",
      "title": "기억과 관계가 이어지는 대화",
      "kicker": "TALEVI / LOCAL PRODUCT DEMO",
      "body": ["서로 다른 말투와 성격의 캐릭터", "기억, 관계, 이야기 상태를 함께 복원하는 분기"],
      "duration": 8,
      "narration_audio": "audio/01-intro.wav",
      "shots": [],
      "subtitles": [
        {"start": 0.3, "end": 6.8, "text": "테일비는 기억과 관계가 이어지는 AI 캐릭터 채팅 서비스입니다."}
      ]
    },
    {
      "id": "conversation",
      "title": "캐릭터의 성격이 드러나는 첫 대화",
      "kicker": "실제 로컬 앱 화면",
      "duration": 18,
      "narration_audio": "audio/02-conversation.wav",
      "shots": [
        {"path": "captures/catalog.png", "duration": 5},
        {"path": "captures/response.mp4", "duration": 13, "speed": 1}
      ],
      "subtitles": [
        {"start": 0.4, "end": 5.0, "text": "캐릭터마다 말투와 관계의 출발점이 다릅니다."},
        {"start": 5.0, "end": 15.5, "text": "답변이 생성되는 과정과 대화 이후의 상태를 실제 화면으로 확인합니다."}
      ]
    }
  ]
}
```

### 필드와 시간 규칙

- `scene.id`, `title`, `kicker`: 장면 식별자와 제목. 제목은 영상 상단에, `kicker`는 설명 카드에 표시한다. `shots`가 없으면 `title`, `kicker`, `body`로 카드를 만든다. `body`는 문자열 또는 문자열 배열이다.
- `scene.duration`: 선택 사항. 생략하면 쇼트 길이, 음성 길이, 자막 종료 시각을 모두 수용하도록 계산한다. 음성보다 짧게 지정하면 음성을 자르지 않고 오류로 알린다. 길이는 30 fps 프레임 경계로 올림한다.
- `narration_audio`: 선택 사항. 음성은 장면 시작 시 재생한다. 음성이 먼저 끝나면 남은 구간은 무음이다. 입력 클립의 원래 소리는 사용하지 않는다.
- `shots[].path`: 실제 캡처 이미지 또는 영상. PNG, JPEG, WebP는 정지 이미지로 처리한다. 이미지를 왜곡하거나 가짜 UI를 만들지 않는다. 기본값은 고정 화면이다.
- `shots[].duration`: 지정한 길이 동안 보여준다. 생략한 쇼트는 남은 장면 시간을 균등하게 사용한다. 모든 쇼트에 길이가 있고 합이 장면보다 짧으면 마지막 화면을 연장한다. 합이 장면보다 길면 오류다.
- `shots[].speed`: 클립 재생 속도. 기본값 `1`은 실시간이다. `2`이면 두 배 속도다. 빠르게 보여준 구간은 자막이나 설명에 배속 여부를 밝혀야 한다. 클립이 먼저 끝나면 마지막 프레임을 유지한다.
- `shots[].focus`: 원본 픽셀 기준 `[x, y, width, height]`. 선택 영역을 자른 후 비율을 유지하여 화면 안에 배치한다. 원본을 벗어나면 오류다. 별도 표시 없이 화면 요소를 조작하는 용도로 사용하지 않는다.
- `subtitles`: 장면 시작을 0초로 하는 자막 배열. 시간순으로 작성하며 구간이 겹치면 오류다. 긴 자막은 최대 두 줄로 줄바꿈하고, 가독성을 확보할 수 없을 정도로 길면 오류로 알린다.
- `transition`: 장면 시작과 끝의 짧은 페이드 길이. 기본 `0.28`초. 장면 내부에서 적용하므로 총길이와 음성 시작 시각은 변하지 않는다. `0`이면 페이드를 끈다.
- `brand_mark`: 선택 사항인 로고 PNG 경로. 생략하면 저장소의 테일비 아이콘을 사용한다.

## 출력과 검수

출력은 1920×1080, 30 fps, H.264, AAC 48 kHz 스테레오 MP4다. `faststart`를 적용한다. 원본 1280×720 화면은 비율을 유지해 1536×864 영역에 배치한다. 왼쪽 192, 위쪽 88 픽셀부터 실제 화면을 표시하고, 챕터 제목과 자막은 그 영역 바깥에 놓는다.

기본 인코딩은 `medium`, CRF 22이며 `--crf 23`으로 용량을 줄일 수 있다. 100 MB 초과 시 안내만 출력하며 원본을 자동으로 덮어쓰거나 품질을 추가로 낮추지 않는다. 작업 폴더에는 장면별 MP4와 자막 PNG가 남고, 최종 MP4 옆에 길이와 코덱을 기록한 `.render.json`이 만들어진다.

게시 전에는 첫 장면, 실제 대화, 기억 수정, 분기와 마지막 장면을 직접 재생하여 확인한다. 비밀 키, 쿠키, 개인 대화와 개발자 도구가 노출되지 않았는지 확인하고, 실제 모델 응답과 고정 응답 테스트를 혼동하게 편집하지 않는다. 자막이 말보다 앞서거나 화면 전환 후 이전 기능을 설명하지 않는지도 확인한다.
