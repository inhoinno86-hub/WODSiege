# WODSiege

Box를 대표해 같은 WOD로 도전하고, 증빙 기록으로 결과를 확인하는 Android 우선 개발 파일럿입니다. React/TypeScript + Capacitor Android 앱, Node.js + SQLite 로컬 API를 포함합니다.

## 시작하기

Node.js 22.13 이상이 필요합니다. 저장소 루트에서 의존성을 설치한 후 API와 UI를 각각 실행합니다.

```bash
npm ci
npm run server
```

다른 터미널:

```bash
npm run dev
```

브라우저에서 `http://127.0.0.1:5173`에 접속합니다. 최초에는 빈 데이터로 시작합니다. 회원가입으로 운동자 계정을 만들고 Box를 등록하거나 가입 신청하세요. 비밀번호는 10자 이상입니다. API 기본 주소는 `127.0.0.1:8787`이며 화면에서 연결 설정을 변경할 수 있습니다.

## 운영자 계정과 첫 경기

Box 운영 권한 확인과 분쟁 처리는 별도 운영자 계정이 필요합니다. 처음 API를 시작할 때 아래 환경 변수를 설정하면 해당 운영자를 생성합니다. 기존 일반 계정을 자동 승격하지 않으며 같은 운영자가 이미 있으면 비밀번호를 덮어쓰지 않습니다.

```bash
read -r -p '운영자 이메일: ' WODSIEGE_OPERATOR_EMAIL
read -r -s -p '운영자 비밀번호 (10자 이상): ' WODSIEGE_OPERATOR_PASSWORD
export WODSIEGE_OPERATOR_EMAIL WODSIEGE_OPERATOR_PASSWORD
npm run server
```

종료 후 `unset WODSIEGE_OPERATOR_EMAIL WODSIEGE_OPERATOR_PASSWORD`로 현재 셸에서 제거할 수 있습니다. 비밀번호를 소스나 셸 명령문에 직접 기록하지 마세요.

1. 서로 다른 운동자 3명이 Box에 소속 신청하고 관리자가 승인합니다. 각 계정이 Box 현장에서 일회성 위치 확인에 동의합니다.
2. 운영자가 별도 증빙 확인 근거를 입력하여 Box 운영 권한을 승인합니다. 위치 확인만으로 운영 권한이 생기지는 않습니다.
3. 양 Box가 준비되면 방어 Box 관리자가 WOD·구성·시간·장소를 제안합니다. 상대 관리자가 신청하고 방어 관리자가 수락합니다.
4. 양측 관리자가 출전 명단과 조건에 동의하면 조건이 잠깁니다. 경기 일시 이후 시작하고 각 Box가 영상·선수별 기록을 제출합니다.
5. 양측 제출 후 상대 기록을 검토합니다. 검토 마감(경기 후 48시간) 이후 확정하거나, 이의를 제기해 독립 운영자의 판정을 받습니다.
6. 확정 경기의 부문별 순위·원장·Box 포인트를 확인합니다. Box 관리자는 30P로 프로필 실드를 적용할 수 있습니다.

자동 테스트는 **별도 임시 DB와 테스트 시계**를 사용하므로 48시간을 기다리지 않고 전체 흐름을 검증합니다. 운영 서버에는 시간 변경이나 자동 승인용 테스트 엔드포인트가 없습니다.

## Android APK

```bash
npm run android:build
```

빌드 결과: `android/app/build/outputs/apk/debug/app-debug.apk`.

JDK/SDK 준비, Fold7 설치, USB 포트 연결은 [Android 실행 안내](docs/ANDROID-TESTING.md)를 참고하세요. API는 APK 안에 내장되어 있지 않으므로 PC 서버를 실행하고 `adb reverse tcp:8787 tcp:8787`로 연결해야 합니다. 네이티브 기본 API 주소는 `http://localhost:8787`입니다. debug에서만 loopback HTTP를 허용합니다.

## 검증

```bash
npm test
npm run build
npm run test:e2e
```

브라우저 테스트는 기본 `/usr/bin/google-chrome`을 사용합니다. 다른 Chromium 경로는 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`로 지정합니다. 4173 포트를 비워 두세요. 테스트 결과·스크린샷은 `test-results/`, HTML 리포트는 `playwright-report/`에 생성됩니다. `npm test`는 권한·GPS·채점·영상·분쟁·멱등 처리·정정·영속성을, E2E는 실제 UI와 API 연결 및 화면 크기 변경을 검증합니다.

## 문서와 작업 패키지

- [실기기 검증 및 사용자 작업 가이드](docs/USER-DEVICE-AND-LAUNCH-GUIDE.md): USB 설치부터 수동 검사, 운영·배포 준비와 결과 기록까지 단계별 체크리스트.
- [모델·추론 수준 배정 이력 HTML](reports/wodsiege-agent-allocation-history.html): 작업별 생성 설정과 실행 컨텍스트 대조, 산출물·검토 효과·확인 한계.
- [제품 개념 기획안](docs/PLAN-2026-09-06-wodsiege-product-concept.md)
- [작업 지시서](intent-docs/INTENT-2026-09-06-wodsiege-android-pilot.md): 사용자 요청에 따라 `intent-docs/`는 Git에서 제외되어 로컬에만 존재합니다.
- [make-prompts 실행 패키지](to-do-prompts/wodsiege-android-pilot/main.md): main과 4개 step. exec-prompts로 이어서 구현합니다.
- [API 계약](docs/API.md), [개발용 정책](docs/PILOT-POLICY.md), [구현·검증 상태](docs/IMPLEMENTATION-STATUS.md)
- [고등학생용 앱 설명서 HTML](reports/wodsiege-app-guide.html)
- [후속 준비 작업 현황](docs/READINESS-STATUS.md), [운영·개인정보 승인 준비서](docs/PILOT-OPERATIONS.md)
- [읽기 전용 Android 사전 점검](docs/ANDROID-PREFLIGHT.md), [백업·새 경로 복구](docs/BACKUP-RESTORE.md), [HTTPS 배포 준비](docs/DEPLOYMENT.md)
- [운영자 비밀번호 변경](docs/OPERATOR-PASSWORD.md): 오프라인 변경, 기존 운영자 세션 무효화, 기본 dry-run.

## 기기·복구·외부 운영 준비

```bash
npm run android:preflight
```

기기 연결·권한·로컬 APK를 확인하는 읽기 전용 검사입니다. 기기가 없으면 `BLOCKED_NO_DEVICE`와 0이 아닌 종료 코드를 반환합니다. 설치·실행·USB 포트 연결·위치 수집은 하지 않으며 실제 접힘/GPS/영상 검사를 대신하지 않습니다.

백업/복원은 명시한 경로에 대해서만 실행하며 기본은 dry-run입니다. 실제 쓰기에는 서버 중지 확인과 `--execute --server-stopped`가 모두 필요합니다. 복원은 기존 경로를 덮어쓰지 않고 **새 경로**에만 생성하며 로그인 세션을 무효화합니다. 명령과 제한은 [복구 안내](docs/BACKUP-RESTORE.md)를 먼저 읽으세요. 원본 데이터 삭제나 자동 운영 전환은 하지 않습니다.

`deploy/`에 HTTPS 프록시와 비공개 API 컨테이너 설정을 준비했습니다. 실제 도메인·서버·비용·공개 범위 승인, secret 파일, 운영 정책이 필요하며 설정 파일 생성은 실제 배포 완료가 아닙니다. 개발용 로컬 실행 기본값은 유지합니다. production 설정은 HTTPS origin·비밀 파일·절대 데이터 경로를 검사하며, 허용되지 않은 Origin 요청은 변경 처리 전에 거부합니다.

## 데이터와 현재 범위

계정·경기·원장은 `data/wodsiege.sqlite`, 비공개 증빙 영상은 `data/uploads/`에 보관합니다. `WODSIEGE_DATA_DIR`로 별도 경로를 지정할 수 있습니다. `data/`, 환경 변수 파일, 빌드 결과 및 로컬 도구는 Git에서 제외합니다. 로그인 세션은 24시간이며 클라이언트는 sessionStorage를 사용하므로 앱 프로세스가 종료되면 다시 로그인해야 할 수 있습니다. 경기 생성 초안은 기기에 저장하며 비밀번호·영상은 초안에 저장하지 않습니다. 폰트는 앱에 포함되어 외부 폰트 서비스 연결이 필요하지 않습니다.

운영 정책 `pilot-v1`의 GPS 수치·팀 구성·채점·Elo·보상은 개발용 가정입니다. 실제 Box 파일럿 공개 전 정책 확정, 개인정보·영상 보관/삭제, 본인 확인, HTTPS 서버·백업, 기기 인수, 배포 서명이 필요합니다. OS push·AI 판정·결제·공개 배포는 포함하지 않습니다. 실기기 검증과 자동 테스트의 실행 여부는 구현 상태 문서에서 구분합니다.
