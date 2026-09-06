import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.mjs";

async function service(t, config = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "wodsiege-ingress-"));
  const instance = createApp({ dataDir, ...config });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    instance.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    app: instance.app,
  };
}

test("explicit ingress origins allow native HTTPS and reject disallowed requests before mutation", async (t) => {
  const { url } = await service(t, { allowedOrigins: ["https://localhost"] });
  const allowed = await fetch(`${url}/api/health`, {
    headers: { Origin: "https://localhost" },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://localhost");
  assert.match(allowed.headers.get("vary"), /Origin/);
  assert.equal(allowed.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
  for (const origin of ["https://hostile.example", "http://localhost", "null"]) {
    const preflight = await fetch(`${url}/api/auth/register`, {
      method: "OPTIONS", headers: { Origin: origin },
    });
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
    const request = await fetch(`${url}/api/auth/register`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test", email: "ingress@test.local", password: "test-only-password" }),
    });
    assert.equal(request.status, 403);
  }
  // Reusing the same email succeeds: rejected requests did not create a user.
  const register = await fetch(`${url}/api/auth/register`, {
    method: "POST",
    headers: { Origin: "https://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "test", email: "ingress@test.local", password: "test-only-password" }),
  });
  assert.equal(register.status, 201);
});

test("development defaults retain browser origins and ignore spoofed forwarding headers", async (t) => {
  const { url, app } = await service(t);
  assert.equal(app.get("trust proxy"), false);
  app.get("/test-ip", (req, res) => res.json({ ip: req.ip }));
  const response = await fetch(`${url}/test-ip`, {
    headers: { Origin: "http://127.0.0.1:5173", "X-Forwarded-For": "198.51.100.7" },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ip, "127.0.0.1");
});

test("one-hop private proxy uses the nearest forwarded client, not a spoofed leftmost address", async (t) => {
  const { url, app } = await service(t, { trustProxy: 1 });
  app.get("/test-ip", (req, res) => res.json({ ip: req.ip }));
  const response = await fetch(`${url}/test-ip`, {
    headers: { "X-Forwarded-For": "198.51.100.7, 192.0.2.5" },
  });
  assert.equal((await response.json()).ip, "192.0.2.5");
});
