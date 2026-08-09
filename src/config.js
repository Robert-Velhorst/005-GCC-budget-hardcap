"use strict";

const { ConfigurationError } = require("./errors");

const EXECUTION_MODES = new Set(["plan", "execute"]);

function readConfig(env = process.env) {
  const executionMode = (env.EXECUTION_MODE || "plan").toLowerCase();
  if (!EXECUTION_MODES.has(executionMode)) {
    throw new ConfigurationError("EXECUTION_MODE must be 'plan' or 'execute'.");
  }

  const config = {
    projectId: firstNonEmpty(env.PROJECT_ID, env.GOOGLE_CLOUD_PROJECT, env.GCP_PROJECT),
    executionMode,
    automationEnabled: parseBoolean(env.AUTOMATION_ENABLED, false, "AUTOMATION_ENABLED"),
    enableAutomaticRecovery: parseBoolean(
      env.ENABLE_AUTOMATIC_RECOVERY,
      false,
      "ENABLE_AUTOMATIC_RECOVERY",
    ),
    budgetLimit: parseNumber(env.BUDGET_LIMIT, 10, "BUDGET_LIMIT", { minExclusive: 0 }),
    thresholdRatio: parseNumber(env.THRESHOLD_RATIO, 1, "THRESHOLD_RATIO", {
      minExclusive: 0,
      max: 10,
    }),
    expectedCurrency: optionalString(env.EXPECTED_CURRENCY)?.toUpperCase(),
    allowedBudgetNames: parseList(env.ALLOWED_BUDGET_NAMES),
    managedLabelKey: optionalString(env.MANAGED_LABEL_KEY) || "budget-hardcap",
    managedLabelValue: optionalString(env.MANAGED_LABEL_VALUE) || "true",
    protectedLabelKey: optionalString(env.PROTECTED_LABEL_KEY) || "budget-hardcap-protected",
    protectedLabelValue: optionalString(env.PROTECTED_LABEL_VALUE) || "true",
    allowedZones: parseList(env.ALLOWED_ZONES),
    excludedInstances: parseList(env.EXCLUDED_INSTANCES),
    maxActionsPerEvent: parseInteger(env.MAX_ACTIONS_PER_EVENT, 20, "MAX_ACTIONS_PER_EVENT", {
      min: 1,
      max: 100,
    }),
    actionDelayMs: parseInteger(env.ACTION_DELAY_MS, 250, "ACTION_DELAY_MS", {
      min: 0,
      max: 60000,
    }),
    operationTimeoutSeconds: parseInteger(
      env.OPERATION_TIMEOUT_SECONDS,
      180,
      "OPERATION_TIMEOUT_SECONDS",
      { min: 10, max: 480 },
    ),
    operationPollIntervalMs: parseInteger(
      env.OPERATION_POLL_INTERVAL_MS,
      2000,
      "OPERATION_POLL_INTERVAL_MS",
      { min: 250, max: 30000 },
    ),
    providerRequestTimeoutMs: parseInteger(
      env.PROVIDER_REQUEST_TIMEOUT_MS,
      8000,
      "PROVIDER_REQUEST_TIMEOUT_MS",
      { min: 1000, max: 60000 },
    ),
    cooldownSeconds: parseInteger(env.COOLDOWN_SECONDS, 300, "COOLDOWN_SECONDS", {
      min: 0,
      max: 86400,
    }),
    recoveryDelaySeconds: parseInteger(
      env.RECOVERY_DELAY_SECONDS,
      3600,
      "RECOVERY_DELAY_SECONDS",
      { min: 0, max: 2592000 },
    ),
    maxEventAgeSeconds: parseInteger(
      env.MAX_EVENT_AGE_SECONDS,
      86400,
      "MAX_EVENT_AGE_SECONDS",
      { min: 60, max: 2592000 },
    ),
    eventLeaseSeconds: parseInteger(env.EVENT_LEASE_SECONDS, 600, "EVENT_LEASE_SECONDS", {
      min: 30,
      max: 3600,
    }),
    firestoreDatabaseId: optionalString(env.FIRESTORE_DATABASE_ID) || "(default)",
    firestorePrefix: optionalString(env.FIRESTORE_PREFIX) || "budgetHardcap",
    auditRetentionDays: parseInteger(env.AUDIT_RETENTION_DAYS, 90, "AUDIT_RETENTION_DAYS", {
      min: 1,
      max: 3650,
    }),
    notificationTopic: optionalString(env.NOTIFICATION_TOPIC),
  };

  validateConfig(config);
  return Object.freeze(config);
}

function validateConfig(config) {
  if (!config.projectId) {
    throw new ConfigurationError(
      "Set PROJECT_ID, GOOGLE_CLOUD_PROJECT, or GCP_PROJECT to the Compute Engine project.",
    );
  }

  validateLabel(config.managedLabelKey, config.managedLabelValue, "managed");
  validateLabel(config.protectedLabelKey, config.protectedLabelValue, "protected");

  if (config.executionMode === "execute") {
    const missing = [];
    if (config.allowedBudgetNames.length === 0) missing.push("ALLOWED_BUDGET_NAMES");
    if (!config.expectedCurrency) missing.push("EXPECTED_CURRENCY");
    if (config.allowedZones.length === 0) missing.push("ALLOWED_ZONES");

    if (missing.length > 0) {
      throw new ConfigurationError(
        `Execution mode is fail-closed. Missing explicit production settings: ${missing.join(", ")}.`,
      );
    }
  }
}

function validateLabel(key, value, purpose) {
  const labelPattern = /^[a-z][a-z0-9_-]{0,62}$/;
  if (!labelPattern.test(key) || !/^[a-z0-9_-]{1,63}$/.test(value)) {
    throw new ConfigurationError(`Invalid ${purpose} label key or value.`);
  }
}

function parseBoolean(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ConfigurationError(`${name} must be 'true' or 'false'.`);
}

function parseNumber(value, fallback, name, limits = {}) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ConfigurationError(`${name} must be a finite number.`);
  enforceLimits(parsed, name, limits);
  return parsed;
}

function parseInteger(value, fallback, name, limits = {}) {
  const parsed = parseNumber(value, fallback, name, limits);
  if (!Number.isInteger(parsed)) throw new ConfigurationError(`${name} must be an integer.`);
  return parsed;
}

function enforceLimits(value, name, { min, minExclusive, max }) {
  if (min !== undefined && value < min) throw new ConfigurationError(`${name} must be >= ${min}.`);
  if (minExclusive !== undefined && value <= minExclusive) {
    throw new ConfigurationError(`${name} must be > ${minExclusive}.`);
  }
  if (max !== undefined && value > max) throw new ConfigurationError(`${name} must be <= ${max}.`);
}

function parseList(value) {
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function firstNonEmpty(...values) {
  return values.map(optionalString).find(Boolean);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function publicConfig(config) {
  return {
    projectId: config.projectId,
    executionMode: config.executionMode,
    automationEnabled: config.automationEnabled,
    enableAutomaticRecovery: config.enableAutomaticRecovery,
    budgetLimit: config.budgetLimit,
    thresholdRatio: config.thresholdRatio,
    expectedCurrency: config.expectedCurrency || null,
    allowedBudgetNames: config.allowedBudgetNames,
    allowedZones: config.allowedZones,
    maxActionsPerEvent: config.maxActionsPerEvent,
    operationTimeoutSeconds: config.operationTimeoutSeconds,
    providerRequestTimeoutMs: config.providerRequestTimeoutMs,
    cooldownSeconds: config.cooldownSeconds,
    recoveryDelaySeconds: config.recoveryDelaySeconds,
    auditRetentionDays: config.auditRetentionDays,
    notificationEnabled: Boolean(config.notificationTopic),
  };
}

module.exports = { publicConfig, readConfig, validateConfig };
