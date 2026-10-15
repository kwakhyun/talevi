# 공개 저장소와 포트폴리오 운영

변경일: 2026-10-15. 전체 구현과 채용 검토 자료를 **공개 `kwakhyun/talevi`**에 통합한다. 기본 브랜치는 `main`이며, 공개 서비스 배포와 상용 결제 개통은 계속 보류한다. 저장소 공개와 서비스 호스팅은 별개의 결정이다.

## 하나의 원본

소스, 캐릭터와 프롬프트, 로컬 시연 영상, 기술 설명, 자동 검사와 과거 유료 모델 평가 원문을 같은 저장소에서 관리한다. 지원서에는 [원본 저장소](https://github.com/kwakhyun/talevi)를 공유한다.

기존 [talevi-portfolio](https://github.com/kwakhyun/talevi-portfolio)는 원본으로 이동했다는 README를 남기고 아카이브한다. 과거 소개 자료와 평가 요약을 삭제하지 않으며, 기존 지원서 링크도 유지한다. 별도 소개 문서를 다시 내보내는 `export_portfolio.py`는 종료 안내만 표시한다.

## 검증 자료 보존

[유료 모델 평가 색인](MODEL-EVALUATION-ARCHIVE.md)은 초기 비교부터 최종 v11까지 연결한다. 최종 v11의 1,256건은 완료된 평가 응답 수이며, 모든 시기의 유료 호출 총합이나 청구 건수가 아니다. 초안 보완, 압축, moderation, 실패와 재시도는 응답 수와 구분한다.

공개 준비 중 기존 증거 126개를 모두 유지했다. 그중 123개는 원본과 바이트 단위로 같고, 로그 3개는 로컬 경로만 치환했다. 원본 로그의 오류와 중단 기록을 남겼으며, [파일별 전후 해시](publication-evidence-preservation.json)와 [커밋 대응](HISTORY-REWRITE-2026-10-15.md)을 제공한다. 새 모델 호출은 하지 않았다.

## 제외할 자료와 이력 관리

비밀 환경 파일, 토큰, 실제 사용자 DB, 로컬 백업과 설치된 의존성은 추적하지 않는다. 공개 전 정리하지 않은 Git bundle과 Actions 원본 로그는 Git에서 제외된 로컬 백업에만 보관한다.

이력 정리 전 체크아웃이 있다면 새로 clone하는 것을 권한다. 이전 브랜치를 새 `main`에 merge하거나 오래된 bundle을 공개 원격으로 push하면 제거한 경로가 다시 들어갈 수 있다. 새 평가도 현재 원본을 덮어쓰지 않고 별도 출력 경로에 기록한 뒤 공개 여부를 검토한다.

공개 준비 시 Gitleaks로 원격에 게시할 이력을 검사하고, 모든 Git 객체에서 로컬 경로와 현재 환경의 비밀값 일치를 별도로 검사했다. 이는 모든 민감정보의 부재를 보증하는 감사가 아니다. GitHub의 캐시와 이미 복제한 사본까지 이력 재작성으로 삭제되지는 않는다. [GitHub 이력 정리 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)

## 권리 안내

[RIGHTS.md](../RIGHTS.md)를 적용하는 **소스 공개 포트폴리오**다. 공개 전환만으로 MIT 등 오픈소스 라이선스를 부여하지 않는다. 채용 검토용 실행과 테스트를 허용하지만 서비스 재배포나 재판매를 허용하는 것은 아니다. 제3자 패키지의 라이선스와 AI 생성 자산의 권리 범위를 별도로 존중한다.

공개 저장소의 열람과 포크를 기술적으로 막을 수는 없으며, 나중에 비공개로 바꿔도 이미 내려받은 사본을 회수할 수 없다. [GitHub 라이선스 안내](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
