#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  findAdb,
  parseDevices,
  preflight,
  redactSerial,
} from "./android-preflight.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageName = "app.wodsiege.pilot";
const activityName = `${packageName}/.MainActivity`;
const defaultApk = "android/app/build/outputs/apk/debug/app-debug.apk";
const serverUrl = "http://127.0.0.1:8787";

export const EXIT = Object.freeze({
  PASS_OR_PENDING: 0,
  BLOCKED: 20,
  FAILED: 21,
  INVALID_ARGUMENT: 64,
});

export const DAY0_CHECKPOINTS = Object.freeze([
  ["H01", "Fold7을 접은 커버 화면에서 주요 메뉴·버튼·목록이 정상인지 확인하세요."],
  ["H02", "Fold7을 펼친 메인 화면에서 목록·상세 영역과 작성 중 입력 유지 여부를 확인하세요."],
  ["H03", "회전·분할 화면·키보드 표시·큰 글꼴 상태에서 핵심 버튼 접근과 화면 겹침을 확인하세요."],
  ["H04", "실제 시험 Box 위치에서 정밀/대략/거절/재허용 GPS 흐름과 유효 위치 성공을 확인하세요."],
  ["H05", "시험 MP4/WebM의 선택·업로드·권한별 재생·실패 후 재시도를 확인하세요."],
  ["H06", "안내가 나오면 실제 USB를 분리했다 재연결하고 API 오류 표시 및 복구를 확인하세요."],
  ["H07", "개인전·한 장소 경기의 생성→수락→명단→잠금→시작→제출→검토 흐름을 확인하세요."],
  ["H08", "별도 경기에서 이의 제기→독립 운영자 판정→정정 및 중복 반영 방지를 확인하세요."],
  ["H09", "3인 팀전·각 Box 진행 방식의 전체 흐름을 확인하세요."],
]);

export const DAY2_CHECKPOINTS = Object.freeze([
  ["H10", "예정 시각 +48시간이 실제 경과한 일반 경기를 확정하고 순위·원장·포인트 일치를 확인하세요."],
]);

function timestampId(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function parseArgs(args) {
  const options = {
    phase: "day0",
    build: false,
    reuseServer: false,
    nonInteractive: false,
    apkPath: defaultApk,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--build") options.build = true;
    else if (arg === "--reuse-server") options.reuseServer = true;
    else if (arg === "--non-interactive") options.nonInteractive = true;
    else if (["--serial", "--phase", "--resume", "--apk", "--output-dir"].includes(arg)) {
      const value = args[++i];
      if (!value) throw new Error(`Missing value for ${arg}.`);
      const key = {
        "--serial": "serial",
        "--phase": "phase",
        "--resume": "resume",
        "--apk": "apkPath",
        "--output-dir": "outputDir",
      }[arg];
      options[key] = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!new Set(["day0", "day2"]).has(options.phase)) {
    throw new Error("--phase must be day0 or day2.");
  }
  if (options.phase === "day2" && !options.resume) {
    throw new Error("--phase day2 requires --resume artifacts/<run-dir>.");
  }
  return options;
}

function run(command, args, { env = process.env, timeout = 60_000, encoding = "utf8" } = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env,
    encoding,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} interrupted (${result.signal}).`);
  if (result.status !== 0) {
    const stderr = encoding ? result.stderr : result.stderr?.toString("utf8");
    const stdout = encoding ? result.stdout : result.stdout?.toString("utf8");
    throw new Error((stderr || stdout || `${command} exited ${result.status}`).trim());
  }
  return result.stdout;
}

function ensureArtifactsPath(path) {
  const absolute = resolve(rootDir, path);
  const artifacts = resolve(rootDir, "artifacts");
  const rel = relative(artifacts, absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("Acceptance output must be below artifacts/.");
  }
  return absolute;
}

function ensurePrivateDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function writePrivate(path, content) {
  ensurePrivateDir(dirname(path));
  writeFileSync(path, content, { mode: 0o600 });
}

function writeJson(path, value) {
  writePrivate(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function redactText(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join("[REDACTED]");
  text = text.replace(/(authorization|bearer|token|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  return text;
}

function selectedDevice(adb, explicitSerial) {
  const devices = parseDevices(run(adb, ["devices", "-l"], { timeout: 10_000 }));
  const ready = devices.filter((device) => device.state === "device");
  if (explicitSerial) {
    const match = ready.find((device) => device.serial === explicitSerial);
    if (!match) throw new Error("Requested device serial is not connected in device state.");
    return match;
  }
  if (ready.length !== 1) throw new Error(`Expected exactly one ready adb device; found ${ready.length}. Use --serial when needed.`);
  return ready[0];
}

async function healthOk() {
  try {
    const response = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true && body?.mode === "pilot";
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthOk()) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
  }
  return false;
}

function startServer(dataDir) {
  return spawn(process.execPath, ["server/index.mjs"], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: "8787",
      WODSIEGE_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 12_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function collectEvidence(adb, serial, runDir, label) {
  const safeLabel = label.replace(/[^A-Za-z0-9_-]/g, "_");
  const evidenceDir = resolve(runDir, "evidence");
  ensurePrivateDir(evidenceDir);
  const errors = [];
  try {
    const png = run(adb, ["-s", serial, "exec-out", "screencap", "-p"], { encoding: null, timeout: 15_000 });
    writePrivate(resolve(evidenceDir, `${safeLabel}.png`), png);
  } catch (error) {
    errors.push(`screenshot: ${error.message}`);
  }
  try {
    run(adb, ["-s", serial, "shell", "uiautomator", "dump", "/sdcard/wodsiege-window.xml"], { timeout: 15_000 });
    const xml = run(adb, ["-s", serial, "shell", "cat", "/sdcard/wodsiege-window.xml"], { timeout: 15_000 });
    writePrivate(resolve(evidenceDir, `${safeLabel}.xml`), xml);
  } catch (error) {
    errors.push(`ui-dump: ${error.message}`);
  }
  try {
    const logs = run(adb, ["-s", serial, "logcat", "-d", "-t", "500"], { timeout: 20_000 });
    writePrivate(resolve(evidenceDir, `${safeLabel}.logcat.txt`), redactText(logs, [serial]));
  } catch (error) {
    errors.push(`logcat: ${error.message}`);
  }
  return errors;
}

async function promptCheckpoint(rl, [id, instruction], nonInteractive) {
  if (nonInteractive) return { id, status: "PENDING", note: "Non-interactive run; user acceptance required." };
  output.write(`\n[${id}] ${instruction}\n`);
  while (true) {
    const answer = (await rl.question("결과 입력 [p=PASS / f=FAIL / s=SKIP]: ")).trim().toLowerCase();
    if (["p", "pass"].includes(answer)) return { id, status: "PASS" };
    if (["f", "fail"].includes(answer)) {
      const note = (await rl.question("실패 사유/재현 정보를 입력하세요: ")).trim();
      return { id, status: "FAIL", note };
    }
    if (["s", "skip"].includes(answer)) {
      const note = (await rl.question("미실행 사유를 입력하세요: ")).trim();
      return { id, status: "SKIP", note };
    }
  }
}

function markdownReport(state) {
  const rows = state.checkpoints
    .map((item) => `| ${item.id} | ${item.status} | ${String(item.note || "").replace(/\|/g, "\\|")} |`)
    .join("\n");
  return `# Fold7 Device Acceptance Report\n\n- Run ID: ${state.runId}\n- Phase: ${state.phase}\n- Started: ${state.startedAt}\n- Updated: ${state.updatedAt}\n- Device: ${state.device?.model || "unknown"}\n- Android: ${state.device?.androidVersion || "unknown"}\n- WebView: ${state.device?.webView || "unknown"}\n- Device serial: ${state.deviceSerialRedacted || "unknown"}\n- APK SHA-256: ${state.apkSha256 || "unknown"}\n- Test data path: ${state.dataDir}\n\n## Automated steps\n\n${state.steps.map((step) => `- **${step.status}** ${step.name}${step.note ? ` — ${step.note}` : ""}`).join("\n")}\n\n## Human checkpoints\n\n| ID | Result | Note |\n| --- | --- | --- |\n${rows || "| - | PENDING | No checkpoint executed |"}\n\n## Interpretation\n\n- `PASS`: observed and accepted during this run.\n- `FAIL`: acceptance failed and requires correction/retest.\n- `SKIP`: intentionally not executed; reason should be recorded.\n- `PENDING`: automation prepared the check but a user has not accepted it yet.\n- Software-induced API interruption is not evidence of a physical USB disconnect.\n- Mock/injected coordinates are not evidence of real-device GPS acceptance.\n`;
}

function updateState(runDir, state) {
  state.updatedAt = new Date().toISOString();
  writeJson(resolve(runDir, "state.json"), state);
  writePrivate(resolve(runDir, "report.md"), markdownReport(state));
}

function step(state, name, fn) {
  try {
    const value = fn();
    state.steps.push({ name, status: "PASS" });
    return value;
  } catch (error) {
    state.steps.push({ name, status: "FAIL", note: error.message });
    throw error;
  }
}

async function runDay0(options, io = console) {
  const runId = `fold7-${timestampId()}`;
  const requestedOutput = options.outputDir || `artifacts/${runId}`;
  const runDir = ensureArtifactsPath(requestedOutput);
  if (existsSync(runDir)) throw new Error(`Refusing existing acceptance directory: ${requestedOutput}`);
  ensurePrivateDir(runDir);

  const apkAbsolute = resolve(rootDir, options.apkPath);
  if (options.build || !existsSync(apkAbsolute)) {
    run("npm", ["run", "android:build"], { timeout: 10 * 60_000 });
  }

  const adb = findAdb();
  const device = selectedDevice(adb, options.serial);
  const preflightReport = preflight({ adb, serial: device.serial, apkPath: options.apkPath });
  writeJson(resolve(runDir, "preflight.json"), {
    ...preflightReport,
    adb: { ...preflightReport.adb, selectedSerial: redactSerial(device.serial) },
  });
  if (preflightReport.exitCode !== 0) throw new Error(`Preflight blocked: ${preflightReport.outcome}`);

  const dataDir = relative(rootDir, resolve(rootDir, "data", runId));
  const state = {
    schemaVersion: 1,
    tool: "wodsiege-device-acceptance",
    runId,
    phase: "day0",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dataDir,
    apkPath: options.apkPath,
    apkSha256: preflightReport.localApk?.sha256 || createHash("sha256").update(readFileSync(apkAbsolute)).digest("hex"),
    device: preflightReport.device,
    deviceSerialRedacted: redactSerial(device.serial),
    steps: [],
    checkpoints: [],
    day2Eligible: false,
  };
  updateState(runDir, state);

  let serverChild;
  let rl;
  try {
    const alreadyHealthy = await healthOk();
    if (options.reuseServer) {
      if (!alreadyHealthy) throw new Error("--reuse-server was requested but /api/health is not available.");
      state.steps.push({ name: "reuse existing pilot server", status: "PASS" });
    } else {
      if (alreadyHealthy) throw new Error("Port 8787 already has a healthy pilot server. Stop it or rerun with --reuse-server.");
      serverChild = startServer(dataDir);
      let serverStderr = "";
      serverChild.stderr.on("data", (chunk) => { serverStderr += chunk.toString("utf8"); });
      if (!(await waitForHealth())) throw new Error(`Pilot server did not become healthy. ${redactText(serverStderr)}`);
      state.steps.push({ name: "start isolated pilot server", status: "PASS" });
    }

    step(state, "adb reverse tcp:8787", () => run(adb, ["-s", device.serial, "reverse", "tcp:8787", "tcp:8787"]));
    step(state, "install debug APK", () => run(adb, ["-s", device.serial, "install", "-r", apkAbsolute], { timeout: 2 * 60_000 }));
    step(state, "launch WODSiege", () => run(adb, ["-s", device.serial, "shell", "am", "start", "-n", activityName]));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500));
    collectEvidence(adb, device.serial, runDir, "A01-launch");

    step(state, "background and resume app", () => {
      run(adb, ["-s", device.serial, "shell", "input", "keyevent", "KEYCODE_HOME"]);
      run(adb, ["-s", device.serial, "shell", "am", "start", "-n", activityName]);
    });
    step(state, "force-stop and relaunch app", () => {
      run(adb, ["-s", device.serial, "shell", "am", "force-stop", packageName]);
      run(adb, ["-s", device.serial, "shell", "am", "start", "-n", activityName]);
    });

    step(state, "simulate API connection loss", () => run(adb, ["-s", device.serial, "reverse", "--remove", "tcp:8787"]));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    collectEvidence(adb, device.serial, runDir, "A02-api-disconnected");
    step(state, "restore API connection", () => run(adb, ["-s", device.serial, "reverse", "tcp:8787", "tcp:8787"]));

    rl = createInterface({ input, output });
    for (const checkpoint of DAY0_CHECKPOINTS) {
      if (checkpoint[0] === "H06" && !options.nonInteractive) {
        output.write("\n물리 USB 단절은 adb reverse 제거와 다른 검사입니다. 실제 케이블을 분리→재연결한 뒤 adb 권한을 확인하고 계속하세요.\n");
      }
      const result = await promptCheckpoint(rl, checkpoint, options.nonInteractive);
      const evidenceErrors = collectEvidence(adb, device.serial, runDir, result.id);
      if (evidenceErrors.length) result.evidenceWarnings = evidenceErrors;
      state.checkpoints.push(result);
      updateState(runDir, state);
    }
    state.day2Eligible = state.checkpoints.some((item) => item.id === "H07" && item.status === "PASS");
    updateState(runDir, state);
    io.log(`Acceptance state written to ${relative(rootDir, runDir)}/report.md`);
    return { exitCode: state.checkpoints.some((item) => item.status === "FAIL") ? EXIT.FAILED : EXIT.PASS_OR_PENDING, runDir };
  } finally {
    rl?.close();
    try { run(adb, ["-s", device.serial, "reverse", "--remove", "tcp:8787"]); } catch {}
    await stopServer(serverChild);
  }
}

async function runDay2(options, io = console) {
  const runDir = ensureArtifactsPath(options.resume);
  const statePath = resolve(runDir, "state.json");
  if (!existsSync(statePath)) throw new Error("Resume directory does not contain state.json.");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (state.tool !== "wodsiege-device-acceptance") throw new Error("Resume state is not a WODSiege device acceptance run.");
  if (!state.day2Eligible) throw new Error("DAY-0 state is not eligible for +48h finalization acceptance.");
  state.phase = "day2";
  let rl;
  try {
    rl = createInterface({ input, output });
    for (const checkpoint of DAY2_CHECKPOINTS) {
      const existing = state.checkpoints.find((item) => item.id === checkpoint[0]);
      if (existing?.status === "PASS") continue;
      const result = await promptCheckpoint(rl, checkpoint, options.nonInteractive);
      state.checkpoints = state.checkpoints.filter((item) => item.id !== result.id);
      state.checkpoints.push(result);
      updateState(runDir, state);
    }
    io.log(`DAY-2 acceptance updated ${relative(rootDir, runDir)}/report.md`);
    return { exitCode: state.checkpoints.some((item) => item.status === "FAIL") ? EXIT.FAILED : EXIT.PASS_OR_PENDING, runDir };
  } finally {
    rl?.close();
  }
}

export async function main(args = process.argv.slice(2), io = console) {
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    io.error(error.message);
    return EXIT.INVALID_ARGUMENT;
  }
  if (options.help) {
    io.log("Usage: node scripts/device-acceptance.mjs [--serial SERIAL] [--build] [--reuse-server] [--non-interactive] [--output-dir artifacts/RUN] [--phase day0|day2] [--resume artifacts/RUN]");
    return EXIT.PASS_OR_PENDING;
  }
  try {
    const result = options.phase === "day2" ? await runDay2(options, io) : await runDay0(options, io);
    return result.exitCode;
  } catch (error) {
    io.error(`Device acceptance blocked/failed: ${redactText(error.message, [options.serial])}`);
    return EXIT.BLOCKED;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
