"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSqliteStore } = require("../src/control/sqlite-store");
const { config } = require("./helpers");

test("SQLite store persists idempotent event and terminal action lifecycles", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gcc-store-"));
  const appConfig = { ...config(), databasePath: path.join(directory, "audit.db") };
  const store = createSqliteStore(appConfig);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const now = new Date("2026-08-09T10:00:00.000Z");
  const eventRecord = { eventId: "event-1", projectId: appConfig.projectId, costAmount: 100 };

  assert.deepEqual(await store.claimEvent(eventRecord, now), { claimed: true, reason: "NEW" });
  assert.deepEqual(await store.claimEvent(eventRecord, now), { claimed: false, reason: "PROCESSING" });

  const record = {
    eventId: "event-1", projectId: appConfig.projectId, action: "stop",
    instanceKey: "europe-west4-a/vm-1", instanceName: "vm-1", zone: "europe-west4-a", requestId: "request-1",
  };
  const actionId = await store.recordActionIntent(record, now);
  await store.recordActionSubmitted(actionId, { ...record, operationName: "op-1", operationId: "10", operationStatus: "PENDING" }, now);
  assert.equal((await store.listPendingActions("event-1"))[0].operationName, "op-1");
  await store.recordActionCompleted(actionId, { ...record, operationName: "op-1", operationId: "10", operationStatus: "DONE" }, now);
  await store.completeEvent("event-1", { status: "COMPLETED" }, now);

  assert.deepEqual(await store.claimEvent(eventRecord, new Date(now.getTime() + 1000)), { claimed: false, reason: "COMPLETED" });
  assert.equal((await store.listActions())[0].status, "COMPLETED");
  assert.equal((await store.listRecoverableInstances(appConfig.projectId, now))[0].instanceName, "vm-1");
  assert.deepEqual(await store.getStats(), { events: 1, actions: 1, failedActions: 0, pendingActions: 0 });
});

test("SQLite settings survive restart and retention removes only expired audit rows", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gcc-store-"));
  const appConfig = { ...config({ AUDIT_RETENTION_DAYS: "1" }), databasePath: path.join(directory, "audit.db") };
  const now = new Date("2026-08-09T10:00:00.000Z");
  let store = createSqliteStore(appConfig);
  await store.setSetting("policy", { executionMode: "plan" }, now);
  await store.claimEvent({ eventId: "old", projectId: appConfig.projectId }, now);
  store.close();

  store = createSqliteStore(appConfig);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.deepEqual(await store.getSetting("policy"), { executionMode: "plan" });
  assert.deepEqual(await store.cleanupExpired(new Date(now.getTime() + 2 * 86400000)), { events: 1, actions: 0 });
});
