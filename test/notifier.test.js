"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ProviderError } = require("../src/errors");
const { createNotifier, normalizeTopic } = require("../src/notifier");
const { config } = require("./helpers");

test("notification topics accept short and fully-qualified names", () => {
  assert.equal(normalizeTopic("p", "alerts"), "projects/p/topics/alerts");
  assert.equal(normalizeTopic("p", "projects/x/topics/y"), "projects/x/topics/y");
});

test("disabled notifier is a no-op", async () => {
  await createNotifier(config()).publish({ type: "TEST" });
});

test("notifier publishes JSON through Pub/Sub and wraps failures", async () => {
  let request;
  const google = {
    auth: { GoogleAuth: class {} },
    pubsub: () => ({
      projects: { topics: { publish: async (value) => { request = value; } } },
    }),
  };
  const notifier = createNotifier(config({ NOTIFICATION_TOPIC: "alerts" }), () => google);
  await notifier.publish({ type: "TEST" });
  assert.equal(request.topic, "projects/test-project/topics/alerts");
  assert.deepEqual(JSON.parse(Buffer.from(request.requestBody.messages[0].data, "base64")), { type: "TEST" });

  google.pubsub = () => ({
    projects: { topics: { publish: async () => { throw new Error("offline"); } } },
  });
  await assert.rejects(
    () => createNotifier(config({ NOTIFICATION_TOPIC: "alerts" }), () => google).publish({}),
    ProviderError,
  );
});
