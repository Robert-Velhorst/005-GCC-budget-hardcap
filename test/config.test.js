"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { publicConfig, readConfig } = require("../src/config");
const { ConfigurationError } = require("../src/errors");

test("configuration defaults to fail-safe planning", () => {
  const config = readConfig({ PROJECT_ID: "project" });
  assert.equal(config.executionMode, "plan");
  assert.equal(config.automationEnabled, false);
  assert.equal(config.enableAutomaticRecovery, true);
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
  assert.throws(() => readConfig({ PROJECT_ID: "p", OPERATION_TIMEOUT_SECONDS: "5" }));
  assert.throws(() => readConfig({ PROJECT_ID: "p", AUDIT_RETENTION_DAYS: "0" }));
  assert.throws(() => readConfig({ PROJECT_ID: "p", MANAGED_LABEL_KEY: "INVALID" }));
});

test("automatic restart can still be disabled explicitly", () => {
  const config = readConfig({ PROJECT_ID: "project", ENABLE_AUTOMATIC_RECOVERY: "false" });
  assert.equal(config.enableAutomaticRecovery, false);
});

test("public configuration includes operator policy and excludes persistence details", () => {
  const value = publicConfig(readConfig({
    PROJECT_ID: "project",
    BUDGET_LIMIT: "125",
    THRESHOLD_RATIO: "0.8",
    FIRESTORE_PREFIX: "private",
  }));
  assert.equal(value.projectId, "project");
  assert.equal(value.budgetLimit, 125);
  assert.equal(value.thresholdRatio, 0.8);
  assert.equal(value.auditRetentionDays, 90);
  assert.equal("firestorePrefix" in value, false);
});
