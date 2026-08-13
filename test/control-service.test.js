"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createControlService, withTimeout } = require("../src/control/service");
const { config, instance } = require("./helpers");

test("control service reports live, scoped provider data without inventing spend", async () => {
  const store = memoryReadStore();
  const appConfig = config();
  const service = createControlService({
    appConfig,
    controlConfig: { providerCacheMs: 30000, publicAccessEnabled: false, haiConnectorEnabled: false },
    store,
    compute: {
      async getProject() { return { id: "1", name: appConfig.projectId }; },
      async listInstances() {
        return [
          instance("managed"),
          instance("protected", "RUNNING", { labels: { "budget-hardcap": "true", "budget-hardcap-protected": "true" } }),
          instance("visible-unselected", "RUNNING", { labels: {} }),
        ];
      },
    },
    now: () => new Date("2026-08-09T10:00:00.000Z"),
  });
  const overview = await service.getOverview();
  assert.equal(overview.provider.state, "connected");
  assert.equal(overview.provider.instances[0].eligible, true);
  assert.equal(overview.provider.instances[1].protected, true);
  assert.equal(overview.provider.instances.length, 3);
  assert.equal(overview.provider.instances[2].managed, false);
  assert.equal(overview.provider.instances[2].scopeReason, "Not under budget protection");
  assert.equal(overview.budget.state, "empty");
  assert.equal(overview.integrations.find((item) => item.id === "local-database").state, "connected");
  assert.equal(overview.integrations.find((item) => item.id === "notifications").state, "disabled");
});

test("control service caches provider reads and exposes bounded HAI context", async () => {
  let calls = 0;
  const service = createControlService({
    appConfig: config(),
    controlConfig: { providerCacheMs: 30000, publicAccessEnabled: false, haiConnectorEnabled: true },
    store: memoryReadStore({ actions: [{ actionId: "1", action: "stop", instanceName: "vm", zone: "z", status: "FAILED", errorCode: "X", updatedAt: "now" }] }),
    compute: { async getProject() { calls += 1; return {}; }, async listInstances() { return []; } },
  });
  await service.getOverview();
  const context = await service.getHaiContext();
  assert.equal(calls, 1);
  assert.equal(context.authority, "read_only_advisory");
  assert.equal(context.recentFailures.length, 1);
});

test("local execute policy requires explicit confirmation", async () => {
  const store = memoryReadStore();
  const service = createControlService({ appConfig: config(), controlConfig: { providerCacheMs: 30000 }, store, compute: { async getProject() {}, async listInstances() { return []; } } });
  await assert.rejects(() => service.updatePolicy({ executionMode: "execute" }), /ENABLE EXECUTION/);
  const policy = await service.updatePolicy({ executionMode: "execute", confirmation: "ENABLE EXECUTION" });
  assert.equal(policy.executionMode, "execute");
});

test("provider probe deadlines reject stalled adapters", async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 5),
    (error) => error.code === "PROVIDER_TIMEOUT" && error.retryable === true,
  );
});

test("unavailable Firestore audit degrades truthfully without taking down provider status", async () => {
  const store = memoryReadStore();
  store.auditSource = "firestore";
  store.listEvents = async () => { throw new Error("credentials unavailable"); };
  const service = createControlService({
    appConfig: config(),
    controlConfig: { providerCacheMs: 30000, auditSource: "firestore" },
    store,
    compute: { async getProject() { return {}; }, async listInstances() { return []; } },
  });

  const overview = await service.getOverview();
  assert.equal(overview.provider.state, "connected");
  assert.equal(overview.audit.state, "unavailable");
  assert.equal(overview.audit.source, "firestore");
  assert.equal(overview.stats.eventCount, 0);
  assert.equal(overview.integrations.find((item) => item.id === "cloud-audit").state, "unavailable");
});

function memoryReadStore(overrides = {}) {
  const settings = new Map();
  return {
    async getSetting(key) { return settings.get(key) || null; },
    async setSetting(key, value) { settings.set(key, value); },
    async listActions() { return overrides.actions || []; },
    async listEvents() { return overrides.events || []; },
    async listManagedInstances() { return []; },
    async getStats() { return { eventCount: 0, actionCount: 0, failedActions: 0, pendingActions: 0 }; },
  };
}
