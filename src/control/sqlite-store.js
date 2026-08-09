"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { ProviderError } = require("../errors");
const { safeDocumentId } = require("../store");

const SCHEMA_VERSION = 1;

function createSqliteStore(config, options = {}) {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const db = options.database || new Database(config.databasePath, { timeout: 5000 });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);

  const statements = prepareStatements(db);

  const store = {
    driver: "sqlite",

    async claimEvent(eventRecord, now) {
      return claimEventTransaction(db, statements, config, eventRecord, now);
    },

    async completeEvent(eventId, outcome, now) {
      statements.finishEvent.run("COMPLETED", json(outcome), null, null, iso(now), iso(now), eventId);
    },

    async ignoreEvent(eventId, outcome, now) {
      statements.finishEvent.run("IGNORED", json(outcome), null, null, iso(now), iso(now), eventId);
    },

    async failEvent(eventId, error, now) {
      statements.finishEvent.run(
        error.retryable ? "FAILED_RETRYABLE" : "FAILED",
        null,
        error.code || "INTERNAL_ERROR",
        error.message,
        iso(now),
        iso(now),
        eventId,
      );
    },

    async getControlState(projectId) {
      return parseRowJson(statements.getControl.get(projectId)?.state_json);
    },

    async updateControlState(projectId, state, now) {
      statements.upsertControl.run(projectId, json(state), iso(now));
    },

    async recordActionIntent(record, now) {
      const actionId = safeDocumentId(`${record.eventId}:${record.action}:${record.instanceKey}`);
      statements.upsertAction.run(actionParams(config, record, actionId, "INTENT_RECORDED", now));
      if (record.action === "stop") {
        statements.upsertManaged.run(managedParams(record, "STOP_INTENT", now));
      }
      return actionId;
    },

    async recordActionSubmitted(actionId, record, now) {
      statements.updateActionLifecycle.run(
        "SUBMITTED",
        record.operationName || null,
        record.operationId || null,
        record.operationStatus || null,
        iso(now),
        null,
        null,
        null,
        iso(now),
        actionId,
      );
      statements.updateManagedLifecycle.run(
        record.action === "stop" ? "STOP_SUBMITTED" : "START_SUBMITTED",
        record.operationName || null,
        iso(now),
        null,
        null,
        iso(now),
        record.instanceKey,
      );
    },

    async recordActionCompleted(actionId, record, now) {
      statements.updateActionLifecycle.run(
        "COMPLETED",
        record.operationName || null,
        record.operationId || null,
        record.operationStatus || "DONE",
        null,
        iso(now),
        null,
        null,
        iso(now),
        actionId,
      );
      statements.updateManagedLifecycle.run(
        record.action === "stop" ? "STOP_COMPLETED" : "START_COMPLETED",
        record.operationName || null,
        null,
        iso(now),
        null,
        iso(now),
        record.instanceKey,
      );
    },

    async recordActionFailed(actionId, record, now) {
      statements.updateActionLifecycle.run(
        record.retryable ? "FAILED_RETRYABLE" : "FAILED",
        null,
        null,
        null,
        null,
        null,
        record.errorCode,
        record.errorMessage,
        iso(now),
        actionId,
      );
      if (record.action && record.instanceKey) {
        statements.updateManagedLifecycle.run(
          `${record.action.toUpperCase()}_FAILED`,
          null,
          null,
          null,
          record.errorMessage,
          iso(now),
          record.instanceKey,
        );
      }
    },

    async listPendingActions(eventId) {
      return statements.listPending.all(eventId).map(actionRow);
    },

    async listRecoverableInstances(projectId, cutoff) {
      return statements.listRecoverable.all(projectId, iso(cutoff)).map(managedRow);
    },

    async listAmbiguousInstances(projectId) {
      return statements.listAmbiguous.all(projectId).map(managedRow);
    },

    async markManagedInstance(instanceKey, state, now) {
      statements.markManaged.run(state, iso(now), instanceKey);
    },

    async listActions(limit = 50) {
      return statements.listActions.all(clampLimit(limit)).map(actionRow);
    },

    async listEvents(limit = 50) {
      return statements.listEvents.all(clampLimit(limit)).map(eventRow);
    },

    async listManagedInstances(projectId) {
      return statements.listManaged.all(projectId).map(managedRow);
    },

    async getSetting(key) {
      return parseRowJson(statements.getSetting.get(key)?.value_json);
    },

    async setSetting(key, value, now) {
      statements.upsertSetting.run(key, json(value), iso(now));
    },

    async getStats() {
      return statements.stats.get();
    },

    async cleanupExpired(now = new Date()) {
      return db.transaction(() => {
        const events = statements.deleteExpiredEvents.run(iso(now)).changes;
        const actions = statements.deleteExpiredActions.run(iso(now)).changes;
        return { events, actions };
      })();
    },

    close() {
      db.close();
    },
  };

  return protectStore(store);
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const current = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get().version;
  if (current > SCHEMA_VERSION) {
    throw new Error(`Database schema ${current} is newer than supported schema ${SCHEMA_VERSION}.`);
  }
  if (current < 1) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE events (
          event_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 1,
          event_json TEXT NOT NULL,
          outcome_json TEXT,
          error_code TEXT,
          error_message TEXT,
          lease_until TEXT,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          updated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX idx_events_updated ON events(updated_at DESC);
        CREATE INDEX idx_events_expiry ON events(expires_at);

        CREATE TABLE actions (
          action_id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          action TEXT NOT NULL CHECK(action IN ('start', 'stop')),
          instance_key TEXT NOT NULL,
          instance_name TEXT NOT NULL,
          zone TEXT NOT NULL,
          status TEXT NOT NULL,
          request_id TEXT NOT NULL,
          operation_name TEXT,
          operation_id TEXT,
          operation_status TEXT,
          error_code TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          submitted_at TEXT,
          completed_at TEXT,
          updated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          UNIQUE(event_id, action, instance_key)
        );
        CREATE INDEX idx_actions_event ON actions(event_id);
        CREATE INDEX idx_actions_updated ON actions(updated_at DESC);
        CREATE INDEX idx_actions_expiry ON actions(expires_at);

        CREATE TABLE managed_instances (
          instance_key TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          instance_name TEXT NOT NULL,
          zone TEXT NOT NULL,
          status TEXT NOT NULL,
          stop_event_id TEXT,
          operation_name TEXT,
          submitted_at TEXT,
          completed_at TEXT,
          error_message TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_managed_project ON managed_instances(project_id, status);

        CREATE TABLE control_states (
          project_id TEXT PRIMARY KEY,
          state_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(1, iso(new Date()));
    })();
  }
}

function prepareStatements(db) {
  return {
    getEvent: db.prepare("SELECT status, attempts, lease_until FROM events WHERE event_id = ?"),
    insertEvent: db.prepare(`
      INSERT INTO events(event_id, project_id, status, attempts, event_json, lease_until, started_at, updated_at, expires_at)
      VALUES (@eventId, @projectId, 'PROCESSING', @attempts, @eventJson, @leaseUntil, @startedAt, @updatedAt, @expiresAt)
      ON CONFLICT(event_id) DO UPDATE SET
        status='PROCESSING', attempts=excluded.attempts, event_json=excluded.event_json,
        lease_until=excluded.lease_until, started_at=excluded.started_at,
        updated_at=excluded.updated_at, expires_at=excluded.expires_at
    `),
    finishEvent: db.prepare(`
      UPDATE events SET status=?, outcome_json=?, error_code=?, error_message=?, completed_at=?, updated_at=?, lease_until=NULL
      WHERE event_id=?
    `),
    getControl: db.prepare("SELECT state_json FROM control_states WHERE project_id = ?"),
    upsertControl: db.prepare(`
      INSERT INTO control_states(project_id, state_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at
    `),
    upsertAction: db.prepare(`
      INSERT INTO actions(action_id, event_id, project_id, action, instance_key, instance_name, zone, status,
        request_id, created_at, updated_at, expires_at)
      VALUES (@actionId, @eventId, @projectId, @action, @instanceKey, @instanceName, @zone, @status,
        @requestId, @createdAt, @updatedAt, @expiresAt)
      ON CONFLICT(action_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
    `),
    updateActionLifecycle: db.prepare(`
      UPDATE actions SET status=?, operation_name=COALESCE(?, operation_name), operation_id=COALESCE(?, operation_id),
        operation_status=COALESCE(?, operation_status), submitted_at=COALESCE(?, submitted_at),
        completed_at=COALESCE(?, completed_at), error_code=?, error_message=?, updated_at=? WHERE action_id=?
    `),
    upsertManaged: db.prepare(`
      INSERT INTO managed_instances(instance_key, project_id, instance_name, zone, status, stop_event_id, updated_at)
      VALUES (@instanceKey, @projectId, @instanceName, @zone, @status, @eventId, @updatedAt)
      ON CONFLICT(instance_key) DO UPDATE SET status=excluded.status, stop_event_id=excluded.stop_event_id, updated_at=excluded.updated_at
    `),
    updateManagedLifecycle: db.prepare(`
      UPDATE managed_instances SET status=?, operation_name=COALESCE(?, operation_name),
        submitted_at=COALESCE(?, submitted_at), completed_at=COALESCE(?, completed_at),
        error_message=?, updated_at=? WHERE instance_key=?
    `),
    listPending: db.prepare("SELECT * FROM actions WHERE event_id=? AND status='SUBMITTED' AND operation_name IS NOT NULL"),
    listRecoverable: db.prepare("SELECT * FROM managed_instances WHERE project_id=? AND status='STOP_COMPLETED' AND completed_at<=?"),
    listAmbiguous: db.prepare("SELECT * FROM managed_instances WHERE project_id=? AND status IN ('STOP_INTENT','STOP_SUBMITTED','START_SUBMITTED')"),
    markManaged: db.prepare("UPDATE managed_instances SET status=?, updated_at=? WHERE instance_key=?"),
    listActions: db.prepare("SELECT * FROM actions ORDER BY updated_at DESC LIMIT ?"),
    listEvents: db.prepare("SELECT * FROM events ORDER BY updated_at DESC LIMIT ?"),
    listManaged: db.prepare("SELECT * FROM managed_instances WHERE project_id=? ORDER BY instance_name"),
    getSetting: db.prepare("SELECT value_json FROM settings WHERE key=?"),
    upsertSetting: db.prepare(`
      INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
    `),
    stats: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM events) AS eventCount,
        (SELECT COUNT(*) FROM actions) AS actionCount,
        (SELECT COUNT(*) FROM actions WHERE status IN ('FAILED', 'FAILED_RETRYABLE')) AS failedActions,
        (SELECT COUNT(*) FROM actions WHERE status IN ('INTENT_RECORDED', 'SUBMITTED')) AS pendingActions
    `),
    deleteExpiredEvents: db.prepare("DELETE FROM events WHERE expires_at < ?"),
    deleteExpiredActions: db.prepare("DELETE FROM actions WHERE expires_at < ?"),
  };
}

function claimEventTransaction(db, statements, config, eventRecord, now) {
  return db.transaction(() => {
    const existing = statements.getEvent.get(eventRecord.eventId);
    if (existing && ["COMPLETED", "IGNORED", "FAILED"].includes(existing.status)) {
      return { claimed: false, reason: existing.status };
    }
    if (existing?.status === "PROCESSING" && Date.parse(existing.lease_until) > now.getTime()) {
      return { claimed: false, reason: "PROCESSING" };
    }
    statements.insertEvent.run({
      eventId: eventRecord.eventId,
      projectId: eventRecord.projectId,
      attempts: Number(existing?.attempts || 0) + 1,
      eventJson: json(eventRecord),
      leaseUntil: iso(new Date(now.getTime() + config.eventLeaseSeconds * 1000)),
      startedAt: iso(now),
      updatedAt: iso(now),
      expiresAt: expiry(config, now),
    });
    return { claimed: true, reason: existing ? "RETRY" : "NEW" };
  })();
}

function actionParams(config, record, actionId, status, now) {
  return {
    actionId,
    eventId: record.eventId,
    projectId: record.projectId,
    action: record.action,
    instanceKey: record.instanceKey,
    instanceName: record.instanceName,
    zone: record.zone,
    status,
    requestId: record.requestId,
    createdAt: iso(now),
    updatedAt: iso(now),
    expiresAt: expiry(config, now),
  };
}

function managedParams(record, status, now) {
  return { ...record, status, updatedAt: iso(now) };
}

function actionRow(row) {
  return row && {
    actionId: row.action_id,
    eventId: row.event_id,
    projectId: row.project_id,
    action: row.action,
    instanceKey: row.instance_key,
    instanceName: row.instance_name,
    zone: row.zone,
    status: row.status,
    requestId: row.request_id,
    operationName: row.operation_name,
    operationId: row.operation_id,
    operationStatus: row.operation_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function eventRow(row) {
  return row && {
    ...parseRowJson(row.event_json),
    eventId: row.event_id,
    projectId: row.project_id,
    status: row.status,
    attempts: row.attempts,
    outcome: parseRowJson(row.outcome_json),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function managedRow(row) {
  return row && {
    instanceKey: row.instance_key,
    projectId: row.project_id,
    instanceName: row.instance_name,
    zone: row.zone,
    status: row.status,
    stopEventId: row.stop_event_id,
    operationName: row.operation_name,
    stopSubmittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
    stopCompletedAt: row.completed_at ? new Date(row.completed_at) : null,
    errorMessage: row.error_message,
    updatedAt: row.updated_at,
  };
}

function protectStore(store) {
  return new Proxy(store, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== "function" || property === "close") return value;
      return async (...args) => {
        try {
          return await value.apply(target, args);
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          throw new ProviderError(`SQLite ${String(property)} failed.`, {
            retryable: true,
            details: { cause: error.message },
          });
        }
      };
    },
  });
}

function clampLimit(limit) {
  return Math.max(1, Math.min(200, Number(limit) || 50));
}

function expiry(config, now) {
  return iso(new Date(now.getTime() + config.auditRetentionDays * 86400000));
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function json(value) {
  return JSON.stringify(value);
}

function parseRowJson(value) {
  return value ? JSON.parse(value) : null;
}

module.exports = { SCHEMA_VERSION, createSqliteStore };
