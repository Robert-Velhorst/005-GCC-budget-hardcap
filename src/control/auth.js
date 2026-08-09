"use strict";

const crypto = require("node:crypto");

function createAuth(controlConfig, now = () => Date.now()) {
  const sessions = new Map();
  const attempts = new Map();

  function authenticate(request, role = "operator") {
    if (role === "hai") {
      return tokenIdentity(request, controlConfig.haiConnectorToken, "hai");
    }

    if (isSafeLocalRequest(request) && !controlConfig.publicAccessEnabled) {
      return { authenticated: true, role: "operator", mode: "local" };
    }
    const bearer = tokenIdentity(request, controlConfig.controlPlaneToken, "operator");
    if (bearer.authenticated) return bearer;

    const sessionId = parseCookies(request.headers.cookie || "").gcc_session;
    const session = sessions.get(sessionId);
    if (!session || session.expiresAt <= now()) {
      if (sessionId) sessions.delete(sessionId);
      return { authenticated: false };
    }
    session.expiresAt = now() + controlConfig.sessionTtlMs;
    return { authenticated: true, role: "operator", mode: "session", session };
  }

  function login(request, token) {
    const key = clientKey(request);
    const state = attempts.get(key) || { count: 0, resetAt: now() + 60000 };
    if (state.resetAt <= now()) {
      state.count = 0;
      state.resetAt = now() + 60000;
    }
    if (state.count >= 5) return { ok: false, rateLimited: true, retryAfter: state.resetAt - now() };

    if (!safeEqual(token, controlConfig.controlPlaneToken)) {
      state.count += 1;
      attempts.set(key, state);
      return { ok: false, rateLimited: false };
    }

    attempts.delete(key);
    pruneSessions();
    const id = crypto.randomBytes(32).toString("base64url");
    const csrf = crypto.randomBytes(24).toString("base64url");
    sessions.set(id, { csrf, expiresAt: now() + controlConfig.sessionTtlMs });
    return { ok: true, id, csrf, maxAge: Math.floor(controlConfig.sessionTtlMs / 1000) };
  }

  function logout(request) {
    const id = parseCookies(request.headers.cookie || "").gcc_session;
    if (id) sessions.delete(id);
  }

  function validCsrf(request, identity) {
    if (identity.mode !== "session") return true;
    return safeEqual(request.headers["x-csrf-token"], identity.session.csrf) && sameOrigin(request);
  }

  function isSafeLocalRequest(request) {
    if (request.headers.forwarded || request.headers["x-forwarded-for"] || request.headers["x-real-ip"]) {
      return false;
    }
    const address = String(request.socket.remoteAddress || "").replace(/^::ffff:/, "");
    return address === "127.0.0.1" || address === "::1";
  }

  function pruneSessions() {
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now()) sessions.delete(id);
    }
    while (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
  }

  return { authenticate, login, logout, validCsrf, isSafeLocalRequest };
}

function tokenIdentity(request, expected, role) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return safeEqual(token, expected)
    ? { authenticated: true, role, mode: "bearer" }
    : { authenticated: false };
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function safeEqual(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string" || !actual || !expected) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  return header.split(";").reduce((cookies, item) => {
    const index = item.indexOf("=");
    if (index < 1) return cookies;
    cookies[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
    return cookies;
  }, {});
}

function clientKey(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

module.exports = { createAuth, safeEqual };
