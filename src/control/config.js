"use strict";

const path = require("node:path");
const { ConfigurationError } = require("../errors");

function readControlConfig(env = process.env, cwd = process.cwd()) {
  const host = optionalString(env.CONTROL_HOST) || "127.0.0.1";
  const publicAccessEnabled = parseBoolean(
    env.PUBLIC_ACCESS_ENABLED,
    false,
    "PUBLIC_ACCESS_ENABLED",
  );
  const trustProxy = parseBoolean(env.TRUST_PROXY, false, "TRUST_PROXY");
  const haiConnectorEnabled = parseBoolean(
    env.HAI_CONNECTOR_ENABLED,
    false,
    "HAI_CONNECTOR_ENABLED",
  );
  const controlPlaneToken = optionalString(env.CONTROL_PLANE_TOKEN);
  const haiConnectorToken = optionalString(env.HAI_CONNECTOR_TOKEN);
  const auditSource = optionalString(env.CONTROL_AUDIT_SOURCE) || "local";

  if (!["local", "firestore"].includes(auditSource)) {
    throw new ConfigurationError("CONTROL_AUDIT_SOURCE must be 'local' or 'firestore'.");
  }

  if (!isLoopbackHost(host) && !publicAccessEnabled) {
    throw new ConfigurationError(
      "CONTROL_HOST must be loopback unless PUBLIC_ACCESS_ENABLED=true.",
    );
  }
  if (publicAccessEnabled && !isStrongToken(controlPlaneToken)) {
    throw new ConfigurationError(
      "Public access requires CONTROL_PLANE_TOKEN with at least 32 characters.",
    );
  }
  if (haiConnectorEnabled && !isStrongToken(haiConnectorToken)) {
    throw new ConfigurationError(
      "HAI connector access requires HAI_CONNECTOR_TOKEN with at least 32 characters.",
    );
  }
  if (controlPlaneToken && haiConnectorToken && controlPlaneToken === haiConnectorToken) {
    throw new ConfigurationError("Operator and HAI connector tokens must be different.");
  }

  const databasePath = path.resolve(
    cwd,
    optionalString(env.LOCAL_DATABASE_PATH) || path.join(".runtime", "budget-hardcap.db"),
  );

  return Object.freeze({
    host,
    port: parsePort(env.CONTROL_PORT || "8787"),
    databasePath,
    publicAccessEnabled,
    trustProxy,
    controlPlaneToken,
    haiConnectorEnabled,
    haiConnectorToken,
    auditSource,
    sessionTtlMs: parseInteger(env.SESSION_TTL_MINUTES, 480, "SESSION_TTL_MINUTES", 15, 1440) * 60000,
    providerCacheMs: parseInteger(env.PROVIDER_CACHE_SECONDS, 30, "PROVIDER_CACHE_SECONDS", 5, 300) * 1000,
  });
}

function parseBoolean(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ConfigurationError(`${name} must be 'true' or 'false'.`);
}

function parsePort(value) {
  return parseInteger(value, 8787, "CONTROL_PORT", 1, 65535);
}

function parseInteger(value, fallback, name, min, max) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigurationError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isLoopbackHost(host) {
  return ["127.0.0.1", "::1", "localhost"].includes(host.toLowerCase());
}

function isStrongToken(token) {
  return typeof token === "string" && token.length >= 32;
}

module.exports = { isLoopbackHost, readControlConfig };
