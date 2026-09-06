# Android / Galaxy Z Fold7 preflight

`scripts/android-preflight.mjs` is a deliberately read-only readiness check before a manual device acceptance run. It never installs or starts the app, creates an `adb reverse` mapping, reads logcat, collects GPS data, captures screenshots, or extracts app/user data.

Run it from the repository root:

```bash
node scripts/android-preflight.mjs
```

It emits a machine-readable JSON report and returns a nonzero exit code for a blocked state. With no connected device, the expected result is `BLOCKED_NO_DEVICE` and exit code `11`; that is not a passing result.

When more than one adb device is listed, select the intended device explicitly:

```bash
node scripts/android-preflight.mjs --serial DEVICE_SERIAL
```

The script prefers `.tools/android-sdk/platform-tools/adb` when present and otherwise uses `adb` from `PATH`. `ADB=/absolute/path/to/adb` may select a specific adb executable. It reads `adb devices -l`, Android model/version/API properties, the current WebView package, and whether `app.wodsiege.pilot` is installed. Before it can report readiness for an authorized device, it checks the local debug APK SHA-256, runs `apksigner verify`, and uses `aapt dump badging` to require package `app.wodsiege.pilot` plus version metadata. It uses the repository's build-tools 35.0.0 and JDK 21 when available, without changing the caller's environment; unavailable or failed verifiers block readiness. A valid APK signature is not a certificate-trust assertion.

To retain a report, explicitly request a new path below `artifacts/`; existing files are never overwritten. Automatically selected device serials are redacted in reports. A serial supplied via `--serial` is retained so the saved evidence can be tied to the operator's explicit selection.

```bash
node scripts/android-preflight.mjs --serial DEVICE_SERIAL \
  --output artifacts/fold7-preflight.json
```

The preflight does not establish that a device is a Fold7 merely from its model string or screen dimensions. Manual acceptance still must cover folding/unfolding, cover and main displays, rotation, split screen, keyboard, large fonts, GPS permission and failure states, video pick/upload/playback, lifecycle/network interruptions, and the full match flow. See [ANDROID-TESTING.md](ANDROID-TESTING.md) for the complete procedure.
