import { createApp } from "./app.mjs";
import { loadRuntimeConfig } from "./runtime-config.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function runtimeMetadata({
  operatorEmail: _operatorEmail,
  operatorPassword: _operatorPassword,
  ...metadata
}) {
  return metadata;
}

export function startServer(env = process.env) {
  const runtime = loadRuntimeConfig(env);
  const config = runtimeMetadata(runtime);
  const { app, close } = createApp({
    dataDir: config.dataDir,
    operatorEmail: runtime.operatorEmail,
    operatorPassword: runtime.operatorPassword,
    allowedOrigins: config.allowedOrigins,
    trustProxy: config.trustProxy,
  });
  delete runtime.operatorEmail;
  delete runtime.operatorPassword;
  const server = app.listen(config.port, config.host, () => {
    const endpoint =
      config.publicOrigin || `http://${config.host}:${config.port}`;
    console.log(`WODSiege pilot API listening at ${endpoint}`);
  });
  let stopping = false;
  const stop = (signal = "shutdown") => {
    if (stopping) return;
    stopping = true;
    console.log(`WODSiege pilot API stopping (${signal})`);
    const force = setTimeout(() => {
      console.error("WODSiege pilot API forced remaining connections closed");
      server.closeAllConnections();
    }, config.shutdownTimeoutMs);
    force.unref();
    server.close((error) => {
      clearTimeout(force);
      try {
        close();
      } catch (closeError) {
        console.error("WODSiege database close failed:", closeError.message);
        process.exitCode = 1;
      }
      if (error) {
        console.error("WODSiege HTTP close failed:", error.message);
        process.exitCode = 1;
      }
    });
  };
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => stop(signal));
  return { server, stop, config };
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    startServer();
  } catch (error) {
    console.error(`WODSiege API failed to start: ${error.message}`);
    process.exitCode = 1;
  }
}
