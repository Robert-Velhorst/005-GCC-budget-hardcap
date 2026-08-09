"use strict";

const crypto = require("node:crypto");
const { publicConfig, validateConfig } = require("../config");
const { ConfigurationError, ValidationError } = require("../errors");
const { createBudgetHandler } = require("../handler");

function createControlService({ appConfig, controlConfig, store, compute, now } = {}) {
  if (!appConfig || !controlConfig || !store) throw new TypeError("Control service dependencies are required.");
  let gateway = compute;
  const nowProvider = now || (() => new Date());
  const providerCache = createCache(controlConfig.providerCacheMs, nowProvider);
  let service;

  async function effectiveConfig() {
    const saved = (await store.getSetting("policy")) || {};
    const candidate = Object.freeze({ ...appConfig, ...saved });
    validateConfig(candidate);
    return candidate;
  }

  async function providerSnapshot(force = false) {
    return providerCache.get(async () => {
      try {
        const provider = getGateway();
        const [project, instances] = await withTimeout(
          Promise.all([provider.getProject(), provider.listInstances()]),
          appConfig.providerRequestTimeoutMs + 1000,
        );
        const config = await effectiveConfig();
        return {
          state: "connected",
          checkedAt: nowProvider().toISOString(),
          project,
          instances: instances.map((instance) => describeInstance(instance, config)),
          error: null,
        };
      } catch (error) {
        return {
          state: error.retryable ? "unavailable" : "setup_required",
          checkedAt: nowProvider().toISOString(),
          project: null,
          instances: [],
          error: { code: error.code || "PROVIDER_ERROR", message: error.message },
        };
      }
    }, force);
  }

  async function auditSnapshot(config) {
    try {
      const [actions, events, managed, stats] = await Promise.all([
        store.listActions(20),
        store.listEvents(60),
        store.listManagedInstances(config.projectId),
        store.getStats(),
      ]);
      return {
        state: "connected",
        source: controlConfig.auditSource || store.auditSource || "local",
        actions,
        events,
        managed,
        stats,
        error: null,
      };
    } catch (error) {
      return {
        state: "unavailable",
        source: controlConfig.auditSource || store.auditSource || "local",
        actions: [],
        events: [],
        managed: [],
        stats: emptyStats(),
        error: { code: error.code || "AUDIT_ERROR", message: error.message },
      };
    }
  }

  service = {
    async getOverview({ refresh = false } = {}) {
      const config = await effectiveConfig();
      const [provider, audit] = await Promise.all([
        providerSnapshot(refresh),
        auditSnapshot(config),
      ]);
      return {
        service: "gcc-budget-hardcap",
        version: require("../../package.json").version,
        timestamp: nowProvider().toISOString(),
        policy: publicConfig(config),
        budget: summarizeBudget(audit.events, config),
        provider,
        audit: { state: audit.state, source: audit.source, error: audit.error },
        managedAudit: audit.managed,
        actions: audit.actions,
        events: audit.events.slice(0, 20),
        stats: audit.stats,
        integrations: integrations(controlConfig, provider, audit),
      };
    },

    async getPolicy() {
      return publicConfig(await effectiveConfig());
    },

    async updatePolicy(input) {
      const current = await effectiveConfig();
      const patch = policyPatch(input);
      const candidate = Object.freeze({ ...current, ...patch });
      validateConfig(candidate);
      if (candidate.executionMode === "execute" && input.confirmation !== "ENABLE EXECUTION") {
        throw new ValidationError("Type ENABLE EXECUTION to switch the local policy to execute mode.");
      }
      const persisted = {
        executionMode: candidate.executionMode,
        automationEnabled: candidate.automationEnabled,
        enableAutomaticRecovery: candidate.enableAutomaticRecovery,
        budgetLimit: candidate.budgetLimit,
        thresholdRatio: candidate.thresholdRatio,
        maxActionsPerEvent: candidate.maxActionsPerEvent,
      };
      await store.setSetting("policy", persisted, nowProvider());
      providerCache.clear();
      return publicConfig(candidate);
    },

    async previewBudget(input) {
      const config = Object.freeze({
        ...(await effectiveConfig()),
        executionMode: "plan",
        automationEnabled: false,
      });
      const eventId = `manual-${crypto.randomUUID()}`;
      const event = manualCloudEvent(input, eventId, nowProvider());
      const handler = createBudgetHandler({ config, compute: getGateway(), now: nowProvider });
      return handler(event);
    },

    async getHaiContext() {
      const overview = await service.getOverview();
      return {
        generatedAt: overview.timestamp,
        service: overview.service,
        version: overview.version,
        projectId: overview.policy.projectId,
        policy: overview.policy,
        budget: overview.budget,
        provider: {
          state: overview.provider.state,
          checkedAt: overview.provider.checkedAt,
          instanceCounts: countInstances(overview.provider.instances),
        },
        audit: { ...overview.stats, ...overview.audit },
        recentFailures: overview.actions
          .filter((action) => action.status.includes("FAILED"))
          .slice(0, 10)
          .map((action) => ({
            actionId: action.actionId,
            action: action.action,
            instanceName: action.instanceName,
            zone: action.zone,
            status: action.status,
            errorCode: action.errorCode,
            updatedAt: action.updatedAt,
          })),
        authority: "read_only_advisory",
      };
    },

    invalidateProviderCache() {
      providerCache.clear();
    },
  };
  return service;

  function getGateway() {
    if (!gateway) gateway = require("../compute").createComputeGateway(appConfig);
    return gateway;
  }
}

function policyPatch(input = {}) {
  const patch = {};
  if (input.executionMode !== undefined) {
    if (!["plan", "execute"].includes(input.executionMode)) {
      throw new ValidationError("executionMode must be plan or execute.");
    }
    patch.executionMode = input.executionMode;
  }
  for (const name of ["automationEnabled", "enableAutomaticRecovery"]) {
    if (input[name] !== undefined) {
      if (typeof input[name] !== "boolean") throw new ValidationError(`${name} must be boolean.`);
      patch[name] = input[name];
    }
  }
  for (const [name, min, max] of [
    ["budgetLimit", 0.01, 1e12],
    ["thresholdRatio", 0.01, 10],
    ["maxActionsPerEvent", 1, 100],
  ]) {
    if (input[name] !== undefined) {
      const value = Number(input[name]);
      if (!Number.isFinite(value) || value < min || value > max) {
        throw new ValidationError(`${name} must be between ${min} and ${max}.`);
      }
      if (name === "maxActionsPerEvent" && !Number.isInteger(value)) {
        throw new ValidationError("maxActionsPerEvent must be an integer.");
      }
      patch[name] = value;
    }
  }
  if (patch.executionMode === "execute" && patch.automationEnabled !== true) {
    patch.automationEnabled = false;
  }
  return patch;
}

function describeInstance(instance, config) {
  const managed = instance.labels[config.managedLabelKey] === config.managedLabelValue;
  const protectedInstance = instance.labels[config.protectedLabelKey] === config.protectedLabelValue;
  const allowedZone = config.allowedZones.length === 0 || config.allowedZones.includes(instance.zone);
  const excluded = config.excludedInstances.includes(instance.name);
  return {
    ...instance,
    managed,
    protected: protectedInstance,
    eligible: managed && !protectedInstance && allowedZone && !excluded,
    scopeReason: !managed
      ? "Missing managed label"
      : protectedInstance
        ? "Protected"
        : !allowedZone
          ? "Zone excluded"
          : excluded
            ? "Instance excluded"
            : "Eligible",
  };
}

function summarizeBudget(events, config) {
  const points = events
    .filter((event) => Number.isFinite(event.costAmount))
    .map((event) => ({
      timestamp: event.publishTime || event.updatedAt,
      costAmount: event.costAmount,
      budgetAmount: event.budgetAmount || null,
      currencyCode: event.currencyCode || config.expectedCurrency || null,
    }))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const latest = points.at(-1) || null;
  const limit = latest?.budgetAmount || config.budgetLimit;
  return {
    state: latest ? "observed" : "empty",
    latest,
    points: points.slice(-60),
    limit,
    thresholdAmount: limit * config.thresholdRatio,
    ratio: latest && limit > 0 ? latest.costAmount / limit : null,
    caveat: "Cloud Billing budget notifications can be delayed and are not an instantaneous hard cap.",
  };
}

function integrations(controlConfig, provider, audit) {
  const values = [
    { id: "google-cloud", name: "Google Cloud", state: provider.state, detail: provider.error?.message || "Compute API connected" },
    {
      id: "local-database",
      name: "Local database",
      state: "connected",
      detail: audit.source === "local" ? "SQLite WAL settings and audit" : "SQLite WAL settings",
    },
    {
      id: "ngrok",
      name: "ngrok tunnel",
      state: controlConfig.publicAccessEnabled ? "configured" : "disabled",
      detail: controlConfig.publicAccessEnabled ? "Token-protected public mode" : "Loopback only",
    },
    {
      id: "hai",
      name: "HAI",
      state: controlConfig.haiConnectorEnabled ? "configured" : "disabled",
      detail: controlConfig.haiConnectorEnabled ? "Read-only MCP context" : "Connector disabled",
    },
  ];
  if (audit.source === "firestore") {
    values.splice(2, 0, {
      id: "cloud-audit",
      name: "Cloud audit",
      state: audit.state,
      detail: audit.error?.message || "Firestore worker history",
    });
  }
  return values;
}

function emptyStats() {
  return { eventCount: 0, actionCount: 0, pendingActions: 0, failedActions: 0 };
}

function countInstances(instances) {
  return instances.reduce(
    (counts, instance) => {
      counts.total += 1;
      if (instance.eligible) counts.eligible += 1;
      if (instance.protected) counts.protected += 1;
      if (instance.status === "RUNNING") counts.running += 1;
      if (instance.status === "TERMINATED") counts.stopped += 1;
      return counts;
    },
    { total: 0, eligible: 0, protected: 0, running: 0, stopped: 0 },
  );
}

function manualCloudEvent(input, eventId, now) {
  if (!input || typeof input !== "object") throw new ValidationError("Budget preview body is required.");
  const payload = {
    budgetDisplayName: input.budgetDisplayName,
    costAmount: input.costAmount,
    budgetAmount: input.budgetAmount,
    currencyCode: input.currencyCode,
    alertThresholdExceeded: input.alertThresholdExceeded,
    forecastThresholdExceeded: input.forecastThresholdExceeded,
  };
  return {
    id: eventId,
    time: now.toISOString(),
    data: {
      message: {
        messageId: eventId,
        publishTime: now.toISOString(),
        data: Buffer.from(JSON.stringify(payload)).toString("base64"),
      },
    },
  };
}

function createCache(ttlMs, now) {
  let value;
  let expiresAt = 0;
  let pending;
  return {
    async get(loader, force) {
      const time = now().getTime();
      if (!force && value && time < expiresAt) return value;
      if (!force && pending) return pending;
      pending = Promise.resolve(loader()).then((loaded) => {
        value = loaded;
        expiresAt = now().getTime() + ttlMs;
        pending = null;
        return loaded;
      }, (error) => {
        pending = null;
        throw error;
      });
      return pending;
    },
    clear() {
      value = undefined;
      expiresAt = 0;
    },
  };
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`Google Cloud provider probe exceeded ${timeoutMs} ms.`);
      error.code = "PROVIDER_TIMEOUT";
      error.retryable = true;
      reject(error);
    }, timeoutMs);
    timeout.unref?.();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout));
}

module.exports = { createControlService, policyPatch, withTimeout };
