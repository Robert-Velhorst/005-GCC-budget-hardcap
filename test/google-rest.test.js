"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createComputeRestClient, createPubSubRestClient } = require("../src/google-rest");

test("lightweight Compute REST client fixes hosts, encodes paths, and forwards deadlines", async () => {
  const requests = [];
  const auth = { async request(value) { requests.push(value); return { data: {} }; } };
  const compute = createComputeRestClient();

  await compute.instances.aggregatedList({ project: "project/name", auth, pageToken: "next", maxResults: 500 }, { timeout: 8000 });
  await compute.instances.stop({ project: "project", zone: "zone/a", instance: "vm/name", requestId: "request", auth }, { timeout: 9000 });
  await compute.zoneOperations.get({ project: "project", zone: "zone", operation: "operation/name", auth }, { timeout: 7000 });
  await compute.projects.get({ project: "project", auth }, { timeout: 6000 });

  assert.match(requests[0].url, /^https:\/\/compute\.googleapis\.com\/compute\/v1\//);
  assert.match(requests[0].url, /project%2Fname/);
  assert.deepEqual(requests[0].params, { pageToken: "next", maxResults: 500 });
  assert.equal(requests[0].timeout, 8000);
  assert.match(requests[1].url, /zones\/zone%2Fa\/instances\/vm%2Fname\/stop$/);
  assert.equal(requests[1].method, "POST");
  assert.match(requests[2].url, /operations\/operation%2Fname$/);
  assert.match(requests[3].url, /projects\/project$/);
});

test("lightweight Pub/Sub REST client uses a fixed host and encoded resource name", async () => {
  let request;
  const auth = { async request(value) { request = value; return { data: {} }; } };
  const pubsub = createPubSubRestClient();
  await pubsub.projects.topics.publish({
    topic: "projects/project/topics/alerts/name",
    auth,
    requestBody: { messages: [{ data: "e30=" }] },
  }, { timeout: 5000 });

  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://pubsub.googleapis.com/v1/projects/project/topics/alerts/name:publish");
  assert.deepEqual(request.data, { messages: [{ data: "e30=" }] });
  assert.equal(request.timeout, 5000);
});
