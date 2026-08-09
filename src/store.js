"use strict";

const crypto = require("node:crypto");
const { ProviderError } = require("./errors");

function createFirestoreStore(config, firestoreFactory = defaultFirestoreFactory) {
  const firestore = firestoreFactory(config);
  const events = firestore.collection(`${config.firestorePrefix}_events`);
  const actions = firestore.collection(`${config.firestorePrefix}_actions`);
  const managed = firestore.collection(`${config.firestorePrefix}_managed_instances`);
  const controls = firestore.collection(`${config.firestorePrefix}_controls`);

  return {
    async claimEvent(eventRecord, now) {
      const reference = events.doc(safeDocumentId(eventRecord.eventId));
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const existing = snapshot.exists ? snapshot.data() : null;
        const leaseUntil = existing?.leaseUntil?.toDate?.() || existing?.leaseUntil;
        const leaseActive = leaseUntil && new Date(leaseUntil).getTime() > now.getTime();
        if (existing && ["COMPLETED", "IGNORED", "FAILED"].includes(existing.status)) {
          return { claimed: false, reason: existing.status };
        }
        if (existing?.status === "PROCESSING" && leaseActive) {
          return { claimed: false, reason: "PROCESSING" };
        }

        transaction.set(
          reference,
          {
            ...eventRecord,
            status: "PROCESSING",
            attempts: Number(existing?.attempts || 0) + 1,
            startedAt: now,
            updatedAt: now,
            leaseUntil: new Date(now.getTime() + config.eventLeaseSeconds * 1000),
            expiresAt: retentionExpiry(config, now),
          },
          { merge: true },
        );
        return { claimed: true, reason: existing ? "RETRY" : "NEW" };
      });
    },

    async completeEvent(eventId, outcome, now) {
      await events.doc(safeDocumentId(eventId)).set(
        { status: "COMPLETED", outcome, completedAt: now, updatedAt: now, leaseUntil: null },
        { merge: true },
      );
    },

    async ignoreEvent(eventId, outcome, now) {
      await events.doc(safeDocumentId(eventId)).set(
        { status: "IGNORED", outcome, completedAt: now, updatedAt: now, leaseUntil: null },
        { merge: true },
      );
    },

    async failEvent(eventId, error, now) {
      await events.doc(safeDocumentId(eventId)).set(
        {
          status: error.retryable ? "FAILED_RETRYABLE" : "FAILED",
          errorCode: error.code || "INTERNAL_ERROR",
          errorMessage: error.message,
          failedAt: now,
          updatedAt: now,
          leaseUntil: null,
        },
        { merge: true },
      );
    },

    async getControlState(projectId) {
      const snapshot = await controls.doc(safeDocumentId(projectId)).get();
      return snapshot.exists ? snapshot.data() : null;
    },

    async updateControlState(projectId, state, now) {
      await controls.doc(safeDocumentId(projectId)).set({ ...state, updatedAt: now }, { merge: true });
    },

    async recordActionIntent(record, now) {
      const actionId = safeDocumentId(`${record.eventId}:${record.action}:${record.instanceKey}`);
      await actions.doc(actionId).set(
        {
          ...record,
          actionId,
          status: "INTENT_RECORDED",
          createdAt: now,
          updatedAt: now,
          expiresAt: retentionExpiry(config, now),
        },
        { merge: true },
      );
      if (record.action === "stop") {
        await managed.doc(safeDocumentId(record.instanceKey)).set(
          {
            projectId: record.projectId,
            instanceKey: record.instanceKey,
            instanceName: record.instanceName,
            zone: record.zone,
            status: "STOP_INTENT",
            stopEventId: record.eventId,
            updatedAt: now,
          },
          { merge: true },
        );
      }
      return actionId;
    },

    async recordActionSubmitted(actionId, record, now) {
      await actions.doc(actionId).set(
        { ...record, status: "SUBMITTED", submittedAt: now, updatedAt: now },
        { merge: true },
      );
      const managedRef = managed.doc(safeDocumentId(record.instanceKey));
      if (record.action === "stop") {
        await managedRef.set(
          { status: "STOP_SUBMITTED", stopSubmittedAt: now, operationName: record.operationName },
          { merge: true },
        );
      } else {
        await managedRef.set(
          { status: "START_SUBMITTED", startSubmittedAt: now, operationName: record.operationName },
          { merge: true },
        );
      }
    },

    async recordActionCompleted(actionId, record, now) {
      await actions.doc(actionId).set(
        { ...record, status: "COMPLETED", completedAt: now, updatedAt: now },
        { merge: true },
      );
      const managedRef = managed.doc(safeDocumentId(record.instanceKey));
      if (record.action === "stop") {
        await managedRef.set(
          { status: "STOP_COMPLETED", stopCompletedAt: now, operationName: record.operationName },
          { merge: true },
        );
      } else {
        await managedRef.set(
          { status: "START_COMPLETED", startCompletedAt: now, operationName: record.operationName },
          { merge: true },
        );
      }
    },

    async recordActionFailed(actionId, record, now) {
      await actions.doc(actionId).set(
        {
          status: record.retryable ? "FAILED_RETRYABLE" : "FAILED",
          errorCode: record.errorCode,
          errorMessage: record.errorMessage,
          failedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
      if (record.action && record.instanceKey) {
        await managed.doc(safeDocumentId(record.instanceKey)).set(
          {
            status: `${record.action.toUpperCase()}_FAILED`,
            errorCode: record.errorCode,
            errorMessage: record.errorMessage,
            updatedAt: now,
          },
          { merge: true },
        );
      }
    },

    async listPendingActions(eventId) {
      const snapshot = await actions.where("eventId", "==", eventId).get();
      return snapshot.docs
        .map((document) => document.data())
        .filter((record) => record.status === "SUBMITTED" && record.operationName);
    },

    async listRecoverableInstances(projectId, cutoff) {
      const snapshot = await managed.where("projectId", "==", projectId).get();
      return snapshot.docs
        .map((document) => document.data())
        .filter((record) => {
          const stoppedAt = record.stopCompletedAt?.toDate?.() || record.stopCompletedAt;
          return record.status === "STOP_COMPLETED" && stoppedAt && new Date(stoppedAt) <= cutoff;
        });
    },

    async listAmbiguousInstances(projectId) {
      const snapshot = await managed.where("projectId", "==", projectId).get();
      return snapshot.docs
        .map((document) => document.data())
        .filter((record) => ["STOP_INTENT", "STOP_SUBMITTED", "START_SUBMITTED"].includes(record.status));
    },

    async markManagedInstance(instanceKeyValue, state, now) {
      await managed.doc(safeDocumentId(instanceKeyValue)).set(
        { status: state, reconciledAt: now, updatedAt: now },
        { merge: true },
      );
    },
  };
}

function safeDocumentId(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function retentionExpiry(config, now) {
  return new Date(now.getTime() + config.auditRetentionDays * 24 * 60 * 60 * 1000);
}

function defaultFirestoreFactory(config) {
  const { Firestore } = require("@google-cloud/firestore");
  return new Firestore({ projectId: config.projectId, databaseId: config.firestoreDatabaseId });
}

function wrapStoreError(error, operation) {
  if (error instanceof ProviderError) return error;
  return new ProviderError(`Firestore ${operation} failed.`, {
    retryable: true,
    details: { cause: error.message },
  });
}

function protectStore(store) {
  return new Proxy(store, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== "function") return value;
      return async (...args) => {
        try {
          return await value.apply(target, args);
        } catch (error) {
          throw wrapStoreError(error, String(property));
        }
      };
    },
  });
}

module.exports = {
  createFirestoreStore: (config, factory) => protectStore(createFirestoreStore(config, factory)),
  safeDocumentId,
};
