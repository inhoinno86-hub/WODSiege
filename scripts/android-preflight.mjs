#!/usr/bin/env node
/**
 * Read-only Android device preflight. It deliberately does not install, start,
 * reverse ports, collect logs/location/screenshots, or read application data.
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultApk = "android/app/build/outputs/apk/debug/app-debug.apk";
const packageName = "app.wodsiege.pilot";

export const EXIT = Object.freeze({
  READY: 0,
  ADB_UNAVAILABLE: 10,
  NO_DEVICE: 11,
  MULTIPLE_DEVICES: 12,
  UNAUTHORIZED: 13,
  OFFLINE: 14,
  CONNECTION_ERROR: 15,
  LOCAL_APK_UNAVAILABLE: 16,
  INVALID_ARGUMENT: 64,
  OUTPUT_REFUSED: 65,
});

export function findAdb(env = process.env) {
  if (env.ADB) return env.ADB;
  const local = resolve(rootDir, ".tools/android-sdk/platform-tools/adb");
  return existsSync(local) ? local : "adb";
}

export function defaultRun(command, args, { env = process.env } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env,
  });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") throw new Error("Command timed out after 10 seconds.");
    throw result.error;
  }
  if (result.signal) throw new Error(`Command timed out or was interrupted (${result.signal}).`);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim());
  }
  return result.stdout;
}

export function parseDevices(text) {
  return String(text)
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...details] = line.split(/\s+/);
      return { serial, state, details: details.join(" ") };
    });
}

export function redactSerial(serial) {
  if (!serial) return null;
  return serial.length <= 4 ? "****" : `****${serial.slice(-4)}`;
}

export function findAndroidTools() {
  const buildTools = resolve(rootDir, ".tools/android-sdk/build-tools/35.0.0");
  const javaHome = resolve(rootDir, ".tools/jdk-21");
  return {
    apksigner: existsSync(resolve(buildTools, "apksigner")) ? resolve(buildTools, "apksigner") : "apksigner",
    aapt: existsSync(resolve(buildTools, "aapt")) ? resolve(buildTools, "aapt") : "aapt",
    javaHome: existsSync(resolve(javaHome, "bin/java")) ? javaHome : null,
  };
}

function localApkInfo(apkPath) {
  const absolutePath = resolve(rootDir, apkPath);
  if (!existsSync(absolutePath)) return { path: apkPath, exists: false, sha256: null, error: "APK file does not exist." };
  try {
    if (!lstatSync(absolutePath).isFile()) {
      return { path: apkPath, exists: false, sha256: null, error: "APK path is not a regular file." };
    }
    return {
      path: apkPath,
      exists: true,
      sha256: createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
      error: null,
    };
  } catch (error) {
    return { path: apkPath, exists: false, sha256: null, error: `APK cannot be read: ${error.message}` };
  }
}

function verifierError(error, tool) {
  if (error?.code === "ENOENT") return `${tool} is unavailable. Install Android SDK build-tools 35.0.0 or provide it on PATH.`;
  return error instanceof Error ? error.message : String(error);
}

export function verifyLocalApk(apkInfo, run = defaultRun, tools = findAndroidTools()) {
  if (!apkInfo.exists) return { ...apkInfo, verification: { status: "unavailable", error: apkInfo.error } };
  const absolutePath = resolve(rootDir, apkInfo.path);
  const env = tools.javaHome ? { ...process.env, JAVA_HOME: tools.javaHome } : process.env;
  try {
    run(tools.apksigner, ["verify", "--verbose", absolutePath], { env });
  } catch (error) {
    const message = verifierError(error, "apksigner");
    const unavailable = error?.code === "ENOENT";
    return { ...apkInfo, verification: { status: unavailable ? "unavailable" : "failed", error: message } };
  }
  let badging;
  try {
    badging = run(tools.aapt, ["dump", "badging", absolutePath], { env });
  } catch (error) {
    const message = verifierError(error, "aapt");
    const unavailable = error?.code === "ENOENT";
    return { ...apkInfo, verification: { status: unavailable ? "unavailable" : "failed", error: message } };
  }
  const packageMatch = /\bname='([^']+)'/.exec(badging);
  const versionCodeMatch = /\bversionCode='([^']+)'/.exec(badging);
  const versionNameMatch = /\bversionName='([^']+)'/.exec(badging);
  if (!packageMatch || !versionCodeMatch || !versionNameMatch) {
    return { ...apkInfo, verification: { status: "failed", error: "aapt did not return complete APK package/version metadata." } };
  }
  if (packageMatch[1] !== packageName) {
    return { ...apkInfo, verification: { status: "failed", error: `APK package is ${packageMatch[1]}, expected ${packageName}.` } };
  }
  return {
    ...apkInfo,
    verification: {
      status: "verified",
      signature: "valid",
      packageName: packageMatch[1],
      versionCode: versionCodeMatch[1],
      versionName: versionNameMatch[1],
      note: "Signature validity is not a certificate-trust assertion.",
    },
  };
}

function readProperty(run, adb, serial, property) {
  return run(adb, ["-s", serial, "shell", "getprop", property]).trim() || null;
}

export function inspectDevice({ adb, serial, run = defaultRun }) {
  const webView = run(adb, ["-s", serial, "shell", "cmd", "webviewupdate", "getCurrentWebViewPackage"]).trim();
  let installedApkPath;
  try {
    installedApkPath = run(adb, ["-s", serial, "shell", "pm", "path", packageName])
      .trim()
      .split(/\r?\n/)
      .find((line) => line.startsWith("package:"));
  } catch (error) {
    if (!/not found|unknown package|does not exist/i.test(error.message)) throw error;
  }
  return {
    model: readProperty(run, adb, serial, "ro.product.model"),
    androidVersion: readProperty(run, adb, serial, "ro.build.version.release"),
    apiLevel: readProperty(run, adb, serial, "ro.build.version.sdk"),
    webView: webView || null,
    installedPackage: {
      packageName,
      exists: Boolean(installedApkPath),
      path: installedApkPath ? installedApkPath.slice("package:".length) : null,
    },
  };
}

function baseReport(apkPath, explicitSerial) {
  return {
    schemaVersion: 1,
    tool: "wodsiege-android-preflight",
    readOnly: true,
    outcome: "BLOCKED",
    exitCode: EXIT.CONNECTION_ERROR,
    adb: { available: false, deviceCount: 0, selectedSerial: null, serialWasExplicit: Boolean(explicitSerial) },
    localApk: localApkInfo(apkPath),
    device: null,
    remainingManualChecks: [
      "Fold/unfold, cover/main display, rotation, split-screen, keyboard, and large-font acceptance",
      "GPS permission states and valid/invalid location behavior",
      "Video selection, upload, playback, lifecycle, network-loss, and full match flow",
    ],
    limitations: [
      "No install, app launch, adb reverse, logcat, location collection, screenshots, or user-data extraction was performed.",
      "A model string alone is not evidence that the device is a Galaxy Z Fold7.",
    ],
  };
}

function safeErrorMessage(error, serial, serialWasExplicit) {
  const message = error instanceof Error ? error.message : String(error);
  return !serialWasExplicit && serial
    ? message.split(serial).join(redactSerial(serial))
    : message;
}

export function preflight({ adb = findAdb(), serial, apkPath = defaultApk, run = defaultRun, tools = findAndroidTools() } = {}) {
  const report = baseReport(apkPath, serial);
  let devices;
  try {
    devices = parseDevices(run(adb, ["devices", "-l"]));
    report.adb.available = true;
  } catch (error) {
    report.outcome = "BLOCKED_ADB_UNAVAILABLE";
    report.exitCode = EXIT.ADB_UNAVAILABLE;
    report.error = `Unable to run adb devices -l: ${error.message}`;
    return report;
  }
  report.adb.deviceCount = devices.length;
  const selected = serial ? devices.find((device) => device.serial === serial) : null;
  if (serial && !selected) {
    report.outcome = "BLOCKED_SERIAL_NOT_FOUND";
    report.exitCode = EXIT.CONNECTION_ERROR;
    report.error = "The requested --serial is not reported by adb.";
    return report;
  }
  if (!serial && devices.length === 0) {
    report.outcome = "BLOCKED_NO_DEVICE";
    report.exitCode = EXIT.NO_DEVICE;
    report.error = "No adb devices are connected.";
    return report;
  }
  if (!serial && devices.length > 1) {
    report.outcome = "BLOCKED_MULTIPLE_DEVICES";
    report.exitCode = EXIT.MULTIPLE_DEVICES;
    report.error = "Multiple adb devices are reported; rerun with --serial <serial>.";
    return report;
  }
  const device = selected || devices[0];
  report.adb.selectedSerial = serial ? device.serial : redactSerial(device.serial);
  if (device.state === "unauthorized") {
    report.outcome = "BLOCKED_UNAUTHORIZED";
    report.exitCode = EXIT.UNAUTHORIZED;
    report.error = "Device authorization is pending; accept the RSA debugging prompt on the device.";
    return report;
  }
  if (device.state === "no" && /permissions?/i.test(device.details)) {
    report.outcome = "BLOCKED_DEVICE_PERMISSION";
    report.exitCode = EXIT.OFFLINE;
    report.error = "adb lacks USB permission. Check the USB cable, udev rules, and that your user has the required device-access group, then reconnect.";
    return report;
  }
  if (device.state !== "device") {
    report.outcome = "BLOCKED_DEVICE_NOT_READY";
    report.exitCode = EXIT.OFFLINE;
    report.error = `adb reports device state: ${device.state || "unknown"}.`;
    return report;
  }
  try {
    report.device = inspectDevice({ adb, serial: device.serial, run });
  } catch (error) {
    report.outcome = "BLOCKED_CONNECTION_ERROR";
    report.exitCode = EXIT.CONNECTION_ERROR;
    report.error = `Read-only device inspection failed: ${safeErrorMessage(error, device.serial, Boolean(serial))}`;
    return report;
  }
  report.localApk = verifyLocalApk(report.localApk, run, tools);
  if (report.localApk.verification.status !== "verified") {
    report.outcome = "BLOCKED_LOCAL_APK_UNAVAILABLE";
    report.exitCode = EXIT.LOCAL_APK_UNAVAILABLE;
    report.error = report.localApk.verification.error;
    return report;
  }
  report.outcome = "READY_FOR_MANUAL_ACCEPTANCE";
  report.exitCode = EXIT.READY;
  return report;
}

function ensureSafeDirectory(path) {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Refusing symlink or non-directory report path: ${path}`);
  } else {
    mkdirSync(path, { mode: 0o700 });
  }
  chmodSync(path, 0o700);
}

function ensureSafeReportParent(artifacts, parent) {
  ensureSafeDirectory(artifacts);
  const pieces = relative(artifacts, parent).split(sep).filter(Boolean);
  let current = artifacts;
  for (const piece of pieces) {
    current = resolve(current, piece);
    ensureSafeDirectory(current);
  }
}

export function writeReport(output, report) {
  const absolute = resolve(rootDir, output);
  const artifacts = resolve(rootDir, "artifacts");
  const outputRelative = relative(artifacts, absolute);
  if (isAbsolute(output) || outputRelative.startsWith(`..${sep}`) || outputRelative === ".." || outputRelative === "") {
    throw new Error("--output must be a new file below artifacts/.");
  }
  ensureSafeReportParent(artifacts, dirname(absolute));
  if (existsSync(absolute)) throw new Error("Refusing to overwrite an existing report.");
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (!new Set(["--serial", "--output", "--apk"]).has(arg) || !args[i + 1]) {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    const name = arg === "--apk" ? "apkPath" : arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    options[name] = args[++i];
  }
  return options;
}

export function main(args = process.argv.slice(2), io = console, { preflightFn = preflight, writeReportFn = writeReport } = {}) {
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    io.error(error.message);
    return EXIT.INVALID_ARGUMENT;
  }
  if (options.help) {
    io.log("Usage: node scripts/android-preflight.mjs [--serial SERIAL] [--apk PATH] [--output artifacts/REPORT.json]");
    return EXIT.READY;
  }
  const report = preflightFn(options);
  if (options.output) {
    try {
      writeReportFn(options.output, report);
    } catch (error) {
      io.error(`Report not written: ${error.message}`);
      return EXIT.OUTPUT_REFUSED;
    }
  }
  io.log(JSON.stringify(report, null, 2));
  return report.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
