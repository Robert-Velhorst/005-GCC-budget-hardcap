"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ProviderError } = require("../src/errors");
const { createBudgetHandler, deterministicRequestId } = require("../src/handler");
const { MemoryStore, captureLogger, cloudEvent, config, instance } = require("./helpers");

const fixedNow = new Date("2026-08-08T10:01:00.000Z");

function dependencies(overrides = {}) {
  const calls = [];
  const store = overrides.store || new MemoryStore();
  const compute = overrides.compute || {
    async listInstances() {
      return [instance("worker-1")];
    },
    async submitAction(action, target) {
      calls.push({ action, target });
      return { operationId: "123", operationName: "operation-1", operationStatus: "PENDING" };
    },
    async waitForOperation(operationName) {
      return { operationId: "123", operationName, operationStatus: "DONE" };
    },
  };
  return {
    config: overrides.config || config(),
    compute,
    store,
    logger: overrides.logger || captureLogger(),
    notifier: overrides.notifier || { publish: async () => {} },
    now: overrides.now || (() => fixedNow),
    sleep: overrides.sleep || (async () => {}),
    calls,
  };
}

test("plan mode generates actions without persistence or mutation", async () => {
  const deps = dependencies({
    config: config({ EXECUTION_MODE: "plan", AUTOMATION_ENABLED: "false" }),
  });
  const result = await createBudgetHandler(deps)(cloudEvent());
  assert.equal(result.status, "PLAN");
  assert.equal(result.actionCount, 1);
  assert.deepEqual(deps.calls, []);
  assert.equal(deps.store.events.size, 0);
});

test("execute mode persists intent and waits for terminal stop success", async () => {
  const deps = dependencies();
  const result = await createBudgetHandler(deps)(cloudEvent());
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.actions[0].status, "COMPLETED");
  assert.equal(deps.store.actions[0].status, "COMPLETED");
  assert.equal(deps.calls[0].action, "stop");
  assert.match(deps.calls[0].target.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(deps.store.events.get("message-1").status, "COMPLETED");
});

test("duplicate completed events do not call Compute Engine again", async () => {
  const deps = dependencies();
  const handler = createBudgetHandler(deps);
  await handler(cloudEvent());
  const duplicate = await handler(cloudEvent());
  assert.equal(duplicate.status, "IGNORED_DUPLICATE");
  assert.equal(deps.calls.length, 1);
});

test("provider failures are audited and rethrown for retry", async () => {
  const store = new MemoryStore();
  const deps = dependencies({
    store,
    compute: {
      async listInstances() {
        return [instance("worker-1")];
      },
      async submitAction() {
        throw new ProviderError("provider unavailable", { retryable: true });
      },
    },
  });
  await assert.rejects(() => createBudgetHandler(deps)(cloudEvent()), ProviderError);
  assert.equal(store.actions[0].status, "FAILED");
  assert.equal(store.events.get("message-1").status, "FAILED");
});

test("action limits are acknowledged as non-retryable without provider changes", async () => {
  const deps = dependencies({
    config: config({ MAX_ACTIONS_PER_EVENT: "1" }),
    compute: {
      async listInstances() {
        return [instance("worker-1"), instance("worker-2")];
      },
      async submitAction() {
        throw new Error("must not be called");
      },
    },
  });
  const result = await createBudgetHandler(deps)(cloudEvent());
  assert.equal(result.status, "REJECTED_NON_RETRYABLE");
  assert.equal(result.code, "SAFETY_ERROR");
  assert.equal(deps.store.actions.length, 0);
});

test("automatic recovery starts only a terminated VM recorded by this automation", async () => {
  const store = new MemoryStore();
  store.managed.set("europe-west4-a/owned", {
    projectId: "test-project",
    instanceKey: "europe-west4-a/owned",
    status: "STOP_COMPLETED",
    stopCompletedAt: new Date("2026-08-08T09:00:00Z"),
  });
  const deps = dependencies({
    store,
    config: config({ ENABLE_AUTOMATIC_RECOVERY: "true" }),
    compute: {
      async listInstances() {
        return [instance("owned", "TERMINATED"), instance("not-owned", "TERMINATED")];
      },
      async submitAction(action, target) {
        deps.calls.push({ action, target });
        return { operationName: "start-op", operationStatus: "PENDING" };
      },
      async waitForOperation(operationName) {
        return { operationName, operationStatus: "DONE" };
      },
    },
  });
  const result = await createBudgetHandler(deps)(cloudEvent({
    costAmount: 50,
    alertThresholdExceeded: 0.5,
  }));
  assert.equal(result.decision, "RECOVER");
  assert.deepEqual(deps.calls.map((call) => [call.action, call.target.name]), [["start", "owned"]]);
});

test("cooldown suppresses repeated decisions", async () => {
  const store = new MemoryStore();
  store.control = { lastDecision: "STOP", lastActionAt: new Date("2026-08-08T10:00:30Z") };
  const deps = dependencies({ store, config: config({ COOLDOWN_SECONDS: "300" }) });
  const result = await createBudgetHandler(deps)(cloudEvent());
  assert.equal(result.status, "IGNORED_COOLDOWN");
  assert.equal(deps.calls.length, 0);
});

test("below-budget events are completed without listing instances when recovery is disabled", async () => {
  let listed = false;
  const deps = dependencies({
    compute: {
      async listInstances() {
        listed = true;
        return [];
      },
    },
  });
  const result = await createBudgetHandler(deps)(cloudEvent({
    costAmount: 50,
    alertThresholdExceeded: 0.5,
  }));
  assert.equal(result.status, "NO_ACTION");
  assert.equal(listed, false);
});

test("emergency switch creates an audited no-action result without listing instances", async () => {
  let listed = false;
  const deps = dependencies({
    config: config({ AUTOMATION_ENABLED: "false" }),
    compute: { async listInstances() { listed = true; return []; } },
  });
  const result = await createBudgetHandler(deps)(cloudEvent());
  assert.equal(result.status, "AUTOMATION_DISABLED");
  assert.equal(listed, false);
  assert.equal(deps.store.events.get("message-1").status, "IGNORED");
});

test("notification failure does not replay successful external actions", async () => {
  const deps = dependencies({
    notifier: { publish: async () => { throw new Error("topic unavailable"); } },
  });
  const result = await createBudgetHandler(deps)(cloudEvent());
  assert.equal(result.status, "COMPLETED");
  assert.equal(deps.calls.length, 1);
  assert.ok(deps.logger.records.some((record) => record.level === "warn"));
});

test("deterministic request IDs are stable and unique per action seed", () => {
  const first = deterministicRequestId("a");
  assert.equal(first, deterministicRequestId("a"));
  assert.notEqual(first, deterministicRequestId("b"));
});

test("malformed events are acknowledged as non-retryable", async () => {
  const deps = dependencies();
  const result = await createBudgetHandler(deps)({ data: { message: { data: "not-json" } } });
  assert.equal(result.status, "REJECTED_NON_RETRYABLE");
  assert.equal(result.code, "VALIDATION_ERROR");
  assert.equal(deps.calls.length, 0);
});

test("retry resumes a submitted operation instead of submitting a second action", async () => {
  const store = new MemoryStore();
  store.actions.push({
    actionId: "action-pending",
    eventId: "message-1",
    projectId: "test-project",
    action: "stop",
    instanceKey: "europe-west4-a/worker-1",
    instanceName: "worker-1",
    zone: "europe-west4-a",
    requestId: "request-1",
    operationName: "operation-pending",
    status: "SUBMITTED",
  });
  const calls = [];
  const deps = dependencies({
    store,
    compute: {
      async listInstances() {
        throw new Error("inventory must not be listed while resuming");
      },
      async submitAction() {
        throw new Error("action must not be resubmitted");
      },
      async waitForOperation(operationName) {
        calls.push(operationName);
        return { operationName, operationStatus: "DONE" };
      },
    },
  });
  const result = await createBudgetHandler(deps)(cloudEvent());
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(calls, ["operation-pending"]);
  assert.equal(store.actions[0].status, "COMPLETED");
});

test("poll timeout leaves a submitted action resumable on event retry", async () => {
  const store = new MemoryStore();
  let submissions = 0;
  let polls = 0;
  const deps = dependencies({
    store,
    compute: {
      async listInstances() {
        return [instance("worker-1")];
      },
      async submitAction() {
        submissions += 1;
        return { operationName: "operation-slow", operationStatus: "PENDING" };
      },
      async waitForOperation(operationName) {
        polls += 1;
        if (polls === 1) {
          throw new ProviderError("operation timeout", { retryable: true });
        }
        return { operationName, operationStatus: "DONE" };
      },
    },
  });
  const handler = createBudgetHandler(deps);
  await assert.rejects(() => handler(cloudEvent()), ProviderError);
  assert.equal(store.actions[0].status, "SUBMITTED");
  const result = await handler(cloudEvent());
  assert.equal(result.status, "COMPLETED");
  assert.equal(submissions, 1);
  assert.equal(polls, 2);
});

test("terminal operation failure is audited and acknowledged without retries", async () => {
  const store = new MemoryStore();
  const deps = dependencies({
    store,
    compute: {
      async listInstances() {
        return [instance("worker-1")];
      },
      async submitAction() {
        return { operationName: "operation-failed", operationStatus: "PENDING" };
      },
      async waitForOperation() {
        throw new ProviderError("terminal failure", {
          retryable: false,
          details: { terminal: true },
        });
      },
    },
  });
  const result = await createBudgetHandler(deps)(cloudEvent());
  assert.equal(result.status, "REJECTED_NON_RETRYABLE");
  assert.equal(store.actions[0].status, "FAILED");
  assert.equal(store.events.get("message-1").status, "FAILED");
});
