import test from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT, main, preflight, writeReport } from "../scripts/android-preflight.mjs";

const adbDevices = (rows) => `List of devices attached\n${rows.join("\n")}\n`;

function runner(devices, values = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (args[0] === "devices") return adbDevices(devices);
    if (args[0] === "verify") return "Verified using v2 scheme\n";
    if (args[0] === "dump") return "package: name='app.wodsiege.pilot' versionCode='1' versionName='0.1.0'\n";
    const key = args.slice(-1)[0];
    if (key === "getCurrentWebViewPackage") return values.webView || "com.google.android.webview 123";
    if (args.includes("getprop")) return values[key] || ({ "ro.product.model": "SM-F966N", "ro.build.version.release": "16", "ro.build.version.sdk": "36" }[key]);
    if (args.includes("pm")) return values.pmPath || "package:/data/app/app.wodsiege.pilot/base.apk\n";
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };
  return { run, calls };
}

test("no device is a blocked, non-pass outcome", () => {
  const { run, calls } = runner([]);
  const report = preflight({ adb: "adb", run });
  assert.equal(report.outcome, "BLOCKED_NO_DEVICE");
  assert.equal(report.exitCode, EXIT.NO_DEVICE);
  assert.equal(calls.length, 1);
});

test("offline and unauthorized devices are blocked without inspection", () => {
  for (const [state, outcome, code] of [["offline", "BLOCKED_DEVICE_NOT_READY", EXIT.OFFLINE], ["unauthorized", "BLOCKED_UNAUTHORIZED", EXIT.UNAUTHORIZED]]) {
    const { run, calls } = runner([`SERIAL123 ${state}`]);
    const report = preflight({ adb: "adb", run });
    assert.equal(report.outcome, outcome);
    assert.equal(report.exitCode, code);
    assert.equal(calls.length, 1);
  }
});

test("multiple devices require explicit serial", () => {
  const { run } = runner(["ONE device", "TWO device"]);
  const report = preflight({ adb: "adb", run });
  assert.equal(report.outcome, "BLOCKED_MULTIPLE_DEVICES");
  assert.equal(report.exitCode, EXIT.MULTIPLE_DEVICES);
});

test("authorized device uses only the read-only adb command allowlist", () => {
  const { run, calls } = runner(["0123456789ABCDEF device product:fold model:SM-F966N"]);
  const report = preflight({ adb: "adb", run });
  assert.equal(report.outcome, "READY_FOR_MANUAL_ACCEPTANCE");
  assert.equal(report.exitCode, EXIT.READY);
  assert.equal(report.adb.selectedSerial, "****CDEF");
  assert.equal(report.device.apiLevel, "36");
  assert.equal(report.device.installedPackage.exists, true);
  for (const [, args] of calls) {
    assert.equal(args.includes("install"), false);
    assert.equal(args.includes("reverse"), false);
    assert.equal(args.includes("logcat"), false);
    assert.equal(args.includes("am"), false);
    assert.equal(args[0] === "devices" || args[0] === "verify" || args[0] === "dump" || (args.includes("shell") && (args.includes("getprop") || args.includes("webviewupdate") || args.includes("pm"))), true);
  }
});

test("explicit serial is retained and can select one device", () => {
  const { run } = runner(["ONE device", "TWO device"]);
  const report = preflight({ adb: "adb", serial: "TWO", run });
  assert.equal(report.outcome, "READY_FOR_MANUAL_ACCEPTANCE");
  assert.equal(report.adb.selectedSerial, "TWO");
});

test("inspection failures redact automatically selected serials", () => {
  const serial = "0123456789ABCDEF";
  const run = (_command, args) => {
    if (args[0] === "devices") return adbDevices([`${serial} device`]);
    throw new Error(`device ${serial} disconnected`);
  };
  const report = preflight({ adb: "adb", run });
  assert.equal(report.outcome, "BLOCKED_CONNECTION_ERROR");
  assert.match(report.error, /\*\*\*\*CDEF/);
  assert.doesNotMatch(report.error, new RegExp(serial));
});

test("CLI maps --apk to apkPath and preserves explicit serial/output options", () => {
  let received;
  const lines = [];
  const code = main(
    ["--apk", "custom.apk", "--serial", "SERIAL", "--output", "artifacts/out.json"],
    { log: (line) => lines.push(line), error: () => assert.fail("unexpected stderr") },
    {
      preflightFn: (options) => {
        received = options;
        return { outcome: "BLOCKED_NO_DEVICE", exitCode: EXIT.NO_DEVICE };
      },
      writeReportFn: (output, report) => assert.deepEqual([output, report.outcome], ["artifacts/out.json", "BLOCKED_NO_DEVICE"]),
    },
  );
  assert.equal(code, EXIT.NO_DEVICE);
  assert.deepEqual(received, { apkPath: "custom.apk", serial: "SERIAL", output: "artifacts/out.json" });
  assert.equal(lines.length, 1);
});

test("missing local APK blocks otherwise authorized device readiness", () => {
  const { run } = runner(["SERIAL device"]);
  const report = preflight({ adb: "adb", apkPath: "missing.apk", run });
  assert.equal(report.outcome, "BLOCKED_LOCAL_APK_UNAVAILABLE");
  assert.equal(report.exitCode, EXIT.LOCAL_APK_UNAVAILABLE);
  assert.equal(report.localApk.exists, false);
});

test("a directory passed as --apk is reported as unavailable instead of crashing", () => {
  const { run } = runner(["SERIAL device"]);
  const report = preflight({ adb: "adb", apkPath: "android", run });
  assert.equal(report.outcome, "BLOCKED_LOCAL_APK_UNAVAILABLE");
  assert.match(report.localApk.error, /regular file/);
});

test("an unavailable package is not treated as a connection error", () => {
  const { run: base } = runner(["SERIAL device"]);
  const run = (command, args) => args.includes("pm") ? (() => { throw new Error("Unknown package: app.wodsiege.pilot"); })() : base(command, args);
  const report = preflight({ adb: "adb", run });
  assert.equal(report.outcome, "READY_FOR_MANUAL_ACCEPTANCE");
  assert.equal(report.device.installedPackage.exists, false);
});

test("APK verification blocks malformed archives, wrong packages, and unavailable verifiers", () => {
  const cases = [
    {
      run: (() => {
        const { run: base } = runner(["SERIAL device"]);
        return (command, args, options) => args[0] === "verify" ? (() => { throw new Error("ERROR: not a ZIP archive"); })() : base(command, args, options);
      })(),
      expected: /not a ZIP archive/,
    },
    {
      run: (() => {
        const { run: base } = runner(["SERIAL device"]);
        return (command, args, options) => args[0] === "dump" ? "package: name='wrong.package' versionCode='1' versionName='0.1.0'\n" : base(command, args, options);
      })(),
      expected: /wrong.package/,
    },
    {
      run: (() => {
        const { run: base } = runner(["SERIAL device"]);
        return (command, args, options) => {
          if (args[0] === "verify") {
            const error = new Error("not found");
            error.code = "ENOENT";
            throw error;
          }
          return base(command, args, options);
        };
      })(),
      expected: /apksigner is unavailable/,
    },
  ];
  for (const { run, expected } of cases) {
    const report = preflight({ adb: "adb", run });
    assert.equal(report.outcome, "BLOCKED_LOCAL_APK_UNAVAILABLE");
    assert.match(report.error, expected);
  }
});

test("no-permissions adb state provides an actionable block", () => {
  const { run } = runner(["SERIAL no permissions (user in plugdev group; are your udev rules wrong?)"]);
  const report = preflight({ adb: "adb", run });
  assert.equal(report.outcome, "BLOCKED_DEVICE_PERMISSION");
  assert.match(report.error, /udev rules/);
});

test("reports can only be newly created below artifacts", () => {
  const temporary = mkdtempSync(join(tmpdir(), "preflight-"));
  try {
    assert.throws(() => writeReport("outside.json", {}), /below artifacts/);
    const reportPath = `artifacts/preflight-test-${Date.now()}.json`;
    writeReport(reportPath, { outcome: "BLOCKED_NO_DEVICE" });
    assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).outcome, "BLOCKED_NO_DEVICE");
    assert.throws(() => writeReport(reportPath, {}), /overwrite/);
    rmSync(reportPath);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("report writing refuses symlinked artifact ancestors and uses private modes", () => {
  const outside = mkdtempSync(join(tmpdir(), "preflight-outside-"));
  const link = "artifacts/preflight-symlink";
  try {
    mkdirSync("artifacts", { recursive: true });
    symlinkSync(outside, link);
    assert.throws(() => writeReport(`${link}/escape.json`, {}), /symlink/);
    rmSync(link);
    const reportPath = `artifacts/preflight-mode-${Date.now()}.json`;
    writeReport(reportPath, {});
    assert.equal(lstatSync(reportPath).mode & 0o777, 0o600);
    rmSync(reportPath);
  } finally {
    rmSync(link, { force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
