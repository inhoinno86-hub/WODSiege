import { lstatSync, readFileSync } from "node:fs";
import { join, parse, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { randomBytes, scryptSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function regularPath(input, kind) {
  requireThat(typeof input === "string" && input.trim() && !input.includes("\0"), "Explicit paths are required");
  requireThat(!input.split(/[\\/]/).includes(".."), "Path traversal is not allowed");
  const target = resolve(input);
  requireThat(![parse(target).root, homedir(), process.cwd()].includes(target), "Broad paths are not allowed");
  let current = parse(target).root;
  for (const segment of target.slice(current.length).split(sep)) {
    current = join(current, segment);
    const info = lstatSync(current);
    requireThat(!info.isSymbolicLink(), "Linked paths are not allowed");
    if (current !== target || kind === "directory") requireThat(info.isDirectory(), "Expected an existing directory");
    else requireThat(info.isFile() && info.nlink === 1, "Expected a regular, non-linked file");
  }
  return target;
}

function secretLine(path) {
  const target = regularPath(path, "file");
  const info = lstatSync(target);
  requireThat((info.mode & 0o077) === 0, "Secret files must not allow group/other access");
  requireThat(info.size > 0 && info.size <= 4096, "Secret file size is invalid");
  const value = readFileSync(target, "utf8").replace(/\r?\n$/, "");
  requireThat(value && !/[\0\r\n]/.test(value), "Secret files must contain one non-empty line");
  return value;
}

export function rotateOperatorPassword({ dataDir, emailFile, passwordFile, execute = false, serverStopped = false }) {
  requireThat(!execute || serverStopped === true, "Execution requires --server-stopped acknowledgment");
  const directory = regularPath(dataDir, "directory");
  const database = regularPath(join(directory, "wodsiege.sqlite"), "file");
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try { regularPath(database + suffix, "file"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const email = secretLine(emailFile).trim().toLowerCase();
  // Match the existing registration/login API's string normalization.
  const password = secretLine(passwordFile).trim();
  requireThat(email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Operator email format is invalid");
  requireThat(password.length >= 10 && password.length <= 200, "Password must be between 10 and 200 characters");
  const db = new DatabaseSync(database, { readOnly: !execute });
  let transaction = false;
  try {
    db.exec("PRAGMA busy_timeout=5000");
    if (execute) { db.exec("BEGIN IMMEDIATE"); transaction = true; }
    const row = db.prepare("SELECT data FROM state WHERE id=1").get();
    let state;
    try { state = JSON.parse(row?.data); }
    catch { throw new Error("Invalid database state; no credential changed"); }
    requireThat(state && state.users && state.sessions && typeof state.users === "object" && !Array.isArray(state.users) && typeof state.sessions === "object" && !Array.isArray(state.sessions), "Invalid account/session state");
    const accounts = Object.values(state.users).filter(user => user?.email === email);
    requireThat(accounts.length === 1 && accounts[0].role === "operator", "Exactly one existing operator account is required; no account created or promoted");
    const user = accounts[0];
    const sessionIds = Object.keys(state.sessions).filter(id => state.sessions[id]?.userId === user.id);
    if (!execute) return { action: "rotate-operator-password", dryRun: true, sessionsToInvalidate: sessionIds.length };
    const salt = randomBytes(16).toString("hex");
    user.hash = salt + ":" + scryptSync(password, salt, 64).toString("hex");
    user.credentialUpdatedAt = new Date().toISOString();
    for (const id of sessionIds) delete state.sessions[id];
    db.prepare("UPDATE state SET data=? WHERE id=1").run(JSON.stringify(state));
    db.exec("COMMIT");
    transaction = false;
    return { action: "rotate-operator-password", dryRun: false, sessionsInvalidated: sessionIds.length, changedAt: user.credentialUpdatedAt };
  } finally {
    if (transaction) db.exec("ROLLBACK");
    db.close();
  }
}

export function runRotationCli(args) {
  if (!args.length || args.includes("--help")) return "Usage: node scripts/operator-password.mjs --data-dir DIR --email-file PRIVATE_FILE --password-file PRIVATE_FILE [--execute --server-stopped]\nDefault dry-run. Stop all API writers before executing. Never supply secrets as arguments.";
  const options = {};
  const seen = new Set();
  const paths = { "--data-dir": "dataDir", "--email-file": "emailFile", "--password-file": "passwordFile" };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    requireThat(!seen.has(flag), "Duplicate argument");
    seen.add(flag);
    if (Object.hasOwn(paths, flag)) {
      requireThat(args[i + 1] && !args[i + 1].startsWith("--"), "Missing path argument");
      options[paths[flag]] = args[++i];
    } else if (flag === "--execute") options.execute = true;
    else if (flag === "--server-stopped") options.serverStopped = true;
    else throw new Error("Unknown argument; use --help");
  }
  return rotateOperatorPassword(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(runRotationCli(process.argv.slice(2))); }
  catch {
    // Do not print arbitrary filesystem/parser errors containing secret material.
    console.error("Operator rotation failed. Check private file permissions, paths, account role and stopped-server flags; no credentials are printed.");
    process.exitCode = 1;
  }
}
