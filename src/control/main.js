"use strict";

const { readConfig } = require("../config");
const { createLogger } = require("../logger");
const { readControlConfig } = require("./config");
const { createControlServer } = require("./server");
const { createControlService } = require("./service");
const { createSqliteStore } = require("./sqlite-store");

async function main() {
  const appConfig = readConfig();
  const controlConfig = readControlConfig();
  const logger = createLogger().child({ component: "control-plane" });
  const store = createSqliteStore({ ...appConfig, databasePath: controlConfig.databasePath });
  await store.cleanupExpired();
  const service = createControlService({ appConfig, controlConfig, store });
  const application = createControlServer({ controlConfig, service, logger });
  const address = await application.listen();

  logger.info("Operator control plane started.", {
    host: controlConfig.host,
    port: address.port,
    publicAccessEnabled: controlConfig.publicAccessEnabled,
    haiConnectorEnabled: controlConfig.haiConnectorEnabled,
    database: "sqlite",
  });

  const cleanup = setInterval(() => {
    void store.cleanupExpired().catch((error) => logger.error("Retention cleanup failed.", { error: error.message }));
  }, 6 * 60 * 60 * 1000);
  cleanup.unref();

  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    clearInterval(cleanup);
    logger.info("Stopping operator control plane.", { signal });
    await application.close();
    store.close();
  }
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  return { application, store, service };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ severity: "CRITICAL", message: error.message, code: error.code || "STARTUP_ERROR" }));
    process.exitCode = 1;
  });
}

module.exports = { main };
