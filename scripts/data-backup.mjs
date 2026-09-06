import {
  closeSync,
  constants,
  copyFileSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DATABASE = "wodsiege.sqlite";
const FORMAT = "wodsiege-offline-backup-v1";
const safeName = (name) =>
  typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(name);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    // JSON.parse errors may include a fragment of sensitive aggregate data.
    throw new Error(`Invalid ${label} JSON`);
  }
}

function stat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// Check each existing component before normalizing: never silently accept ../ or symlinks.
function safePath(input, mustExist = true) {
  requireThat(
    typeof input === "string" && input.length > 0 && !input.includes("\0"),
    "An explicit path is required",
  );
  requireThat(
    !input.split(/[\\/]/).includes(".."),
    "Path traversal is not allowed",
  );
  const path = resolve(input);
  requireThat(
    ![parse(path).root, homedir(), process.cwd()].includes(path),
    "Broad root/home/workspace paths are not allowed",
  );
  let current = parse(path).root;
  for (const part of path.slice(current.length).split(sep)) {
    current = join(current, part);
    const info = stat(current);
    requireThat(!info?.isSymbolicLink(), "Symlinks are not allowed");
    if (current !== path)
      requireThat(info?.isDirectory(), "Parent directory must already exist");
  }
  if (mustExist)
    requireThat(stat(path)?.isDirectory(), "Source directory does not exist");
  else
    requireThat(
      !stat(path),
      "Destination must be a new, nonexistent directory",
    );
  return path;
}

function separatePaths(source, target) {
  const contains = (a, b) => {
    const suffix = relative(a, b);
    return (
      !suffix ||
      (!suffix.startsWith(`..${sep}`) && suffix !== ".." && !isAbsolute(suffix))
    );
  };
  requireThat(
    !contains(source, target) && !contains(target, source),
    "Source and destination must not overlap",
  );
}

function regularFile(path) {
  const info = lstatSync(path);
  requireThat(
    info.isFile() && info.nlink === 1,
    "Only regular, non-linked files are allowed",
  );
  return info;
}

function fingerprint(path) {
  regularFile(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
      bytes += count;
    }
    const after = fstatSync(fd);
    requireThat(
      bytes === before.size &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs,
      "File changed while reading; keep the server stopped",
    );
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    closeSync(fd);
  }
}

function validateState(state) {
  requireThat(object(state), "Invalid aggregate state");
  for (const key of [
    "users",
    "boxes",
    "matches",
    "videos",
    "sessions",
    "ratings",
    "games",
    "rewards",
    "points",
  ])
    requireThat(object(state[key]), `Invalid state field: ${key}`);
  for (const key of ["joins", "ledger", "notifications"])
    requireThat(Array.isArray(state[key]), `Invalid state field: ${key}`);
  requireThat(
    Number.isSafeInteger(state.nextFinalOrder) && state.nextFinalOrder >= 1,
    "Invalid final order counter",
  );
  for (const [id, video] of Object.entries(state.videos)) {
    requireThat(
      safeName(id) && object(video) && video.id === id,
      "Invalid video reference",
    );
    requireThat(
      Number.isSafeInteger(video.size) && video.size >= 0,
      "Invalid video byte count",
    );
  }
  for (const match of Object.values(state.matches)) {
    for (const submission of Object.values(match.submissions || {}))
      requireThat(
        safeName(submission.videoId) &&
          Object.hasOwn(state.videos, submission.videoId),
        "Missing submission video reference",
      );
  }
  return state;
}

function inspectDatabase(path, snapshot = false) {
  regularFile(path);
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = stat(path + suffix);
    if (sidecar) {
      requireThat(
        !snapshot,
        "Backup database must be standalone (no journal/WAL sidecars)",
      );
      regularFile(path + suffix);
    }
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    requireThat(
      db.prepare("PRAGMA integrity_check").get().integrity_check === "ok",
      "SQLite integrity check failed",
    );
    const rows = db.prepare("SELECT id, data FROM state").all();
    requireThat(
      rows.length === 1 && rows[0].id === 1,
      "Expected aggregate state row id=1",
    );
    return validateState(parseJson(rows[0].data, "aggregate state"));
  } finally {
    db.close();
  }
}

function uploadFiles(directory) {
  const uploads = join(directory, "uploads");
  requireThat(
    stat(uploads)?.isDirectory() && !stat(uploads).isSymbolicLink(),
    "uploads must be a real directory",
  );
  return readdirSync(uploads)
    .sort()
    .map((name) => {
      requireThat(safeName(name), "Invalid upload filename");
      regularFile(join(uploads, name));
      return `uploads/${name}`;
    });
}

function checkReferences(state, entries) {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const [id, video] of Object.entries(state.videos)) {
    requireThat(
      byPath.get(`uploads/${id}`)?.bytes === video.size,
      "Referenced video missing or byte count differs",
    );
  }
}

function privateFile(path, body = "") {
  writeFileSync(path, body, { flag: "wx", mode: 0o600 });
}

function syncFile(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fchmodSync(fd, 0o600);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function copyPrivate(source, target) {
  regularFile(source);
  copyFileSync(source, target, constants.COPYFILE_EXCL);
  syncFile(target);
}

function destination(source, target, execute, serverStopped) {
  const result = safePath(target, false);
  separatePaths(source, result);
  requireThat(
    !execute || serverStopped === true,
    "Execution requires --server-stopped acknowledgment",
  );
  return result;
}

export function verifyBackup({ source }) {
  const directory = safePath(source);
  const manifestPath = join(directory, "manifest.json");
  regularFile(manifestPath);
  const manifest = parseJson(readFileSync(manifestPath, "utf8"), "manifest");
  requireThat(
    object(manifest) &&
      manifest.format === FORMAT &&
      Array.isArray(manifest.files),
    "Unsupported or incomplete backup manifest",
  );
  const allowed = new Set([DATABASE, "uploads", "manifest.json"]);
  requireThat(
    readdirSync(directory).every((name) => allowed.has(name)),
    "Unexpected backup root entry",
  );
  const actualPaths = [DATABASE, ...uploadFiles(directory)].sort();
  const seen = new Set();
  for (const entry of manifest.files) {
    requireThat(
      object(entry) &&
        typeof entry.path === "string" &&
        (entry.path === DATABASE ||
          (entry.path.startsWith("uploads/") && safeName(entry.path.slice(8)))),
      "Unsafe manifest path",
    );
    requireThat(!seen.has(entry.path), "Duplicate manifest path");
    seen.add(entry.path);
    requireThat(
      Number.isSafeInteger(entry.bytes) &&
        entry.bytes >= 0 &&
        /^[a-f0-9]{64}$/.test(entry.sha256),
      "Invalid manifest checksum entry",
    );
    const actual = fingerprint(join(directory, entry.path));
    requireThat(
      actual.bytes === entry.bytes && actual.sha256 === entry.sha256,
      `Checksum mismatch: ${entry.path}`,
    );
  }
  requireThat(
    JSON.stringify([...seen].sort()) === JSON.stringify(actualPaths),
    "Manifest file set differs from backup",
  );
  const state = inspectDatabase(join(directory, DATABASE), true);
  checkReferences(state, manifest.files);
  return { directory, manifest, state };
}

export function backupData({
  source,
  target,
  execute = false,
  serverStopped = false,
}) {
  const directory = safePath(source);
  const output = destination(directory, target, execute, serverStopped);
  const state = inspectDatabase(join(directory, DATABASE));
  const uploads = uploadFiles(directory);
  checkReferences(
    state,
    uploads.map((path) => ({
      path,
      bytes: regularFile(join(directory, path)).size,
    })),
  );
  if (!execute)
    return {
      action: "backup",
      dryRun: true,
      target: output,
      uploadFiles: uploads.length,
    };
  mkdirSync(output, { mode: 0o700 });
  mkdirSync(join(output, "uploads"), { mode: 0o700 });
  // The private target is exclusively created. SQLite accepts an existing empty output file.
  privateFile(join(output, DATABASE));
  const db = new DatabaseSync(join(directory, DATABASE), { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(join(output, DATABASE));
  } finally {
    db.close();
  }
  syncFile(join(output, DATABASE));
  for (const path of uploads) {
    const before = fingerprint(join(directory, path));
    copyPrivate(join(directory, path), join(output, path));
    requireThat(
      JSON.stringify(before) ===
        JSON.stringify(fingerprint(join(output, path))),
      "Upload changed while copying; keep server stopped",
    );
  }
  const files = [DATABASE, ...uploads].map((path) => ({
    path,
    ...fingerprint(join(output, path)),
  }));
  const snapshotState = inspectDatabase(join(output, DATABASE), true);
  requireThat(
    JSON.stringify(snapshotState) === JSON.stringify(state),
    "State changed during backup; keep server stopped",
  );
  checkReferences(snapshotState, files);
  privateFile(
    join(output, "manifest.json"),
    JSON.stringify(
      { format: FORMAT, createdAt: new Date().toISOString(), files },
      null,
      2,
    ) + "\n",
  );
  syncFile(join(output, "manifest.json"));
  verifyBackup({ source: output });
  return {
    action: "backup",
    dryRun: false,
    target: output,
    files: files.length,
  };
}

export function restoreData({
  source,
  target,
  execute = false,
  serverStopped = false,
}) {
  const { directory, manifest, state } = verifyBackup({ source });
  const output = destination(directory, target, execute, serverStopped);
  if (!execute)
    return {
      action: "restore",
      dryRun: true,
      target: output,
      sessionsInvalidated: Object.keys(state.sessions).length,
    };
  mkdirSync(output, { mode: 0o700 });
  mkdirSync(join(output, "uploads"), { mode: 0o700 });
  for (const entry of manifest.files) {
    const path = join(output, entry.path);
    copyPrivate(join(directory, entry.path), path);
    const actual = fingerprint(path);
    requireThat(
      actual.bytes === entry.bytes && actual.sha256 === entry.sha256,
      "Backup changed during restore",
    );
  }
  const sessionsInvalidated = Object.keys(state.sessions).length;
  state.sessions = {};
  const db = new DatabaseSync(join(output, DATABASE));
  try {
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
    db.prepare("UPDATE state SET data=? WHERE id=1").run(JSON.stringify(state));
  } finally {
    db.close();
  }
  syncFile(join(output, DATABASE));
  const restored = inspectDatabase(join(output, DATABASE), true);
  requireThat(
    JSON.stringify(restored) === JSON.stringify(state),
    "Restored state verification failed",
  );
  checkReferences(restored, manifest.files);
  // Written last: without this receipt a directory must be treated as incomplete.
  privateFile(
    join(output, "restore-receipt.json"),
    JSON.stringify(
      {
        format: "wodsiege-restore-v1",
        restoredAt: new Date().toISOString(),
        sessionsInvalidated,
        database: fingerprint(join(output, DATABASE)),
      },
      null,
      2,
    ) + "\n",
  );
  syncFile(join(output, "restore-receipt.json"));
  return {
    action: "restore",
    dryRun: false,
    target: output,
    sessionsInvalidated,
  };
}

export function runCli(args) {
  const [action, ...rest] = args;
  if (!action || action === "--help")
    return "Usage: node scripts/data-backup.mjs backup|verify|restore --source PATH [--target NEW_PATH] [--execute --server-stopped]\nbackup/restore default to dry-run. Stop all writers before execution. verify is read-only.";
  requireThat(
    ["backup", "verify", "restore"].includes(action),
    "Unknown action",
  );
  const options = {};
  const flags = new Set();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    requireThat(!flags.has(flag), "Duplicate option");
    flags.add(flag);
    if (flag === "--source" || flag === "--target") {
      requireThat(
        rest[i + 1] && !rest[i + 1].startsWith("--"),
        "Missing path value",
      );
      options[flag.slice(2)] = rest[++i];
    } else if (flag === "--execute") options.execute = true;
    else if (flag === "--server-stopped") options.serverStopped = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (action === "verify") {
    requireThat(
      flags.size === 1 && flags.has("--source"),
      "verify accepts only --source",
    );
    const { manifest } = verifyBackup(options);
    return { action: "verify", ok: true, files: manifest.files.length };
  }
  return action === "backup" ? backupData(options) : restoreData(options);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(runCli(process.argv.slice(2)));
  } catch (error) {
    console.error(
      `Backup/restore failed: ${error.message}. Any newly created target may be incomplete; do not activate it.`,
    );
    process.exitCode = 1;
  }
}
