import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.mjs";
import { rotateOperatorPassword, runRotationCli } from "../scripts/operator-password.mjs";

const oldPassword = "old-test-password-only";
const newPassword = "new-test-password-only";
const email = "operator@test.local";

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "wodsiege-rotate-"));
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { mode: 0o700 });
  const emailFile = join(dir, "email.txt");
  const passwordFile = join(dir, "password.txt");
  writeFileSync(emailFile, email, { mode: 0o600 });
  writeFileSync(passwordFile, newPassword, { mode: 0o600 });
  let service, listener, url;
  async function start() {
    service = createApp({ dataDir, operatorEmail: email, operatorPassword: oldPassword });
    listener = service.app.listen(0, "127.0.0.1");
    await new Promise(resolve => listener.once("listening", resolve));
    url = `http://127.0.0.1:${listener.address().port}/api`;
  }
  async function stop() {
    if (!listener) return;
    await new Promise(resolve => listener.close(resolve));
    service.close();
    listener = null;
  }
  async function request(path, body, token) {
    const response = await fetch(url + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  t.after(async () => { await stop(); rmSync(dir, { recursive: true, force: true }); });
  await start();
  return { options: { dataDir, emailFile, passwordFile }, start, stop, request };
}

test("offline operator rotation revokes old password and only that operator's sessions", async t => {
  const f = await fixture(t);
  const operator = await f.request("/auth/login", { email, password: oldPassword });
  const athlete = await f.request("/auth/register", { name: "test-athlete", email: "athlete@test.local", password: oldPassword });
  await f.stop();
  const preview = rotateOperatorPassword(f.options);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.sessionsToInvalidate, 1);
  assert.throws(() => rotateOperatorPassword({ ...f.options, execute: true }), /server-stopped/);
  const result = rotateOperatorPassword({ ...f.options, execute: true, serverStopped: true });
  assert.equal(result.sessionsInvalidated, 1);
  assert.ok(result.changedAt);
  assert.ok(!JSON.stringify(result).includes(email) && !JSON.stringify(result).includes(newPassword));
  await f.start();
  assert.equal((await f.request("/auth/login", { email, password: oldPassword })).status, 401);
  assert.equal((await f.request("/state", undefined, operator.body.token)).status, 401);
  assert.equal((await f.request("/auth/login", { email, password: newPassword })).status, 200);
  assert.equal((await f.request("/state", undefined, athlete.body.token)).status, 200);
});

test("rotation preview leaves credentials valid, and unknown/athlete targets cannot be promoted", async t => {
  const f = await fixture(t);
  await f.request("/auth/register", { name: "test-athlete", email: "athlete@test.local", password: oldPassword });
  await f.stop();
  rotateOperatorPassword(f.options);
  for (const value of ["missing@test.local", "athlete@test.local"]) {
    writeFileSync(f.options.emailFile, value);
    assert.throws(() => rotateOperatorPassword({ ...f.options, execute: true, serverStopped: true }), /existing operator/);
  }
  await f.start();
  assert.equal((await f.request("/auth/login", { email, password: oldPassword })).status, 200);
});

test("rotation matches login password normalization and rejects whitespace-padded short secrets", async t => {
  const f = await fixture(t);
  await f.stop();
  for (const value of ["          ", "    short    "]) {
    writeFileSync(f.options.passwordFile, value);
    assert.throws(() => rotateOperatorPassword({ ...f.options, execute: true, serverStopped: true }), /10 and 200/);
  }
  await f.start();
  assert.equal((await f.request("/auth/login", { email, password: oldPassword })).status, 200);
  await f.stop();
  writeFileSync(f.options.passwordFile, `  ${newPassword}  \r\n`);
  rotateOperatorPassword({ ...f.options, execute: true, serverStopped: true });
  await f.start();
  assert.equal((await f.request("/auth/login", { email, password: newPassword })).status, 200);
  assert.equal((await f.request("/auth/login", { email, password: `  ${newPassword}  ` })).status, 200);
  assert.equal((await f.request("/auth/login", { email, password: oldPassword })).status, 401);
});

test("rotation rejects insecure secret files, short passwords, unknown or duplicate CLI flags", async t => {
  const f = await fixture(t);
  await f.stop();
  chmodSync(f.options.passwordFile, 0o644);
  assert.throws(() => rotateOperatorPassword(f.options), /group\/other/);
  chmodSync(f.options.passwordFile, 0o600);
  writeFileSync(f.options.passwordFile, "short");
  assert.throws(() => rotateOperatorPassword(f.options), /10 and 200/);
  assert.throws(() => runRotationCli(["--password", "do-not-print-this"]), error => !error.message.includes("do-not-print-this"));
  assert.throws(() => runRotationCli(["--execute", "--execute"]), /Duplicate/);
});
