"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createComputeGateway, instanceKey, selectManagedInstances } = require("../src/compute");
const { ProviderError } = require("../src/errors");
const { config, instance } = require("./helpers");

test("managed instance selection enforces every scope boundary", () => {
  const candidates = [
    instance("selected"),
    instance("stopped", "TERMINATED"),
    instance("unlabelled", "RUNNING", { labels: {} }),
    instance("protected", "RUNNING", {
      labels: { "budget-hardcap": "true", "budget-hardcap-protected": "true" },
    }),
    instance("wrong-zone", "RUNNING", { zone: "us-central1-a" }),
    instance("excluded"),
  ];
  const selected = selectManagedInstances(
    candidates,
    config({ EXCLUDED_INSTANCES: "excluded" }),
    "RUNNING",
  );
  assert.deepEqual(selected.map((item) => item.name), ["selected"]);
  assert.equal(instanceKey(selected[0]), "europe-west4-a/selected");
});

test("Compute gateway paginates, normalizes instances, and submits actions", async () => {
  const requests = [];
  const pages = [
    {
      data: {
        items: {
          "zones/europe-west4-a": {
            instances: [{ id: "1", name: "one", status: "RUNNING", labels: { a: "b" } }],
          },
          regions: {},
        },
        nextPageToken: "next",
      },
    },
    {
      data: {
        items: {
          "zones/europe-west4-b": {
            instances: [{ id: "2", name: "two", status: "TERMINATED" }],
          },
        },
      },
    },
  ];
  const google = {
    auth: { GoogleAuth: class {} },
    compute: () => ({
      instances: {
        aggregatedList: async (request) => {
          requests.push(request);
          return pages.shift();
        },
        stop: async (request) => ({ data: { id: "9", name: "op", status: "PENDING", request } }),
        start: async () => ({ data: {} }),
      },
      projects: { get: async () => ({ data: { id: "7", name: "test-project" } }) },
    }),
  };
  const gateway = createComputeGateway(config(), () => google);
  const instances = await gateway.listInstances();
  assert.deepEqual(instances.map((item) => item.name), ["one", "two"]);
  assert.equal(requests[1].pageToken, "next");
  assert.deepEqual(await gateway.submitAction("stop", {
    name: "one",
    zone: "europe-west4-a",
    requestId: "request-id",
  }), { operationId: "9", operationName: "op", operationStatus: "PENDING" });
  assert.equal((await gateway.getProject()).name, "test-project");
  await assert.rejects(() => gateway.submitAction("delete", instances[0]), TypeError);
});

test("Compute gateway wraps provider failures and classifies retryability", async () => {
  const google = {
    auth: { GoogleAuth: class {} },
    compute: () => ({
      instances: {
        aggregatedList: async () => { const error = new Error("denied"); error.code = 403; throw error; },
      },
      projects: { get: async () => { throw new Error("offline"); } },
    }),
  };
  const gateway = createComputeGateway(config(), () => google);
  await assert.rejects(
    () => gateway.listInstances(),
    (error) => error instanceof ProviderError && error.retryable === false,
  );
  await assert.rejects(
    () => gateway.getProject(),
    (error) => error instanceof ProviderError && error.retryable === true,
  );
});

test("Compute gateway polls zone operations to terminal success", async () => {
  const responses = [
    { data: { name: "op-1", status: "RUNNING" } },
    { data: { id: "9", name: "op-1", status: "DONE" } },
  ];
  let currentTime = 0;
  const google = {
    auth: { GoogleAuth: class {} },
    compute: () => ({
      instances: {},
      projects: {},
      zoneOperations: { get: async () => responses.shift() },
    }),
  };
  const gateway = createComputeGateway(config(), () => google);
  const result = await gateway.waitForOperation("op-1", "europe-west4-a", {
    timeoutMs: 1000,
    pollIntervalMs: 10,
    now: () => new Date(currentTime),
    sleep: async (milliseconds) => { currentTime += milliseconds; },
  });
  assert.deepEqual(result, {
    operationId: "9",
    operationName: "op-1",
    operationStatus: "DONE",
  });
});

test("Compute gateway classifies terminal operation errors as non-retryable", async () => {
  const google = {
    auth: { GoogleAuth: class {} },
    compute: () => ({
      instances: {},
      projects: {},
      zoneOperations: {
        get: async () => ({
          data: {
            name: "op-failed",
            status: "DONE",
            error: { errors: [{ code: "PERMISSION_DENIED", message: "denied" }] },
          },
        }),
      },
    }),
  };
  const gateway = createComputeGateway(config(), () => google);
  await assert.rejects(
    () => gateway.waitForOperation("op-failed", "europe-west4-a"),
    (error) => error instanceof ProviderError && !error.retryable && error.details.terminal,
  );
});

test("Compute gateway times out pending operations as retryable", async () => {
  let currentTime = 0;
  const google = {
    auth: { GoogleAuth: class {} },
    compute: () => ({
      instances: {},
      projects: {},
      zoneOperations: { get: async () => ({ data: { status: "RUNNING" } }) },
    }),
  };
  const gateway = createComputeGateway(config(), () => google);
  await assert.rejects(
    () => gateway.waitForOperation("op-slow", "europe-west4-a", {
      timeoutMs: 10,
      pollIntervalMs: 10,
      now: () => new Date(currentTime),
      sleep: async (milliseconds) => { currentTime += milliseconds; },
    }),
    (error) => error instanceof ProviderError && error.retryable,
  );
  await assert.rejects(
    () => gateway.waitForOperation(null, "europe-west4-a"),
    (error) => error instanceof ProviderError && !error.retryable,
  );
});
