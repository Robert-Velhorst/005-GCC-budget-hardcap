"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { readControlConfig } = require("../src/control/config");

test("control config defaults to loopback SQLite mode", () => {
  const config = readControlConfig({}, "C:\\workspace");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8787);
  assert.equal(config.publicAccessEnabled, false);
  assert.equal(config.haiConnectorEnabled, false);
  assert.match(config.databasePath, /budget-hardcap\.db$/);
});

test("public and HAI modes fail closed without separate strong tokens", () => {
  assert.throws(
    () => readControlConfig({ PUBLIC_ACCESS_ENABLED: "true", CONTROL_PLANE_TOKEN: "short" }),
    /at least 32/,
  );
  assert.throws(
    () => readControlConfig({ HAI_CONNECTOR_ENABLED: "true", HAI_CONNECTOR_TOKEN: "short" }),
    /at least 32/,
  );
  const same = "a".repeat(32);
  assert.throws(
    () => readControlConfig({
      PUBLIC_ACCESS_ENABLED: "true",
      CONTROL_PLANE_TOKEN: same,
      HAI_CONNECTOR_ENABLED: "true",
      HAI_CONNECTOR_TOKEN: same,
    }),
    /must be different/,
  );
});

test("non-loopback binding requires explicit public mode", () => {
  assert.throws(() => readControlConfig({ CONTROL_HOST: "0.0.0.0" }), /loopback/);
  const config = readControlConfig({
    CONTROL_HOST: "0.0.0.0",
    PUBLIC_ACCESS_ENABLED: "true",
    CONTROL_PLANE_TOKEN: "o".repeat(32),
  });
  assert.equal(config.host, "0.0.0.0");
});
