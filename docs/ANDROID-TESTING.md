# Android 파일럿 빌드와 Galaxy Z Fold7 인수

WODSiege 개발 APK의 패키지는 `app.wodsiege.pilot`이다. Android 7(API 24) 이상을 지원하는 Capacitor 8 컨테이너이며 compile/target SDK는 36이다. 사용자가 말한 ‘삼성 폴더7’은 Galaxy Z Fold7로 해석했다. 실제 단말 모델·OS·WebView 버전은 아래 수동 인수 시 기록한다.

## 개발 환경과 APK

Node 22.13 이상, JDK 21, Android SDK `platforms;android-36`, `build-tools;35.0.0`, `platform-tools`가 필요하다. 프로젝트에 설치한 도구는 `.tools/`에 있고 git에서 제외된다. 기존 Android Studio SDK를 사용하려면 `ANDROID_HOME`, 기존 JDK를 사용하려면 `JAVA_HOME`을 지정한다. 빌드 도우미는 값이 없을 때 프로젝트의 `.tools/jdk-21`, `.tools/android-sdk`를 찾는다.

저장소 루트에서:

```bash
npm ci
npm run android:build
```

이 명령은 TypeScript/웹 빌드 → Capacitor 동기화 → Gradle debug 빌드를 실행한다. 결과는 `android/app/build/outputs/apk/debug/app-debug.apk`이며 git에는 포함하지 않는다. 웹 자산을 이미 동기화했다면 `bash scripts/build-android.sh`로 Android만 빌드할 수 있다. 최초 빌드에는 Maven/Gradle 다운로드가 필요하다. 이 APK는 개발 서명이며 스토어 배포용이 아니다.

새 Linux x64 환경에서 도구를 준비할 때는 [Temurin 공식 JDK 21](https://adoptium.net/temurin/releases/?version=21)과 [Android 공식 command-line tools](https://developer.android.com/studio#command-line-tools-only)를 내려받아 각각 `.tools/jdk-21`, `.tools/android-sdk/cmdline-tools/latest`에 압축 해제한다. JDK 폴더 바로 아래 `bin/javac`, SDK 도구 바로 아래 `bin/sdkmanager`가 있어야 한다. 각 배포 페이지의 SHA-256을 확인한 뒤 다음 명령을 실행하고 표시되는 Android SDK 라이선스를 검토한다.

```bash
export JAVA_HOME="$PWD/.tools/jdk-21"
export ANDROID_HOME="$PWD/.tools/android-sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" "platforms;android-36" "build-tools;35.0.0"
npm run android:build
```

## USB로 설치하고 로컬 API 연결

1. Fold7 개발자 옵션에서 USB 디버깅을 켠다. 데이터 전송 가능한 케이블로 개발 PC에 연결하고 휴대전화의 RSA 허용 창을 확인한다. 개발 PC의 USB 접근 권한은 OS 설정에 따른다.
2. 한 터미널에서 저장소 루트의 `npm run server`를 실행한다. 서버는 개발 PC의 `127.0.0.1:8787`에서 동작한다. 실제 민감한 영상 대신 테스트 클립과 데모 계정을 사용한다.
3. 다른 터미널에서 아래 명령을 실행한다. 이미 Android SDK가 PATH에 있다면 `adb`만 사용해도 된다. 여러 기기를 연결했다면 모든 adb 명령에 `-s <기기시리얼>`을 붙인다.

```bash
export PATH="$PWD/.tools/android-sdk/platform-tools:$PATH"
adb devices -l
adb reverse tcp:8787 tcp:8787
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n app.wodsiege.pilot/.MainActivity
```

앱의 API 주소를 `http://localhost:8787`로 설정한다(네이티브 기본값). `localhost`는 휴대전화를 가리키고, adb reverse가 그 포트를 PC 서버에 연결한다. 서버가 내려가거나 USB가 끊기면 요청이 실패한다. 연결을 복구한 뒤 다시 시도한다. 재연결 후에는 `adb reverse`를 다시 실행해야 할 수 있다.

앱 문서의 origin은 Capacitor 기본 `https://localhost`이며 API 서버 CORS가 이 origin을 허용한다. HTTP 예외는 **debug 빌드의 localhost/127.0.0.1만** 허용한다. 임의 LAN IP의 HTTP 주소는 허용하지 않으므로 USB reverse를 사용한다. release에는 HTTP 예외와 혼합 콘텐츠 허용이 없으며 HTTPS API가 필요하다. API 서버를 외부 인터넷에 공개하는 작업은 이 파일럿 범위에 포함하지 않았다.

## Fold7 수동 인수표

수동 인수 전에 `npm run android:preflight`로 adb 상태, 기기 정보와 APK를 읽기 전용으로 확인할 수 있다. [사전 점검 도구 안내](ANDROID-PREFLIGHT.md)를 참고한다. 연결 기기 없음·권한 미승인·여러 기기 선택 필요는 별도의 차단 상태로 반환하며 아래 항목을 자동 통과 처리하지 않는다.

실행 전 앱 버전, 기기 모델, Android/One UI 버전, Android System WebView 버전, 테스트 날짜를 기록한다. 브라우저 360/412/840 CSS px 검증은 화면 크기 회귀 검사이며 실기기 인수를 대신하지 않는다.

| 확인 항목 | 실기기 완료 기준 | 현재 상태 |
| --- | --- | --- |
| 설치·시작·연결 | APK 설치, 시작 화면, 로그인/API 응답, USB 재연결 후 복구 | 미실행 |
| 접힘·펼침·회전 | 커버/메인 화면과 가로 방향에서 버튼·탐색·모달이 가려지지 않음 | 미실행 |
| 화면 연속성 | 경기 입력 중 접고 펴도 입력과 선택이 유지됨 | 미실행 |
| 분할 화면·키보드 | 최소 창 폭과 키보드 표시 중 제출 버튼에 접근 가능 | 미실행 |
| 글꼴·시스템 영역 | 큰 글꼴에서도 핵심 조작 가능, 상태/내비게이션 영역과 겹치지 않음 | 미실행 |
| GPS 권한 | 정밀/대략/거절/다시 묻지 않음 각 상태에서 설명과 복구 동작 | 미실행 |
| 위치 검증 | GPS 꺼짐·시간 초과·부정확 위치의 오류, 유효 위치의 Box 확인 | 미실행 |
| 영상 선택·전송 | Android 파일 선택기에서 MP4/WebM 선택, 업로드 진행/완료/오류 확인 | 미실행 |
| 영상 재생 | 제출 권한에 맞게 비공개 증거 재생, 취소·다시 재생 가능 | 미실행 |
| 업로드 중 전환 | 잠금/백그라운드/네트워크 단절 시 성공 여부를 잘못 표시하지 않음 | 미실행 |
| 경기 전체 흐름 | 개인/팀, 한 장소/각 Box, 합의·제출·검토·확정·분쟁/정정 | 미실행 |
| 앱 수명주기 | 뒤로가기, 백그라운드 복귀, 재시작, 서버 종료 오류 처리 | 미실행 |

위치 permission은 foreground coarse/fine만 선언했으며 background location을 요청하지 않는다. Activity는 resizable이고 orientation lock을 두지 않았다. 구성 변경은 Capacitor Activity가 처리한다. 사용자 입력 유지와 실제 GPS 품질, 영상 코덱 지원은 단말에서 확인해야 한다.

## 실행 증거

- 2026-09-06: `npx cap add android` 성공. JDK/SDK 설치 및 실제 APK 검증 결과는 아래에 갱신한다.
- JDK 다운로드 SHA-256: `ce79869e1307ed8ee1e2baa86a412b1eb5b75d10a01006d788a6f968bcfaee94` (Temurin `21.0.12.1+1`).
- Android command-line tools 배포: `commandlinetools-linux-15859902_latest.zip`. 공식 SHA-256: `4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583`.
- 두 다운로드의 로컬 SHA-256이 공식 값과 일치했다. `javac -version`은 `21.0.12.1`, `gradlew --version`은 `8.14.3`, `adb version`은 `37.0.1-15733141`이었다.
- `adb devices -l`: `List of devices attached` 다음에 기기 항목이 없었다. 설치·GPS·접힘/펼침·네이티브 영상 테스트는 실기기 연결 후 수행해야 한다.
- `aapt2 compile`로 main/debug Android 리소스 XML 컴파일 통과. Gradle wrapper는 공식 `8.14.3-all.zip` SHA-256을 고정했다.
- 최종 `npm run android:build` 성공: `BUILD SUCCESSFUL in 32s`, 124 tasks(27 실행/97 up-to-date). 결과 APK 약 8.3MiB. 폰트와 `THIRD-PARTY-NOTICES.txt`를 APK 내부에 포함했다.
- `apksigner verify --verbose`로 최종 APK v2 서명 검증 성공. `aapt dump badging`에서 패키지 `app.wodsiege.pilot`, versionName `0.1.0`, min SDK24, target SDK36 및 foreground 위치 권한을 확인했다.
- APK SHA-256: `f1279b91bdcc7564e5534703de3ce5652454b02bb17c823aaaabb19a6c0f9192`.
