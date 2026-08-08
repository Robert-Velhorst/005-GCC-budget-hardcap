"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DECISIONS, evaluateBudgetPolicy } = require("../src/policy");
const { config } = require("./helpers");

test("stops on actual, alert, or forecast thresholds", () => {
  const base = { costAmount: 90, budgetAmount: 100 };
  assert.equal(evaluateBudgetPolicy({ ...base, costAmount: 100 }, config()).decision, DECISIONS.STOP);
  assert.equal(evaluateBudgetPolicy({ ...base, alertThresholdExceeded: 1 }, config()).decision, DECISIONS.STOP);
  assert.equal(evaluateBudgetPolicy({ ...base, forecastThresholdExceeded: 1 }, config()).decision, DECISIONS.STOP);
});

test("uses the absolute fallback limit without a budget amount", () => {
  assert.equal(
    evaluateBudgetPolicy({ costAmount: 100 }, config()).decision,
    DECISIONS.STOP,
  );
});

test("recovery is explicit and otherwise produces no action", () => {
  const event = { costAmount: 50, budgetAmount: 100 };
  assert.equal(evaluateBudgetPolicy(event, config()).decision, DECISIONS.NO_ACTION);
  assert.equal(
    evaluateBudgetPolicy(event, config({ ENABLE_AUTOMATIC_RECOVERY: "true" })).decision,
    DECISIONS.RECOVER,
  );
});
