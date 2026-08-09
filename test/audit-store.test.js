"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createControlStore } = require("../src/control/audit-store");

test("control store keeps local settings separate from selected audit history", async () => {
  const calls = [];
  const local = {
    getSetting: async (key) => ({ key }),
    setSetting: async (...args) => calls.push(["setting", ...args]),
    close: async () => calls.push(["local-close"]),
  };
  const audit = {
    listActions: async () => ["action"],
    listEvents: async () => ["event"],
    listManagedInstances: async () => ["managed"],
    getStats: async () => ({ eventCount: 1 }),
    close: async () => calls.push(["audit-close"]),
  };
  const store = createControlStore({ local, audit, auditSource: "firestore" });

  assert.equal(store.auditSource, "firestore");
  assert.deepEqual(await store.getSetting("policy"), { key: "policy" });
  await store.setSetting("policy", { executionMode: "plan" }, new Date(0));
  assert.deepEqual(await store.listActions(20), ["action"]);
  assert.deepEqual(await store.listEvents(20), ["event"]);
  assert.deepEqual(await store.listManagedInstances("project"), ["managed"]);
  assert.deepEqual(await store.getStats(), { eventCount: 1 });
  await store.close();

  assert.equal(calls[0][0], "setting");
  assert.deepEqual(calls.slice(-2), [["audit-close"], ["local-close"]]);
});
