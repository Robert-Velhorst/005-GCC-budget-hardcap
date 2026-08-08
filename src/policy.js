"use strict";

const DECISIONS = Object.freeze({
  STOP: "STOP",
  RECOVER: "RECOVER",
  NO_ACTION: "NO_ACTION",
});

function evaluateBudgetPolicy(budgetEvent, config) {
  const ratio = budgetEvent.budgetAmount
    ? budgetEvent.costAmount / budgetEvent.budgetAmount
    : budgetEvent.costAmount / config.budgetLimit;

  const thresholdExceeded = [
    ratio,
    budgetEvent.alertThresholdExceeded,
    budgetEvent.forecastThresholdExceeded,
  ].some((value) => Number.isFinite(value) && value >= config.thresholdRatio);

  if (thresholdExceeded) {
    return {
      decision: DECISIONS.STOP,
      ratio,
      reason: "Configured budget threshold reached or exceeded.",
    };
  }

  if (config.enableAutomaticRecovery) {
    return {
      decision: DECISIONS.RECOVER,
      ratio,
      reason: "Budget is below threshold and automatic recovery is enabled.",
    };
  }

  return {
    decision: DECISIONS.NO_ACTION,
    ratio,
    reason: "Budget is below threshold; automatic recovery is disabled.",
  };
}

module.exports = { DECISIONS, evaluateBudgetPolicy };
