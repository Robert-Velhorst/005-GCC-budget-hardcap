"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createControlServer } = require("../src/control/server");

const operatorToken = "o".repeat(32);
const haiToken = "h".repeat(32);

test("control server serves the app and local authenticated API with security headers", async (t) => {
  const fixture = await startServer(t);
  const page = await fetch(`${fixture.url}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Control plane fixture/);
  assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(page.headers.get("x-frame-options"), "DENY");

  const overview = await fetch(`${fixture.url}/api/v1/overview`);
  assert.equal(overview.status, 200);
  assert.equal((await overview.json()).service, "gcc-budget-hardcap");

  const traversal = await fetch(`${fixture.url}/..%2F..%2Fpackage.json`);
  assert.equal(traversal.status, 404);
  assert.equal((await fetch(`${fixture.url}/missing.js`)).status, 404);
  assert.match(await (await fetch(`${fixture.url}/policy`)).text(), /Control plane fixture/);
});

test("public mode requires login and CSRF for policy writes", async (t) => {
  const fixture = await startServer(t, { publicAccessEnabled: true });
  assert.equal((await fetch(`${fixture.url}/api/v1/overview`)).status, 401);

  const login = await fetch(`${fixture.url}/api/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: operatorToken }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const session = await login.json();
  assert.equal(session.mode, "session");

  const rejected = await fetch(`${fixture.url}/api/v1/policy`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ executionMode: "plan" }),
  });
  assert.equal(rejected.status, 403);

  const accepted = await fetch(`${fixture.url}/api/v1/policy`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json", "x-csrf-token": session.csrfToken },
    body: JSON.stringify({ executionMode: "plan" }),
  });
  assert.equal(accepted.status, 200);
});

test("HAI connector completes authenticated MCP initialize, list, and read-only tool calls", async (t) => {
  const fixture = await startServer(t, { publicAccessEnabled: true, haiConnectorEnabled: true });
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${haiToken}`,
  };
  const initialize = await fetch(`${fixture.url}/mcp`, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
  });
  assert.equal(initialize.status, 200);
  const sessionId = initialize.headers.get("mcp-session-id");
  assert.ok(sessionId);
  assert.equal((await initialize.json()).result.serverInfo.name, "gcc-budget-hardcap");

  const tools = await mcpCall(fixture.url, headers, sessionId, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.deepEqual(tools.result.tools.map((tool) => tool.name), ["get_budget_hardcap_status", "list_budget_hardcap_incidents"]);
  const called = await mcpCall(fixture.url, headers, sessionId, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_budget_hardcap_status", arguments: {} } });
  assert.equal(called.result.structuredContent.authority, "read_only_advisory");
  const terminated = await fetch(`${fixture.url}/mcp`, {
    method: "DELETE",
    headers: { ...headers, "mcp-session-id": sessionId },
  });
  assert.ok([200, 204].includes(terminated.status));
});

async function mcpCall(url, headers, sessionId, body) {
  const response = await fetch(`${url}/mcp`, { method: "POST", headers: { ...headers, "mcp-session-id": sessionId }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return response.json();
}

async function startServer(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gcc-web-"));
  fs.writeFileSync(path.join(directory, "index.html"), "<!doctype html><title>Control plane fixture</title>");
  const policy = { projectId: "test", executionMode: "plan" };
  const service = {
    async getOverview() { return { service: "gcc-budget-hardcap", provider: { state: "setup_required" }, timestamp: new Date().toISOString() }; },
    async getPolicy() { return policy; },
    async updatePolicy() { return policy; },
    async previewBudget() { return { status: "PLAN" }; },
    async getHaiContext() { return { authority: "read_only_advisory", recentFailures: [] }; },
  };
  const controlConfig = {
    host: "127.0.0.1", port: 0, publicAccessEnabled: false, trustProxy: false,
    controlPlaneToken: operatorToken, haiConnectorEnabled: false, haiConnectorToken: haiToken,
    sessionTtlMs: 60000, ...overrides,
  };
  const app = createControlServer({ controlConfig, service, webRoot: directory, logger: { error() {} } });
  const address = await app.listen();
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { url: `http://127.0.0.1:${address.port}` };
}
