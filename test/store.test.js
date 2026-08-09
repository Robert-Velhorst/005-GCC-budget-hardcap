"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ProviderError } = require("../src/errors");
const { createFirestoreStore, safeDocumentId } = require("../src/store");
const { config } = require("./helpers");

test("Firestore document IDs are deterministic and path-safe", () => {
  const id = safeDocumentId("zones/europe-west4-a/instances/example");
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(id, safeDocumentId("zones/europe-west4-a/instances/example"));
  assert.notEqual(id, safeDocumentId("other"));
});

test("Firestore store enforces event claims and records the action lifecycle", async () => {
  const firestore = fakeFirestore();
  const store = createFirestoreStore(config(), () => firestore);
  const now = new Date("2026-08-08T10:00:00Z");
  const event = { eventId: "event-1", projectId: "test-project" };

  assert.deepEqual(await store.claimEvent(event, now), { claimed: true, reason: "NEW" });
  assert.deepEqual(await store.claimEvent(event, now), { claimed: false, reason: "PROCESSING" });
  await store.completeEvent("event-1", { status: "ok" }, now);
  assert.deepEqual(await store.claimEvent(event, now), { claimed: false, reason: "COMPLETED" });

  const action = {
    eventId: "event-1",
    projectId: "test-project",
    action: "stop",
    instanceKey: "europe-west4-a/vm-1",
    instanceName: "vm-1",
    zone: "europe-west4-a",
  };
  const actionId = await store.recordActionIntent(action, now);
  await store.recordActionSubmitted(actionId, {
    ...action,
    operationName: "operation-1",
  }, now);
  assert.equal((await store.listPendingActions("event-1")).length, 1);
  assert.equal((await store.listRecoverableInstances("test-project", now)).length, 0);
  assert.equal((await store.listAmbiguousInstances("test-project")).length, 1);
  await store.recordActionCompleted(actionId, {
    ...action,
    operationName: "operation-1",
    operationStatus: "DONE",
  }, now);
  assert.equal((await store.listPendingActions("event-1")).length, 0);
  assert.equal((await store.listRecoverableInstances("test-project", now)).length, 1);
  assert.equal((await store.listAmbiguousInstances("test-project")).length, 0);

  await store.recordActionIntent({ ...action, eventId: "event-2", instanceKey: "zone/vm-2" }, now);
  assert.equal((await store.listAmbiguousInstances("test-project")).length, 1);
  await store.markManagedInstance("zone/vm-2", "MANUAL_REVIEW_REQUIRED", now);

  await store.updateControlState("test-project", { lastDecision: "STOP" }, now);
  assert.equal((await store.getControlState("test-project")).lastDecision, "STOP");
  await store.ignoreEvent("event-3", { reason: "cooldown" }, now);
  await store.failEvent("event-4", new ProviderError("failed", { retryable: true }), now);
  await store.recordActionFailed(actionId, {
    action: "stop",
    instanceKey: "europe-west4-a/vm-1",
    retryable: false,
    errorCode: "FAILED",
    errorMessage: "failed",
  }, now);

  const eventDocuments = firestore._collections.get("budgetHardcap_events");
  const actionDocuments = firestore._collections.get("budgetHardcap_actions");
  assert.ok([...eventDocuments.values()][0].expiresAt instanceof Date);
  assert.ok([...actionDocuments.values()][0].expiresAt instanceof Date);
});

test("Firestore store wraps persistence failures as retryable provider errors", async () => {
  const firestore = fakeFirestore();
  firestore.runTransaction = async () => { throw new Error("offline"); };
  const store = createFirestoreStore(config(), () => firestore);
  await assert.rejects(
    () => store.claimEvent({ eventId: "event" }, new Date()),
    (error) => error instanceof ProviderError && error.retryable,
  );
});

function fakeFirestore() {
  const collections = new Map();

  function collection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    const documents = collections.get(name);
    return {
      doc(id) {
        return {
          id,
          async get() {
            return snapshot(id, documents.get(id));
          },
          async set(value, options) {
            const existing = options?.merge ? documents.get(id) || {} : {};
            documents.set(id, { ...existing, ...value });
          },
        };
      },
      where(field, operator, expected) {
        assert.equal(operator, "==");
        return {
          async get() {
            const docs = [...documents.entries()]
              .filter(([, value]) => value[field] === expected)
              .map(([id, value]) => ({ id, data: () => value }));
            return { docs };
          },
        };
      },
    };
  }

  return {
    _collections: collections,
    collection,
    async runTransaction(callback) {
      return callback({
        get: (reference) => reference.get(),
        set: (reference, value, options) => reference.set(value, options),
      });
    },
  };
}

function snapshot(id, value) {
  return { id, exists: value !== undefined, data: () => value };
}
