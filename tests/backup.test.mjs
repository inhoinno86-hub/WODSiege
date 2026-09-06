import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  backupData,
  restoreData,
  verifyBackup,
  runCli,
} from "../scripts/data-backup.mjs";

function fixture(t, wal = false) {
  const root = mkdtempSync(join(tmpdir(), "wodsiege-backup-test-"));
  const source = join(root, "source");
  const target = join(root, "backup");
  mkdirSync(source);
  mkdirSync(join(source, "uploads"));
  const video = Buffer.from("fixture-video-bytes");
  writeFileSync(join(source, "uploads", "video-1"), video);
  // Preserve orphan uploads as well: there is no implicit data-deletion policy.
  writeFileSync(join(source, "uploads", "orphan-1"), "orphan");
  const state = {
    users: { user1: { id: "user1", hash: "private-password-hash" } },
    boxes: {},
    matches: { m1: { submissions: { box1: { videoId: "video-1" } } } },
    videos: { "video-1": { id: "video-1", size: video.length } },
    sessions: { "private-session-hash": { userId: "user1", expires: 12345 } },
    joins: [],
    ledger: [{ delta: 20 }],
    notifications: [],
    ratings: {},
    games: { user1: 3 },
    rewards: {},
    points: {},
    nextFinalOrder: 2,
  };
  const db = new DatabaseSync(join(source, "wodsiege.sqlite"));
  db.exec(
    "CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)",
  );
  if (wal) db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
  db.prepare("INSERT INTO state VALUES(1, ?)").run(JSON.stringify(state));
  if (!wal) db.close();
  t.after(() => {
    if (wal) db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, source, target, state, video };
}

function backup(f) {
  return backupData({
    source: f.source,
    target: f.target,
    execute: true,
    serverStopped: true,
  });
}

function changeManifest(target, change) {
  const path = join(target, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  change(manifest);
  writeFileSync(path, JSON.stringify(manifest));
}

test("backup/restore default to dry-run; executing requires explicit stopped-server acknowledgment", (t) => {
  const f = fixture(t);
  assert.equal(backupData(f).dryRun, true);
  assert.equal(existsSync(f.target), false);
  assert.throws(() => backupData({ ...f, execute: true }), /server-stopped/);
  backup(f);
  const target = join(f.root, "restore");
  assert.equal(restoreData({ source: f.target, target }).dryRun, true);
  assert.equal(existsSync(target), false);
  assert.throws(
    () => restoreData({ source: f.target, target, execute: true }),
    /server-stopped/,
  );
});

test("real SQLite backup verifies and restores records/uploads while invalidating sessions", (t) => {
  const f = fixture(t);
  backup(f);
  const verified = verifyBackup({ source: f.target });
  assert.deepEqual(verified.state, f.state);
  assert.equal(verified.manifest.files.length, 3);
  assert.equal(statSync(f.target).mode & 0o777, 0o700);
  for (const entry of verified.manifest.files)
    assert.equal(statSync(join(f.target, entry.path)).mode & 0o777, 0o600);
  assert.equal(statSync(join(f.target, "manifest.json")).mode & 0o777, 0o600);
  const target = join(f.root, "restored");
  const result = restoreData({
    source: f.target,
    target,
    execute: true,
    serverStopped: true,
  });
  assert.equal(result.sessionsInvalidated, 1);
  const db = new DatabaseSync(join(target, "wodsiege.sqlite"), {
    readOnly: true,
  });
  const state = JSON.parse(
    db.prepare("SELECT data FROM state WHERE id=1").get().data,
  );
  db.close();
  assert.deepEqual(state, { ...f.state, sessions: {} });
  assert.deepEqual(readFileSync(join(target, "uploads", "video-1")), f.video);
  assert.equal(
    readFileSync(join(target, "uploads", "orphan-1"), "utf8"),
    "orphan",
  );
  assert.equal(existsSync(join(target, "restore-receipt.json")), true);
  assert.deepEqual(
    verifyBackup({ source: f.target }).state.sessions,
    f.state.sessions,
  );
});

test("SQLite snapshot incorporates committed WAL without copying the raw DB alone", (t) => {
  // Keep a quiescent fixture connection open specifically to retain WAL pages.
  const f = fixture(t, true);
  assert.ok(statSync(join(f.source, "wodsiege.sqlite-wal")).size > 0);
  backup(f);
  assert.deepEqual(verifyBackup({ source: f.target }).state, f.state);
  assert.equal(existsSync(join(f.target, "wodsiege.sqlite-wal")), false);
});

test("corrupt bytes and forged checksums block verification and restoration before creating a target", (t) => {
  const f = fixture(t);
  backup(f);
  writeFileSync(join(f.target, "uploads", "video-1"), "corrupt");
  assert.throws(() => verifyBackup({ source: f.target }), /Checksum mismatch/);
  const target = join(f.root, "restore");
  assert.throws(
    () =>
      restoreData({
        source: f.target,
        target,
        execute: true,
        serverStopped: true,
      }),
    /Checksum mismatch/,
  );
  assert.equal(existsSync(target), false);
  writeFileSync(join(f.target, "uploads", "video-1"), f.video);
  changeManifest(f.target, (m) => {
    m.files[0].sha256 = "0".repeat(64);
  });
  assert.throws(() => verifyBackup({ source: f.target }), /Checksum mismatch/);
});

test("manifest paths cannot escape backup and duplicates or unlisted files fail", (t) => {
  const f = fixture(t);
  backup(f);
  const original = readFileSync(join(f.target, "manifest.json"));
  for (const path of [
    "../outside",
    "/etc/passwd",
    "uploads/../outside",
    "uploads/a/b",
    "uploads/a\\b",
  ]) {
    writeFileSync(join(f.target, "manifest.json"), original);
    changeManifest(f.target, (m) => {
      m.files[0].path = path;
    });
    assert.throws(
      () => verifyBackup({ source: f.target }),
      /Unsafe manifest path/,
    );
  }
  writeFileSync(join(f.target, "manifest.json"), original);
  changeManifest(f.target, (m) => m.files.push(m.files[0]));
  assert.throws(
    () => verifyBackup({ source: f.target }),
    /Duplicate manifest path/,
  );
  writeFileSync(join(f.target, "manifest.json"), original);
  writeFileSync(join(f.target, "uploads", "extra"), "extra");
  assert.throws(() => verifyBackup({ source: f.target }), /file set differs/);
});

test("existing destinations, overlap, traversal and symlink source/target ancestors are rejected", (t) => {
  const f = fixture(t);
  assert.throws(
    () => backupData({ source: f.source, target: f.source }),
    /nonexistent/,
  );
  assert.throws(
    () => backupData({ source: f.source, target: join(f.source, "backup") }),
    /overlap/,
  );
  assert.throws(
    () => backupData({ source: f.source, target: `${f.root}/child/../backup` }),
    /traversal/,
  );
  assert.throws(() => backupData({ source: "/", target: f.target }), /Broad/);
  const link = join(f.root, "source-link");
  symlinkSync(f.source, link);
  assert.throws(
    () => backupData({ source: link, target: f.target }),
    /Symlinks/,
  );
  assert.throws(
    () => backupData({ source: f.source, target: join(link, "target") }),
    /Symlinks/,
  );
  backup(f);
  assert.throws(() => backup(f), /nonexistent/);
  assert.throws(
    () =>
      restoreData({
        source: f.target,
        target: f.source,
        execute: true,
        serverStopped: true,
      }),
    /nonexistent/,
  );
});

test("linked upload files and missing referenced binaries fail before backup creation", (t) => {
  const f = fixture(t);
  rmSync(join(f.source, "uploads", "video-1"));
  assert.throws(() => backup(f), /Referenced video missing/);
  assert.equal(existsSync(f.target), false);
  symlinkSync(
    join(f.source, "uploads", "orphan-1"),
    join(f.source, "uploads", "video-1"),
  );
  assert.throws(() => backup(f), /regular, non-linked/);
  assert.equal(existsSync(f.target), false);
});

test("SQLite corruption is rejected even if someone recomputes its manifest checksum", (t) => {
  const f = fixture(t);
  backup(f);
  const bytes = Buffer.from("not a sqlite database");
  writeFileSync(join(f.target, "wodsiege.sqlite"), bytes);
  changeManifest(f.target, (m) => {
    const entry = m.files.find((e) => e.path === "wodsiege.sqlite");
    entry.bytes = bytes.length;
    entry.sha256 = createHash("sha256").update(bytes).digest("hex");
  });
  assert.throws(() => verifyBackup({ source: f.target }), /database/);
});

test("invalid aggregate video ids are rejected", (t) => {
  const f = fixture(t);
  const db = new DatabaseSync(join(f.source, "wodsiege.sqlite"));
  f.state.videos["../outside"] = { id: "../outside", size: 5 };
  db.prepare("UPDATE state SET data=? WHERE id=1").run(JSON.stringify(f.state));
  db.close();
  assert.throws(() => backup(f), /Invalid video reference/);
});

test("CLI validates options, never prints aggregate secrets, and defaults to dry-run", (t) => {
  const f = fixture(t);
  assert.match(runCli([]), /Usage:/);
  assert.throws(() => runCli(["backup", "--wat"]), /Unknown option/);
  assert.throws(
    () => runCli(["backup", "--source", "--execute"]),
    /Missing path/,
  );
  const result = runCli(["backup", "--source", f.source, "--target", f.target]);
  assert.equal(result.dryRun, true);
  backup(f);
  assert.doesNotMatch(
    JSON.stringify(runCli(["verify", "--source", f.target])),
    /private-/,
  );
  assert.throws(
    () => runCli(["verify", "--source", f.target, "--execute"]),
    /only --source/,
  );
});

test("unlisted WAL files and linked manifests are rejected", (t) => {
  const f = fixture(t);
  backup(f);
  writeFileSync(join(f.target, "wodsiege.sqlite-wal"), "unexpected");
  assert.throws(
    () => verifyBackup({ source: f.target }),
    /Unexpected backup root entry/,
  );
  rmSync(join(f.target, "wodsiege.sqlite-wal"));
  const original = readFileSync(join(f.target, "manifest.json"));
  writeFileSync(join(f.root, "manifest-copy.json"), original);
  rmSync(join(f.target, "manifest.json"));
  symlinkSync(
    join(f.root, "manifest-copy.json"),
    join(f.target, "manifest.json"),
  );
  assert.throws(
    () => verifyBackup({ source: f.target }),
    /regular, non-linked/,
  );
});

test("video size metadata and submission references must agree with backup files", (t) => {
  const f = fixture(t);
  const update = () => {
    const db = new DatabaseSync(join(f.source, "wodsiege.sqlite"));
    db.prepare("UPDATE state SET data=? WHERE id=1").run(
      JSON.stringify(f.state),
    );
    db.close();
  };
  f.state.videos["video-1"].size += 1;
  update();
  assert.throws(() => backup(f), /byte count differs/);
  f.state.videos["video-1"].size -= 1;
  f.state.matches.m1.submissions.box1.videoId = "missing";
  update();
  assert.throws(() => backup(f), /Missing submission video reference/);
});

test("malformed state errors never include sensitive JSON fragments", (t) => {
  const f = fixture(t);
  const db = new DatabaseSync(join(f.source, "wodsiege.sqlite"));
  db.prepare("UPDATE state SET data=? WHERE id=1").run(
    "private-password-hash invalid JSON",
  );
  db.close();
  assert.throws(
    () => backup(f),
    (error) => {
      assert.match(error.message, /Invalid aggregate state JSON/);
      assert.doesNotMatch(error.message, /private-password/);
      return true;
    },
  );
});
