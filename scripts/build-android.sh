#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${JAVA_HOME:-}" && -x "$project_root/.tools/jdk-21/bin/javac" ]]; then
  export JAVA_HOME="$project_root/.tools/jdk-21"
fi
if [[ -n "${JAVA_HOME:-}" ]]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if ! command -v javac >/dev/null 2>&1; then
  echo "JDK 21 is required. Set JAVA_HOME or install it in .tools/jdk-21." >&2
  exit 1
fi

if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    export ANDROID_HOME="$ANDROID_SDK_ROOT"
  elif [[ -d "$project_root/.tools/android-sdk/platforms/android-36" ]]; then
    export ANDROID_HOME="$project_root/.tools/android-sdk"
  fi
fi
if [[ -z "${ANDROID_HOME:-}" || ! -d "$ANDROID_HOME/platforms/android-36" ]]; then
  echo "Android SDK platform 36 is required. Set ANDROID_HOME; see docs/ANDROID-TESTING.md." >&2
  exit 1
fi
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$project_root/.tools/gradle}"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$project_root/.tools/android-user}"
mkdir -p "$ANDROID_USER_HOME"

if [[ ! -f "$project_root/android/app/src/main/assets/public/index.html" ]]; then
  echo "Web assets are missing. Run npm run android:sync first." >&2
  exit 1
fi

cd "$project_root/android"
./gradlew --no-daemon --max-workers=2 assembleDebug "$@"
echo "APK: $project_root/android/app/build/outputs/apk/debug/app-debug.apk"
