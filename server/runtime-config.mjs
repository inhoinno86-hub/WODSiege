import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";

export const NATIVE_ORIGINS = ["https://localhost"];
export const DEVELOPMENT_ORIGINS = [
  ...NATIVE_ORIGINS,
  "http://localhost",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
];

export class RuntimeConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "RuntimeConfigError";
  }
}

function fail(message) {
  throw new RuntimeConfigError(message);
}

function integer(value, fallback, name, minimum, maximum) {
  const raw = value === undefined || value === "" ? String(fallback) : value;
  if (!/^\d+$/.test(raw)) fail(`${name} must be an integer.`);
  const parsed = Number(raw);
  if (parsed < minimum || parsed > maximum)
    fail(`${name} must be between ${minimum} and ${maximum}.`);
  return parsed;
}

function host(value) {
  const parsed = value || "127.0.0.1";
  if (
    parsed.includes("/") ||
    parsed.includes("@") ||
    (!isIP(parsed) &&
      !/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/.test(
        parsed,
      ))
  )
    fail(
      "HOST must be an IP address or hostname without a URL scheme or port.",
    );
  return parsed;
}

function origin(value, name, production) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be an absolute http(s) origin.`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    value.includes("*")
  )
    fail(
      `${name} must be an exact http(s) origin without credentials, path, query, fragment, or wildcard.`,
    );
  const normalized = parsed.origin;
  if (production && parsed.protocol !== "https:")
    fail(`${name} must use HTTPS in production.`);
  const originHost = parsed.hostname.replace(/^\[|\]$/g, "");
  if (
    production &&
    name === "WODSIEGE_PUBLIC_ORIGIN" &&
    (isIP(originHost) ||
      /(^|\.)(?:localhost|local|test|invalid|example)$/.test(originHost) ||
      /(^|\.)example\.(?:com|net|org)$/.test(originHost))
  )
    fail(
      "WODSIEGE_PUBLIC_ORIGIN must use a real public DNS hostname in production.",
    );
  return normalized;
}

function secret(env, name, production, reader) {
  const direct = env[name];
  const filename = env[`${name}_FILE`];
  if (direct && filename) fail(`Set only one of ${name} or ${name}_FILE.`);
  if (production && direct)
    fail(`${name} must be supplied through ${name}_FILE in production.`);
  if (!filename) return direct;
  if (production && !isAbsolute(filename))
    fail(`${name}_FILE must be an absolute path in production.`);
  let value;
  try {
    value = reader(filename, "utf8").replace(/\r?\n$/, "");
  } catch {
    fail(`Could not read ${name}_FILE.`);
  }
  if (!value || /[\0\r\n]/.test(value))
    fail(`${name}_FILE must contain exactly one non-empty line.`);
  return value;
}

export function loadRuntimeConfig(
  env = process.env,
  { reader = readFileSync } = {},
) {
  const nodeEnv = env.NODE_ENV || "development";
  if (!["development", "test", "production"].includes(nodeEnv))
    fail("NODE_ENV must be development, test, or production.");
  const production = nodeEnv === "production";
  const listenHost = host(env.HOST);
  if (production && ["127.0.0.1", "::1", "localhost"].includes(listenHost))
    fail("HOST must be reachable by the reverse proxy in production.");

  const dataDir = env.WODSIEGE_DATA_DIR || "data";
  if (!dataDir.trim() || dataDir.includes("\0"))
    fail("WODSIEGE_DATA_DIR must be a non-empty path.");
  if (production && !isAbsolute(dataDir))
    fail("WODSIEGE_DATA_DIR must be an absolute path in production.");

  const publicOrigin = env.WODSIEGE_PUBLIC_ORIGIN
    ? origin(env.WODSIEGE_PUBLIC_ORIGIN, "WODSIEGE_PUBLIC_ORIGIN", production)
    : undefined;
  if (production && !publicOrigin)
    fail("WODSIEGE_PUBLIC_ORIGIN is required in production.");

  const configuredOrigins = env.WODSIEGE_ALLOWED_ORIGINS
    ? env.WODSIEGE_ALLOWED_ORIGINS.split(",").map((value, index) => {
        const trimmed = value.trim();
        if (!trimmed)
          fail(`WODSIEGE_ALLOWED_ORIGINS entry ${index + 1} is empty.`);
        return origin(trimmed, "WODSIEGE_ALLOWED_ORIGINS", production);
      })
    : [];
  const allowedOrigins = [
    ...(production ? NATIVE_ORIGINS : DEVELOPMENT_ORIGINS),
    ...configuredOrigins,
    ...(publicOrigin ? [publicOrigin] : []),
  ];

  const operatorEmail = secret(
    env,
    "WODSIEGE_OPERATOR_EMAIL",
    production,
    reader,
  );
  const operatorPassword = secret(
    env,
    "WODSIEGE_OPERATOR_PASSWORD",
    production,
    reader,
  );
  if (Boolean(operatorEmail) !== Boolean(operatorPassword))
    fail("Operator email and password must both be configured.");
  if (production && !operatorEmail)
    fail(
      "Operator credentials are required through secret files in production.",
    );

  return {
    nodeEnv,
    production,
    host: listenHost,
    port: integer(env.PORT, 8787, "PORT", 1, 65535),
    dataDir,
    publicOrigin,
    allowedOrigins: [...new Set(allowedOrigins)],
    operatorEmail,
    operatorPassword,
    trustProxy: production ? 1 : false,
    shutdownTimeoutMs: integer(
      env.WODSIEGE_SHUTDOWN_TIMEOUT_MS,
      10000,
      "WODSIEGE_SHUTDOWN_TIMEOUT_MS",
      1000,
      60000,
    ),
  };
}
