import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY0_CHECKPOINTS,
  DAY2_CHECKPOINTS,
  markdownReport,
  parseArgs,
  redactText,
} from "../scripts/device-acceptance.mjs";

test("parseArgs returns safe defaults", () => {
  assert.deepEqual(parseArgs([]), {
    phase: "day0",
    build: false,
    reuseServer: false,
    nonInteractive: false,
    apkPath: "android/app/build/outputs/apk/debug/app-debug.apk",
  });
});

test("parseArgs accepts day0 automation flags", () => {
  assert.deepEqual(
    parseArgs([
      "--serial",
      "ABC123",
      "--build",
      "--reuse-server",
      "--non-interactive",
      "--output-dir",
      "artifacts/fold7-test",
      "--apk",
      "android/example.apk",
    ]),
    {
      phase: "day0",
      build: true,
      reuseServer: true,
      nonInteractive: true,
      apkPath: "android/example.apk",
      serial: "ABC123",
      outputDir: "artifacts/fold7-test",
    },
  );
});

test("parseArgs requires resume for day2", () => {
  assert.throws(() => parseArgs(["--phase", "day2"]), /requires --resume/);
  assert.equal(
    parseArgs(["--phase", "day2", "--resume", "artifacts/fold7-run"]).resume,
    "artifacts/fold7-run",
  );
});

test("redactText removes explicit secrets and common credential patterns", () => {
  const redacted = redactText(
    "serial ABC123 authorization:BearerToken password=hunter2 token=my-token",
    ["ABC123"],
  );
  assert.doesNotMatch(redacted, /ABC123|BearerToken|hunter2|my-token/);
  assert.match(redacted, /\[REDACTED\]/);
});

test("human checkpoints keep physical and time-based acceptance explicit", () => {
  assert.ok(DAY0_CHECKPOINTS.some(([id, text]) => id === "H01" && /접은/.test(text)));
  assert.ok(DAY0_CHECKPOINTS.some(([id, text]) => id === "H04" && /실제 시험 Box 위치/.test(text)));
  assert.ok(DAY0_CHECKPOINTS.some(([id, text]) => id === "H06" && /실제 USB/.test(text)));
  assert.ok(DAY2_CHECKPOINTS.some(([id, text]) => id === "H10" && /\+48시간/.test(text)));
});

test("markdownReport renders automated and human acceptance results", () => {
  const report = markdownReport({
    runId: "fold7-test",
    phase: "day0",
    startedAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:01:00.000Z",
    device: { model: "Fold7", androidVersion: "16", webView: "test-webview" },
    deviceSerialRedacted: "****1234",
    apkSha256: "abc",
    dataDir: "data/fold7-test",
    steps: [{ name: "launch", status: "PASS" }],
    checkpoints: [{ id: "H01", status: "PASS", note: "cover display ok" }],
  });

  assert.match(report, /Fold7 Device Acceptance Report/);
  assert.match(report, /\*\*PASS\*\* launch/);
  assert.match(report, /\| H01 \| PASS \| cover display ok \|/);
  assert.match(report, /- PASS: observed and accepted during this run\./);
});
