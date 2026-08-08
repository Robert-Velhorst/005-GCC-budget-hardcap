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
