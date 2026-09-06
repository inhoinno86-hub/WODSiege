# WODSiege Fold7 실기기 자동 인수 가이드

이 문서는 `USER-DEVICE-AND-LAUNCH-GUIDE.md`의 실기기 절차를 가능한 범위에서 자동화하기 위한 실행 안내다. 기존 `scripts/android-preflight.mjs`는 **읽기 전용 사전 점검**으로 유지하고, `scripts/device-acceptance.mjs`가 그 위에서 설치·실행·수명주기·연결 장애·증거 수집·사용자 체크포인트·결과 보고서를 담당한다.

## 1. 설계 원칙

- `android:preflight`는 기존 의미를 바꾸지 않는다. 설치·실행·로그 수집을 하지 않는다.
- 실기기 자동 인수는 `npm run android:acceptance`로 시작한다.
- 기계적으로 확인 가능한 절차와 사용자의 물리/시각 확인을 구분한다.
- 실제 USB 분리와 `adb reverse` 제거를 동일한 시험으로 취급하지 않는다.
- 실제 GPS 검증을 mock/injected 좌표로 대체하지 않는다.
- +48시간 일반 경기 확정은 실제 시간이 경과한 후 `--phase day2 --resume ...`로 재개한다.
- 원시 serial, token, password 등은 보고서에 기록하지 않는다. evidence 디렉터리도 외부 공유 전 검토한다.

## 2. 준비

Fold7에서 개발자 옵션과 USB 디버깅을 켜고 데이터 전송 가능한 케이블로 PC에 연결한다. 휴대전화가 잠금 해제된 상태에서 RSA 디버깅 허용을 완료한다.

저장소 루트에서 의존성과 APK가 준비되어 있어야 한다.

```bash
npm ci
npm run android:build
```

APK가 이미 최신이라면 빌드를 다시 하지 않아도 된다. Runner에 `--build`를 주면 시작 시 Android 빌드를 다시 수행한다.

## 3. DAY-0 실행

연결 기기가 하나라면:

```bash
npm run android:acceptance
```

APK를 다시 빌드한 뒤 시작하려면:

```bash
npm run android:acceptance -- --build
```

여러 ADB 기기가 연결되어 있다면 명시적으로 선택한다.

```bash
npm run android:acceptance -- --serial <SERIAL>
```

Runner는 다음을 자동 수행한다.

1. APK 존재 확인 및 필요 시 build
2. ADB ready device 선택
3. 기존 read-only `android-preflight` 수행
4. 비식별화된 preflight 결과 저장
5. 격리된 시험 data directory로 pilot server 시작
6. `/api/health` 확인
7. `adb reverse tcp:8787 tcp:8787`
8. debug APK 설치
9. `app.wodsiege.pilot/.MainActivity` 실행
10. 시작 직후 screenshot/UI hierarchy/logcat evidence 수집
11. Home → resume 수명주기 검사
12. force-stop → relaunch 검사
13. `adb reverse` 제거로 software-level API 단절 유도
14. 단절 시 evidence 수집
15. `adb reverse` 복구
16. Human Checkpoint 순차 실행
17. 각 Checkpoint 직후 evidence 수집
18. `state.json` 및 `report.md` 갱신
19. 종료 시 reverse 제거 및 Runner가 시작한 server 정상 종료

## 4. Human Checkpoint

각 단계에서 사용자는 아래 중 하나를 입력한다.

- `p`: PASS
- `f`: FAIL — 실패 사유/재현 정보 입력
- `s`: SKIP — 미실행 사유 입력

현재 DAY-0 체크포인트는 다음과 같다.

| ID | 사용자 확인 |
| --- | --- |
| H01 | Fold7 커버 화면에서 주요 메뉴·버튼·목록 |
| H02 | 펼친 화면과 접기/펼치기 후 작성 중 상태 유지 |
| H03 | 회전·분할 화면·키보드·큰 글꼴·시스템 영역 |
| H04 | 실제 Box 위치에서 정밀/대략/거절/재허용 GPS 흐름 |
| H05 | MP4/WebM 선택·업로드·권한별 재생·실패 복구 |
| H06 | **실제 USB 케이블 분리/재연결** 후 오류 및 복구 |
| H07 | 개인전·한 장소 경기의 생성부터 검토까지 |
| H08 | 분쟁·독립 운영자 판정·정정·중복 반영 방지 |
| H09 | 3인 팀전·각 Box 전체 흐름 |

H06은 software-level API interruption과 별도다. 실제 케이블을 분리했다가 재연결한 뒤 ADB가 다시 `device` 상태인지 확인하고, 필요하면 다음 명령으로 reverse를 복구한다.

```bash
adb reverse tcp:8787 tcp:8787
```

실제 USB 단절 후 Runner의 다음 evidence 수집이 실패한 경우 그 경고 자체도 결과에 남는다. 재검사 전에 ADB와 reverse를 복구한다.

## 5. 기존 서버를 재사용하는 경우

8787 포트에서 이미 의도한 pilot server가 실행 중이고 데이터 경로를 유지해야 하는 특별한 경우에만 사용한다.

```bash
npm run android:acceptance -- --reuse-server
```

기본 동작은 기존 8787 pilot server가 있으면 충돌로 차단한다. 잘못된 데이터셋을 검사하는 것을 막기 위함이다.

## 6. 비대화식 준비 검사

사용자 입력 없이 자동 준비 단계와 evidence 수집 가능 여부만 확인하려면:

```bash
npm run android:acceptance -- --non-interactive
```

Human Checkpoint는 `PENDING`으로 기록된다. **이 결과는 실기기 인수 PASS가 아니다.**

## 7. 결과와 evidence

기본 결과 경로 예시는 다음과 같다.

```text
artifacts/
└── fold7-20260906T130000Z/
    ├── preflight.json
    ├── state.json
    ├── report.md
    └── evidence/
        ├── A01-launch.png
        ├── A01-launch.xml
        ├── A01-launch.logcat.txt
        ├── A02-api-disconnected.*
        └── H01 ... H09 evidence
```

`report.md`에는 automated step과 Human Checkpoint의 `PASS / FAIL / SKIP / PENDING`이 구분되어 기록된다.

원시 ADB serial은 보고서에 그대로 남기지 않는다. logcat에는 인증정보가 포함될 가능성이 있으므로 Runner가 기본적인 credential pattern과 serial을 redaction하지만, 외부 공유 전 사람의 검토가 필요하다. GPS 원시 좌표나 개인 영상도 공개 evidence로 사용하지 않는다.

## 8. +48시간 DAY-2 재개

DAY-0에서 개인전 일반 경기 흐름(H07)을 PASS로 기록한 run만 DAY-2 후보가 된다. 실제 예정 시각 +48시간이 경과한 후 같은 run을 재개한다.

```bash
npm run android:acceptance -- \
  --phase day2 \
  --resume artifacts/fold7-<RUN-ID>
```

DAY-2에서는 H10으로 일반 경기 확정 후 순위·원장·포인트 일치를 확인한다.

PC/휴대전화 시각 변경 또는 DB 직접 편집으로 +48시간 조건을 우회하지 않는다.

## 9. 자동화 범위의 현재 한계

현재 1차 Runner는 ADB orchestration과 evidence/report 자동화에 집중한다. 다음은 아직 사람의 명시적 판정이다.

- 물리적인 Fold / Unfold
- 실제 현장 GPS 품질과 Box 반경 판정
- 실제 USB 물리 분리
- 영상의 실제 재생 품질
- 경기 UI의 의미적 상태와 운영 의도 일치
- +48시간 이후 최종 확정

이 항목들은 이후 실기기 1차 결과를 바탕으로 UiAutomator/Maestro/Appium 등 UI automation을 추가할지 결정한다. UI 자동화를 추가하더라도 실제 GPS·물리 접힘·물리 USB와 같은 acceptance evidence를 자동 simulation 결과로 대체해서는 안 된다.

## 10. 권장 실행 순서

```bash
npm test
npm run test:e2e
npm run android:build
npm run android:preflight
npm run android:acceptance
```

실제 Fold7 결과를 `artifacts/`에 보관하고 실패를 수정한 뒤 같은 항목을 재검사한다. 자동 테스트 통과와 실기기 인수 통과는 별도 상태로 관리한다.
