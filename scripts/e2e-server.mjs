// Test-only harness. Never imported by the production entry point.
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../server/app.mjs";

const host = "127.0.0.1";
const port = 4173;
const secret = "wodsiege-loopback-e2e-only";
const app = express();
let service;
let directory;
let timestamp;

function reset() {
  service?.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = mkdtempSync(join(tmpdir(), "wodsiege-browser-test-"));
  timestamp = Date.parse("2026-09-06T00:00:00Z");
  service = createApp({
    dataDir: directory,
    clock: () => new Date(timestamp),
    operatorEmail: "operator@e2e.local",
    operatorPassword: "browser-test-password-123",
  });
}

app.use(
  "/__e2e",
  (req, res, next) => {
    const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress,
    );
    const origin = req.get("origin");
    if (
      !loopback ||
      req.get("host") !== `${host}:${port}` ||
      (origin && origin !== `http://${host}:${port}`) ||
      req.get("x-wodsiege-e2e") !== secret
    )
      return res.sendStatus(403);
    next();
  },
  express.json({ limit: "1kb" }),
);
app.post("/__e2e/reset", (_req, res) => {
  reset();
  res.json({ now: timestamp });
});
app.post("/__e2e/clock", (req, res) => {
  const value = Number(req.body.now);
  if (
    !Number.isSafeInteger(value) ||
    value < timestamp ||
    value > timestamp + 7 * 86400000
  )
    return res.status(400).json({ error: "Invalid test clock" });
  timestamp = value;
  res.json({ now: timestamp });
});
app.use((req, res, next) =>
  req.path.startsWith("/api/") ? service.app(req, res, next) : next(),
);
app.use(express.static(resolve("dist")));
app.get("/", (_req, res) => res.sendFile(resolve("dist/index.html")));
reset();
const listener = app.listen(port, host, () =>
  console.log(`Isolated E2E server http://${host}:${port}`),
);
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  listener.close(() => {
    service.close();
    rmSync(directory, { recursive: true, force: true });
    process.exit(0);
  });
  listener.closeAllConnections();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
