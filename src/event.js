"use strict";

const crypto = require("node:crypto");
const { ValidationError } = require("./errors");

function parseBudgetEvent(event, context = {}, now = new Date()) {
  const envelope = event?.data?.message || event?.message || event;
  const encodedData = envelope?.data;
  if (typeof encodedData !== "string" || encodedData.length === 0) {
    throw new ValidationError("Missing base64 Pub/Sub message data.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedData, "base64").toString("utf8"));
  } catch (error) {
    throw new ValidationError("Pub/Sub data is not valid base64-encoded JSON.", {
      cause: error.message,
    });
  }

  const costAmount = finiteNumber(payload.costAmount, "costAmount");
  if (costAmount < 0) throw new ValidationError("costAmount cannot be negative.");

  const budgetAmount = optionalFiniteNumber(payload.budgetAmount, "budgetAmount");
  if (budgetAmount !== undefined && budgetAmount <= 0) {
    throw new ValidationError("budgetAmount must be greater than zero when supplied.");
  }

  const publishedAtRaw = envelope.publishTime || event?.time || context.timestamp;
  const publishedAt = publishedAtRaw ? new Date(publishedAtRaw) : now;
  if (Number.isNaN(publishedAt.getTime())) throw new ValidationError("Invalid event publish time.");

  const messageId = envelope.messageId || event?.id || context.eventId;
  const fingerprint = crypto
    .createHash("sha256")
    .update(`${messageId || ""}|${publishedAt.toISOString()}|${encodedData}`)
    .digest("hex");

  return Object.freeze({
    eventId: String(messageId || fingerprint),
    fingerprint,
    publishedAt,
    receivedAt: now,
    attributes: Object.freeze({ ...(envelope.attributes || {}) }),
    budgetDisplayName: requiredString(payload.budgetDisplayName, "budgetDisplayName"),
    costAmount,
    budgetAmount,
    currencyCode: requiredString(payload.currencyCode, "currencyCode").toUpperCase(),
    alertThresholdExceeded: optionalFiniteNumber(
      payload.alertThresholdExceeded,
      "alertThresholdExceeded",
    ),
    forecastThresholdExceeded: optionalFiniteNumber(
      payload.forecastThresholdExceeded,
      "forecastThresholdExceeded",
    ),
    costIntervalStart: payload.costIntervalStart || null,
  });
}

function validateEventSource(budgetEvent, config, now = new Date()) {
  if (
    config.allowedBudgetNames.length > 0 &&
    !config.allowedBudgetNames.includes(budgetEvent.budgetDisplayName)
  ) {
    throw new ValidationError("Budget display name is not allowlisted.", {
      budgetDisplayName: budgetEvent.budgetDisplayName,
    });
  }

  if (config.expectedCurrency && budgetEvent.currencyCode !== config.expectedCurrency) {
    throw new ValidationError("Budget currency does not match EXPECTED_CURRENCY.", {
      expected: config.expectedCurrency,
      actual: budgetEvent.currencyCode,
    });
  }

  const ageSeconds = (now.getTime() - budgetEvent.publishedAt.getTime()) / 1000;
  if (ageSeconds > config.maxEventAgeSeconds) {
    throw new ValidationError("Budget event is older than MAX_EVENT_AGE_SECONDS.", {
      ageSeconds: Math.floor(ageSeconds),
    });
  }
  if (ageSeconds < -300) throw new ValidationError("Budget event publish time is in the future.");
}

function finiteNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ValidationError(`${name} must be a finite number.`);
  return parsed;
}

function optionalFiniteNumber(value, name) {
  if (value === undefined || value === null || value === "") return undefined;
  return finiteNumber(value, name);
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

module.exports = { parseBudgetEvent, validateEventSource };
