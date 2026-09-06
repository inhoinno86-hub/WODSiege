import test from "node:test";
import assert from "node:assert/strict";
import {
  DEVELOPMENT_ORIGINS,
  RuntimeConfigError,
  loadRuntimeConfig,
} from "../server/runtime-config.mjs";
import { runtimeMetadata } from "../server/index.mjs";

const production = (overrides = {}) => ({
  NODE_ENV: "production",
  HOST: "0.0.0.0",
  PORT: "8787",
  WODSIEGE_DATA_DIR: "/var/lib/wodsiege",
  WODSIEGE_PUBLIC_ORIGIN: "https://pilot.wodsiege.app",
  WODSIEGE_OPERATOR_EMAIL_FILE: "/run/secrets/operator_email",
  WODSIEGE_OPERATOR_PASSWORD_FILE: "/run/secrets/operator_password",
  ...overrides,
});

const secrets = (filename) => {
  if (filename.endsWith("operator_email")) return "operator@example.com\n";
  if (filename.endsWith("operator_password")) return "test-only-password\n";
  throw new Error("unexpected path");
};

test("development defaults are loopback-only and do not invent credentials", () => {
  const config = loadRuntimeConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8787);
  assert.equal(config.dataDir, "data");
  assert.equal(config.operatorEmail, undefined);
  assert.equal(config.operatorPassword, undefined);
  assert.equal(config.trustProxy, false);
  assert.deepEqual(config.allowedOrigins, DEVELOPMENT_ORIGINS);
});

test("production reads credentials from files and normalizes exact origins", () => {
  const config = loadRuntimeConfig(
    production({
      WODSIEGE_PUBLIC_ORIGIN: "https://pilot.wodsiege.app/",
      WODSIEGE_ALLOWED_ORIGINS:
        "https://admin.wodsiege.app,https://localhost,https://admin.wodsiege.app/",
    }),
    { reader: secrets },
  );
  assert.equal(config.operatorEmail, "operator@example.com");
  assert.equal(config.operatorPassword, "test-only-password");
  assert.equal(config.publicOrigin, "https://pilot.wodsiege.app");
  assert.equal(config.trustProxy, 1);
  assert.deepEqual(config.allowedOrigins, [
    "https://localhost",
    "https://admin.wodsiege.app",
    "https://pilot.wodsiege.app",
  ]);
});

test("production refuses missing safety-critical configuration", () => {
  for (const [name, env] of [
    ["public origin", production({ WODSIEGE_PUBLIC_ORIGIN: undefined })],
    ["absolute data path", production({ WODSIEGE_DATA_DIR: "data" })],
    ["proxy-reachable host", production({ HOST: "127.0.0.1" })],
    [
      "secret-file credentials",
      production({
        WODSIEGE_OPERATOR_PASSWORD_FILE: undefined,
        WODSIEGE_OPERATOR_PASSWORD: "do-not-log-this",
      }),
    ],
  ]) {
    assert.throws(
      () => loadRuntimeConfig(env, { reader: secrets }),
      RuntimeConfigError,
      name,
    );
  }
});

test("ports, origins, and secret inputs are strictly validated", () => {
  for (const overrides of [
    { PORT: "0" },
    { PORT: "8787x" },
    { WODSIEGE_PUBLIC_ORIGIN: "http://pilot.example.com" },
    { WODSIEGE_PUBLIC_ORIGIN: "https://pilot.example.com" },
    { WODSIEGE_PUBLIC_ORIGIN: "https://192.0.2.1" },
    { WODSIEGE_PUBLIC_ORIGIN: "https://[::1]" },
    { WODSIEGE_PUBLIC_ORIGIN: "https://user:pass@pilot.example.com" },
    { WODSIEGE_PUBLIC_ORIGIN: "https://pilot.example.com/api" },
    { WODSIEGE_ALLOWED_ORIGINS: "*" },
    { WODSIEGE_ALLOWED_ORIGINS: "https://admin.wodsiege.app," },
    { WODSIEGE_OPERATOR_EMAIL: "operator@example.com" },
    { WODSIEGE_OPERATOR_PASSWORD_FILE: "relative/password.txt" },
  ])
    assert.throws(
      () => loadRuntimeConfig(production(overrides), { reader: secrets }),
      RuntimeConfigError,
    );

  assert.throws(
    () =>
      loadRuntimeConfig(production(), {
        reader: (filename) =>
          filename.endsWith("operator_email")
            ? "operator@example.com\nsecond-line"
            : "test-only-password",
      }),
    RuntimeConfigError,
  );
});

test("configuration errors never include supplied credential values", () => {
  const password = "highly-sensitive-test-value";
  assert.throws(
    () =>
      loadRuntimeConfig(
        production({
          WODSIEGE_OPERATOR_PASSWORD_FILE: undefined,
          WODSIEGE_OPERATOR_PASSWORD: password,
        }),
        { reader: secrets },
      ),
    (error) =>
      error instanceof RuntimeConfigError && !error.message.includes(password),
  );
});

test("server runtime metadata never retains or serializes credentials", () => {
  const email = "operator@private.test";
  const password = "highly-sensitive-test-value";
  const metadata = runtimeMetadata(
    loadRuntimeConfig({
      WODSIEGE_OPERATOR_EMAIL: email,
      WODSIEGE_OPERATOR_PASSWORD: password,
    }),
  );
  assert.equal(Object.hasOwn(metadata, "operatorEmail"), false);
  assert.equal(Object.hasOwn(metadata, "operatorPassword"), false);
  assert.doesNotMatch(
    JSON.stringify(metadata),
    new RegExp(`${email}|${password}`),
  );
});
