"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { publicConfig, readConfig } = require("../src/config");
const { ConfigurationError } = require("../src/errors");

test("configuration defaults to fail-safe planning", () => {
  const config = readConfig({ PROJECT_ID: "project" });
  assert.equal(config.executionMode, "plan");
  assert.equal(config.automationEnabled, false);
  assert.equal(config.enableAutomaticRecovery, false);
  assert.equal(config.managedLabelKey, "budget-hardcap");
});

test("execute mode requires explicit scope and source controls", () => {
  assert.throws(
    () => readConfig({ PROJECT_ID: "project", EXECUTION_MODE: "execute" }),
    (error) => error instanceof ConfigurationError && error.message.includes("fail-closed"),
  );
  assert.doesNotThrow(() => readConfig({
    PROJECT_ID: "project",
    EXECUTION_MODE: "execute",
    AUTOMATION_ENABLED: "false",
    ALLOWED_BUDGET_NAMES: "Budget",
    EXPECTED_CURRENCY: "EUR",
    ALLOWED_ZONES: "europe-west4-a",
  }));
});

test("configuration rejects invalid booleans, numbers, and labels", () => {
  assert.throws(() => readConfig({ PROJECT_ID: "p", AUTOMATION_ENABLED: "yes" }));
  assert.throws(() => readConfig({ PROJECT_ID: "p", THRESHOLD_RATIO: "0" }));
  assert.throws(() => readConfig({ PROJECT_ID: "p", BUDGET_LIMIT: "0" }));
  assert.throws(() => readConfig({ PROJECT_ID: "p", MAX_ACTIONS_PER_EVENT: "1.5" }));
  assert.throws(() => readConfig({ PROJECT_ID: "p", MANAGED_LABEL_KEY: "INVALID" }));
});

test("public configuration excludes persistence details", () => {
  const value = publicConfig(readConfig({ PROJECT_ID: "project", FIRESTORE_PREFIX: "private" }));
  assert.equal(value.projectId, "project");
  assert.equal("firestorePrefix" in value, false);
});
