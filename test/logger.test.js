"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createLogger, sanitize } = require("../src/logger");

test("structured logging redacts common credential fields recursively", () => {
  assert.deepEqual(sanitize({ token: "abc", nested: { password: "secret", value: 1 } }), {
    token: "[REDACTED]",
    nested: { password: "[REDACTED]", value: 1 },
  });
});

test("logger emits structured records at the expected console levels", () => {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const output = [];
  console.log = (value) => output.push(["log", JSON.parse(value)]);
  console.warn = (value) => output.push(["warn", JSON.parse(value)]);
  console.error = (value) => output.push(["error", JSON.parse(value)]);
  try {
    const logger = createLogger({ service: "test" }).child({ eventId: "1" });
    logger.debug("debug");
    logger.info("info", { token: "hidden" });
    logger.warn("warn");
    logger.error("error");
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(output.map(([method]) => method), ["log", "log", "warn", "error"]);
  assert.equal(output[1][1].token, "[REDACTED]");
  assert.equal(output[3][1].severity, "ERROR");
});
