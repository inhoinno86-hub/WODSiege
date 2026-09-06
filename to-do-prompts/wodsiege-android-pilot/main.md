# WODSiege Android 파일럿 실행 프롬프트

## Planning Metadata

- Date: 2026-09-06
- Feature name: wodsiege-android-pilot
- Planning artifact: `to-do-prompts/wodsiege-android-pilot/main.md` (사용자 지정 make-prompts 형식)
- Planning mode: normal Codex
- Superpowers planning: disabled
- Superpowers execution: disabled
- Superpowers brainstorming: not used
- Ouroboros: not used (not requested)
- Notes: 사용자 요청으로 생성 직후 이 패키지를 exec-prompts로 실행한다.

## 요청과 목표

`intent-docs/INTENT-2026-09-06-wodsiege-android-pilot.md`의 목표·방향·내용·완료 기준을 실행한다. 원본 기준은 `docs/PLAN-2026-09-06-wodsiege-product-concept.md`. Android 우선, Galaxy Z Fold7 기준 적응형 화면, 로컬 영속 API와 실제 제출·판정 흐름을 갖춘 개발 파일럿을 만든다.

## 제약·가정

- 기준 브랜치는 `main`, 최초 기준 커밋 `de13d30`. 기존 docs/reports 자료를 보존한다.
- 정책 미정값은 `pilot-v1` 개발 설정이며 실제 운영 승인과 구분한다. 상세 D-01~D-13은 지시서 참조.
- React/TypeScript/Vite/Capacitor Android 및 Node/SQLite. 외부 유료 서비스나 실제 공개는 하지 않는다.
- 앱 이름 WODSiege, 패키지 `app.wodsiege.pilot`. ‘폴더7’은 Galaxy Z Fold7 가정.
- intent는 사용자 요청대로 git 제외한다. 패키지는 다른 환경에서도 범위를 파악할 수 있도록 API 계약·개발 정책 및 상태 문서를 추적한다.
- 실기기·클라우드·push·본인 확인·운영 정책 승인은 외부 조건으로 남기고, 로컬 구현과 검증은 진행한다.

## 단계 맵

| 단계 | 목적 | 입력 | 출력 | 의존 | 완료 기준 |
| --- | --- | --- | --- | --- | --- |
| 01 기반과 계약 | 재현 가능한 개발 환경 | 원본/intent/main | package, 설정, API 계약, 정책 | 없음 | 설치 성공, 계약과 정책 문서 존재, ignore 확인 |
| 02 도메인과 API | W-01~09 서버 구현 | 01 계약 | server 및 테스트 | 01 | 권한·위치·채점·합의·업로드·분쟁·원장·정정 통합 테스트 |
| 03 앱 화면과 연결 | 사용자가 전체 흐름 수행 | 01 계약, 02 API | React 화면·적응형 CSS | 01, 연동 확인은 02 | 빌드 성공, 실 API 조작·실패/빈/대기 표시, 모든 핵심 화면 |
| 04 Android와 검증 | 기기 인수 준비 | 02/03 | Android 프로젝트/APK, E2E, 사용 안내/구현 상태 | 02/03 | 테스트·웹 빌드·APK 빌드 결과 기록, Fold7 수동 항목 구분 |

01 계약을 먼저 확정한다. 02 서버와 03 UI는 계약에 맞춰 독립 영역에서 작성 가능하며 주 에이전트가 통합한다. 04는 실제 결과로 판단한다. 실패는 수정하거나 원인·잔여 범위를 명시하고 조용히 생략하지 않는다.

## 실행 지시

이 디렉터리의 step-01부터 순서대로 읽고 실행한다. API는 인증된 사용자 ID로 역할을 확인하며 개발 계정 전환은 로그인으로만 한다. 위임 시 파일 소유 범위를 지정하고 다른 사람의 변경을 되돌리지 않는다. 생성한 소스와 테스트를 확인한 뒤 완료 판정을 내린다.

## Decision log

- 2026-09-06: 사용자가 지시서 생성→make-prompts→exec-prompts 연속 실행을 명시 승인.
- 2026-09-06: 비용·계정 의존 없는 로컬 서버와 Android 컨테이너 선택. 미정 정책은 개발용 버전으로 분리.

## Progress log

- 2026-09-06: 원본 기획과 저장소 확인, 지시서 및 4단계 패키지 작성.
- 2026-09-06: Step 01 완료. 의존성·API 계약·pilot-v1 정책·ignore 검증 완료.
- 2026-09-06: Step 02 완료. 영속 API/채점/권한/영상/정정 원장 구현, 도메인·API 테스트 14개 통과.
- 2026-09-06: Step 03 완료. 실제 API 연결 한국어 앱 화면과 좁은/넓은 적응형 UI, TypeScript/번들 빌드 통과. frontend-design 적용.
- 2026-09-06: Step 04 로컬 검증 완료. E2E 8개 통과, 최종 `npm run android:build`와 APK 서명 검증 성공. APK 약 8.3MiB. 연결 기기가 없어 Fold7 인수는 미실행이며 공개 정책/실기기 항목과 W별 제약은 `docs/IMPLEMENTATION-STATUS.md`에 별도 기록.
