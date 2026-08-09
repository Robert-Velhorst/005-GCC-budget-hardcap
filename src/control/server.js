"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createAuth } = require("./auth");
const { createHaiMcpHandler } = require("./mcp");

const BODY_LIMIT = 64 * 1024;
const STATIC_CACHE_SECONDS = 31536000;

function createControlServer({ controlConfig, service, webRoot, logger = console, now } = {}) {
  const auth = createAuth(controlConfig, now);
  const mcp = createHaiMcpHandler(service);
  const root = path.resolve(webRoot || path.join(process.cwd(), "web", "dist"));

  const server = http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

      if (request.method === "GET" && url.pathname === "/healthz") {
        return sendJson(response, 200, { status: "ok", service: "gcc-budget-hardcap", timestamp: new Date().toISOString() });
      }
      if (request.method === "GET" && url.pathname === "/readyz") {
        const overview = await service.getOverview();
        return sendJson(response, 200, {
          status: "ready",
          database: "connected",
          provider: overview.provider.state,
          timestamp: overview.timestamp,
        });
      }
      if (request.method === "POST" && url.pathname === "/api/v1/session") {
        const body = await readJson(request);
        const login = auth.login(request, body.token);
        if (login.rateLimited) {
          response.setHeader("retry-after", Math.ceil(login.retryAfter / 1000));
          return sendJson(response, 429, { code: "RATE_LIMITED", message: "Too many login attempts." });
        }
        if (!login.ok) return sendJson(response, 401, { code: "UNAUTHORIZED", message: "Invalid access token." });
        response.setHeader(
          "set-cookie",
          `gcc_session=${encodeURIComponent(login.id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${login.maxAge}${controlConfig.publicAccessEnabled ? "; Secure" : ""}`,
        );
        return sendJson(response, 200, { authenticated: true, csrfToken: login.csrf });
      }
      if (request.method === "GET" && url.pathname === "/api/v1/session") {
        const identity = requireIdentity(request, response, auth, "operator");
        if (!identity) return;
        return sendJson(response, 200, {
          authenticated: true,
          csrfToken: identity.mode === "session" ? identity.session.csrf : null,
          mode: identity.mode,
        });
      }
      if (request.method === "DELETE" && url.pathname === "/api/v1/session") {
        const identity = requireIdentity(request, response, auth, "operator");
        if (!identity) return;
        if (!auth.validCsrf(request, identity)) return sendJson(response, 403, { code: "CSRF_REJECTED", message: "Invalid request origin or CSRF token." });
        auth.logout(request);
        response.setHeader("set-cookie", "gcc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
        return sendJson(response, 200, { authenticated: false });
      }

      if (url.pathname === "/mcp") {
        if (!controlConfig.haiConnectorEnabled) return sendJson(response, 404, { code: "NOT_FOUND", message: "HAI connector is disabled." });
        const identity = requireIdentity(request, response, auth, "hai");
        if (!identity) return;
        if (request.method !== "POST") {
          response.setHeader("allow", "POST");
          return sendJson(response, 405, { code: "METHOD_NOT_ALLOWED", message: "Use POST for MCP requests." });
        }
        return mcp.handle(request, response, await readJson(request));
      }

      if (url.pathname.startsWith("/api/")) {
        const identity = requireIdentity(request, response, auth, "operator");
        if (!identity) return;
        if (!["GET", "HEAD"].includes(request.method) && !auth.validCsrf(request, identity)) {
          return sendJson(response, 403, { code: "CSRF_REJECTED", message: "Invalid request origin or CSRF token." });
        }
        if (request.method === "GET" && url.pathname === "/api/v1/overview") {
          return sendJson(response, 200, await service.getOverview({ refresh: url.searchParams.get("refresh") === "true" }));
        }
        if (request.method === "GET" && url.pathname === "/api/v1/policy") {
          return sendJson(response, 200, await service.getPolicy());
        }
        if (request.method === "PUT" && url.pathname === "/api/v1/policy") {
          return sendJson(response, 200, await service.updatePolicy(await readJson(request)));
        }
        if (request.method === "POST" && url.pathname === "/api/v1/budget/preview") {
          return sendJson(response, 200, await service.previewBudget(await readJson(request)));
        }
        return sendJson(response, 404, { code: "NOT_FOUND", message: "API route not found." });
      }

      if (!["GET", "HEAD"].includes(request.method)) {
        response.setHeader("allow", "GET, HEAD");
        return sendJson(response, 405, { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." });
      }
      return serveStatic(request, response, root, url.pathname);
    } catch (error) {
      const normalized = normalizeControlError(error);
      logger.error?.("Control-plane request failed.", {
        code: normalized.code,
        status: normalized.status,
        path: request.url,
      });
      if (!response.headersSent) sendJson(response, normalized.status, normalized.body);
      else response.destroy();
    }
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 30000;
  server.maxRequestsPerSocket = 1000;

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(controlConfig.port, controlConfig.host, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      });
    },
    async close() {
      await mcp.close();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function requireIdentity(request, response, auth, role) {
  const identity = auth.authenticate(request, role);
  if (identity.authenticated) return identity;
  sendJson(response, 401, { code: "UNAUTHORIZED", message: "Authentication is required." });
  return null;
}

async function readJson(request) {
  const contentType = request.headers["content-type"] || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json.");
    error.status = 415;
    error.code = "UNSUPPORTED_MEDIA_TYPE";
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      error.code = "PAYLOAD_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("Request body is not valid JSON.");
    error.status = 400;
    error.code = "INVALID_JSON";
    throw error;
  }
}

function serveStatic(request, response, root, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let file = safeStaticPath(root, requested);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(root, "index.html");
  }
  if (!fs.existsSync(file)) {
    return sendJson(response, 503, {
      code: "WEB_BUILD_MISSING",
      message: "Run npm run build:web before starting the production control plane.",
    });
  }
  const extension = path.extname(file).toLowerCase();
  response.statusCode = 200;
  response.setHeader("content-type", contentType(extension));
  response.setHeader(
    "cache-control",
    path.basename(file) === "index.html" ? "no-cache" : `public, max-age=${STATIC_CACHE_SECONDS}, immutable`,
  );
  if (request.method === "HEAD") return response.end();
  fs.createReadStream(file).pipe(response);
}

function safeStaticPath(root, requested) {
  try {
    const decoded = decodeURIComponent(requested);
    const resolved = path.resolve(root, decoded);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
  } catch {
    return null;
  }
}

function setSecurityHeaders(response) {
  response.setHeader("content-security-policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
}

function sendJson(response, status, body) {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

function normalizeControlError(error) {
  const status = Number(error.status) || (error.code === "VALIDATION_ERROR" || error.code === "CONFIGURATION_ERROR" ? 400 : 500);
  return {
    status,
    code: error.code || "INTERNAL_ERROR",
    body: {
      code: error.code || "INTERNAL_ERROR",
      message: status >= 500 ? "The control plane could not complete the request." : error.message,
    },
  };
}

function contentType(extension) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
  }[extension] || "application/octet-stream";
}

module.exports = { createControlServer, readJson, safeStaticPath };
