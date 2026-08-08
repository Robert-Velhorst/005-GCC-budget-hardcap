"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ProviderError, SafetyError } = require("../src/errors");
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

test("execute mode persists intent before submitting a stop", async () => {
  const deps = dependencies();
  const result = await createBudgetHandler(deps)(cloudEvent());
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.actions[0].status, "SUBMITTED");
  assert.equal(deps.store.actions[0].status, "SUBMITTED");
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

test("action limits fail closed without provider changes", async () => {
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
  await assert.rejects(() => createBudgetHandler(deps)(cloudEvent()), SafetyError);
  assert.equal(deps.store.actions.length, 0);
});

test("automatic recovery starts only a terminated VM recorded by this automation", async () => {
  const store = new MemoryStore();
  store.managed.set("europe-west4-a/owned", {
    projectId: "test-project",
    instanceKey: "europe-west4-a/owned",
    status: "STOP_SUBMITTED",
    stopSubmittedAt: new Date("2026-08-08T09:00:00Z"),
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
