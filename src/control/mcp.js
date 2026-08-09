"use strict";

const crypto = require("node:crypto");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { isInitializeRequest } = require("@modelcontextprotocol/sdk/types.js");

function createHaiMcpHandler(service, options = {}) {
  const sessions = new Map();
  const maxSessions = options.maxSessions || 20;

  async function handle(request, response, body) {
    const sessionId = request.headers["mcp-session-id"];
    let transport = sessionId ? sessions.get(sessionId)?.transport : null;

    if (!transport && !sessionId && isInitializeRequest(body)) {
      if (sessions.size >= maxSessions) closeOldestSession(sessions);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => sessions.set(id, { transport, touchedAt: Date.now() }),
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await buildServer(service).connect(transport);
    } else if (transport && sessionId) {
      sessions.get(sessionId).touchedAt = Date.now();
    }

    if (!transport) {
      sendMcpError(response, 400, -32000, "A valid MCP session or initialize request is required.");
      return;
    }
    await transport.handleRequest(request, response, body);
  }

  async function close() {
    await Promise.all([...sessions.values()].map(({ transport }) => transport.close()));
    sessions.clear();
  }

  return { handle, close, sessionCount: () => sessions.size };
}

function buildServer(service) {
  const server = new McpServer(
    { name: "gcc-budget-hardcap", version: require("../../package.json").version },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "get_budget_hardcap_status",
    {
      title: "Get budget hardcap status",
      description:
        "Read the current budget policy, provider readiness, instance counts, and local audit totals. This tool is advisory and cannot change cloud resources.",
      inputSchema: {},
    },
    async () => textResult(await service.getHaiContext()),
  );

  server.registerTool(
    "list_budget_hardcap_incidents",
    {
      title: "List budget hardcap incidents",
      description:
        "Read recent failed hardcap actions with bounded operational metadata. No credentials, raw provider responses, or mutation capability are returned.",
      inputSchema: {},
    },
    async () => {
      const context = await service.getHaiContext();
      return textResult({ generatedAt: context.generatedAt, incidents: context.recentFailures });
    },
  );

  return server;
}

function textResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function closeOldestSession(sessions) {
  let oldest;
  for (const [id, value] of sessions) {
    if (!oldest || value.touchedAt < oldest.value.touchedAt) oldest = { id, value };
  }
  if (oldest) {
    sessions.delete(oldest.id);
    void oldest.value.transport.close();
  }
}

function sendMcpError(response, status, code, message) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

module.exports = { createHaiMcpHandler };
