"use strict";

const { readConfig } = require("../src/config");

function config(overrides = {}) {
  return readConfig({
    PROJECT_ID: "test-project",
    EXECUTION_MODE: "execute",
    AUTOMATION_ENABLED: "true",
    ALLOWED_BUDGET_NAMES: "Production hardcap",
    EXPECTED_CURRENCY: "EUR",
    ALLOWED_ZONES: "europe-west4-a,europe-west4-b",
    BUDGET_LIMIT: "100",
    THRESHOLD_RATIO: "1",
    MAX_ACTIONS_PER_EVENT: "20",
    ACTION_DELAY_MS: "0",
    COOLDOWN_SECONDS: "0",
    RECOVERY_DELAY_SECONDS: "0",
    ...overrides,
  });
}

function cloudEvent(payload = {}, envelope = {}) {
  const body = {
    budgetDisplayName: "Production hardcap",
    costAmount: 100,
    budgetAmount: 100,
    currencyCode: "EUR",
    alertThresholdExceeded: 1,
    ...payload,
  };
  return {
    id: "event-1",
    time: "2026-08-08T10:00:00.000Z",
    data: {
      message: {
        messageId: "message-1",
        publishTime: "2026-08-08T10:00:00.000Z",
        data: Buffer.from(JSON.stringify(body)).toString("base64"),
        ...envelope,
      },
    },
  };
}

function instance(name, status = "RUNNING", overrides = {}) {
  return {
    id: `${name}-id`,
    name,
    zone: "europe-west4-a",
    status,
    labels: { "budget-hardcap": "true" },
    ...overrides,
  };
}

class MemoryStore {
  constructor() {
    this.events = new Map();
    this.actions = [];
    this.managed = new Map();
    this.control = null;
  }

  async claimEvent(record) {
    const existing = this.events.get(record.eventId);
    if (existing?.status === "COMPLETED") return { claimed: false, reason: "COMPLETED" };
    this.events.set(record.eventId, { ...record, status: "PROCESSING" });
    return { claimed: true, reason: existing ? "RETRY" : "NEW" };
  }

  async completeEvent(eventId, outcome) {
    this.events.set(eventId, { ...this.events.get(eventId), status: "COMPLETED", outcome });
  }

  async ignoreEvent(eventId, outcome) {
    this.events.set(eventId, { ...this.events.get(eventId), status: "IGNORED", outcome });
  }

  async failEvent(eventId, error) {
    this.events.set(eventId, { ...this.events.get(eventId), status: "FAILED", error });
  }

  async getControlState() {
    return this.control;
  }

  async updateControlState(_projectId, state) {
    this.control = state;
  }

  async recordActionIntent(record) {
    const actionId = `action-${this.actions.length + 1}`;
    this.actions.push({ actionId, ...record, status: "INTENT_RECORDED" });
    if (record.action === "stop") {
      this.managed.set(record.instanceKey, {
        ...record,
        status: "STOP_INTENT",
        stopSubmittedAt: null,
      });
    }
    return actionId;
  }

  async recordActionSubmitted(actionId, record, now) {
    const action = this.actions.find((item) => item.actionId === actionId);
    Object.assign(action, record, { status: "SUBMITTED" });
    const existing = this.managed.get(record.instanceKey) || record;
    this.managed.set(record.instanceKey, {
      ...existing,
      status: record.action === "stop" ? "STOP_SUBMITTED" : "START_SUBMITTED",
      stopSubmittedAt: record.action === "stop" ? now : existing.stopSubmittedAt,
    });
  }

  async recordActionCompleted(actionId, record, now) {
    const action = this.actions.find((item) => item.actionId === actionId);
    Object.assign(action, record, { status: "COMPLETED" });
    const existing = this.managed.get(record.instanceKey) || record;
    this.managed.set(record.instanceKey, {
      ...existing,
      status: record.action === "stop" ? "STOP_COMPLETED" : "START_COMPLETED",
      stopCompletedAt: record.action === "stop" ? now : existing.stopCompletedAt,
    });
  }

  async recordActionFailed(actionId, record) {
    const action = this.actions.find((item) => item.actionId === actionId);
    Object.assign(action, record, { status: "FAILED" });
  }

  async listRecoverableInstances(_projectId, cutoff) {
    return [...this.managed.values()].filter(
      (record) => record.status === "STOP_COMPLETED" && record.stopCompletedAt <= cutoff,
    );
  }

  async listPendingActions(eventId) {
    return this.actions.filter(
      (record) => record.eventId === eventId && record.status === "SUBMITTED" && record.operationName,
    );
  }
}

function captureLogger() {
  const records = [];
  const logger = {
    child() {
      return logger;
    },
    debug(message, fields) {
      records.push({ level: "debug", message, fields });
    },
    info(message, fields) {
      records.push({ level: "info", message, fields });
    },
    warn(message, fields) {
      records.push({ level: "warn", message, fields });
    },
    error(message, fields) {
      records.push({ level: "error", message, fields });
    },
    records,
  };
  return logger;
}

module.exports = { MemoryStore, captureLogger, cloudEvent, config, instance };
