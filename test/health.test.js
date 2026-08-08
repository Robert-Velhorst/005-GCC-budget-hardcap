"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { healthCheck } = require("../src/health");

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("health endpoint reports valid configuration without secrets", () => {
  const previous = process.env.PROJECT_ID;
  process.env.PROJECT_ID = "health-project";
  const response = responseRecorder();
  healthCheck({}, response);
  if (previous === undefined) delete process.env.PROJECT_ID;
  else process.env.PROJECT_ID = previous;
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "ok");
  assert.equal(response.body.config.projectId, "health-project");
});

test("health endpoint fails readiness when configuration is invalid", () => {
  const variables = ["PROJECT_ID", "GOOGLE_CLOUD_PROJECT", "GCP_PROJECT"];
  const previous = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
  variables.forEach((name) => delete process.env[name]);
  const response = responseRecorder();
  healthCheck({}, response);
  variables.forEach((name) => {
    if (previous[name] !== undefined) process.env[name] = previous[name];
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.status, "not_ready");
});
