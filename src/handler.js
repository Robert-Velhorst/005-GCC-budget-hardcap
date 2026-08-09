"use strict";

const crypto = require("node:crypto");
const { createComputeGateway, instanceKey, selectManagedInstances } = require("./compute");
const { publicConfig, readConfig } = require("./config");
const { AppError, SafetyError } = require("./errors");
const { parseBudgetEvent, validateEventSource } = require("./event");
const { createLogger } = require("./logger");
const { createNotifier } = require("./notifier");
const { DECISIONS, evaluateBudgetPolicy } = require("./policy");
const { createFirestoreStore } = require("./store");

function createBudgetHandler(dependencies = {}) {
  const runBudgetWorkflow = async function runBudgetWorkflow(event, context = {}) {
    const now = dependencies.now ? dependencies.now() : new Date();
    const config = dependencies.config || readConfig();
    const budgetEvent = parseBudgetEvent(event, context, now);
    validateEventSource(budgetEvent, config, now);

    const logger = (dependencies.logger || createLogger()).child({
      eventId: budgetEvent.eventId,
      budgetDisplayName: budgetEvent.budgetDisplayName,
      projectId: config.projectId,
    });
    const compute = dependencies.compute || createComputeGateway(config);
    const store =
      dependencies.store ||
      (config.executionMode === "execute" ? createFirestoreStore(config) : null);
    const notifier = dependencies.notifier || createNotifier(config);
    const sleep = dependencies.sleep || defaultSleep;
    const policy = evaluateBudgetPolicy(budgetEvent, config);

    logger.info("Budget event accepted and policy evaluated.", {
      costAmount: budgetEvent.costAmount,
      budgetAmount: budgetEvent.budgetAmount,
      currencyCode: budgetEvent.currencyCode,
      decision: policy.decision,
      ratio: policy.ratio,
      executionMode: config.executionMode,
      automationEnabled: config.automationEnabled,
    });

    if (config.executionMode === "plan") {
      return executePlan({ budgetEvent, compute, config, logger, policy });
    }

    let claimed = false;
    try {
      const claim = await store.claimEvent(eventRecord(budgetEvent, policy, config), now);
      claimed = claim.claimed;
      if (!claim.claimed) {
        logger.info("Duplicate or active event ignored.", { reason: claim.reason });
        return summary("IGNORED_DUPLICATE", policy, [], { reason: claim.reason });
      }

      if (!config.automationEnabled) {
        const result = summary("AUTOMATION_DISABLED", policy, [], {
          reason: "The emergency automation switch is disabled.",
        });
        await store.ignoreEvent(budgetEvent.eventId, result, now);
        logger.warn("Automation switch disabled; no provider action allowed.", result);
        return result;
      }

      if (policy.decision === DECISIONS.NO_ACTION) {
        const result = summary("NO_ACTION", policy, []);
        await store.completeEvent(budgetEvent.eventId, result, now);
        return result;
      }

      const cooldown = await checkCooldown(store, config, policy, now);
      if (cooldown.active) {
        const result = summary("IGNORED_COOLDOWN", policy, [], {
          cooldownUntil: cooldown.until.toISOString(),
        });
        await store.ignoreEvent(budgetEvent.eventId, result, now);
        logger.warn("Policy action skipped because the cooldown is active.", result);
        return result;
      }

      const actionPlan = await buildActionPlan({
        budgetEvent,
        compute,
        store,
        config,
        policy,
        now,
      });
      enforceActionLimit(actionPlan, config);

      const completed = await executeActions({
        actionPlan,
        budgetEvent,
        compute,
        config,
        logger,
        store,
        sleep,
        nowProvider: dependencies.now || (() => new Date()),
      });

      const result = summary("COMPLETED", policy, completed);
      await store.updateControlState(
        config.projectId,
        { lastDecision: policy.decision, lastActionAt: now, lastEventId: budgetEvent.eventId },
        now,
      );
      await store.completeEvent(budgetEvent.eventId, result, now);
      await publishNotificationSafely(notifier, logger, {
        type: "BUDGET_HARDCAP_ACTION_COMPLETED",
        eventId: budgetEvent.eventId,
        projectId: config.projectId,
        budgetDisplayName: budgetEvent.budgetDisplayName,
        result,
      });
      logger.info("Budget hardcap workflow completed.", result);
      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Budget hardcap workflow failed.", {
        code: normalized.code,
        retryable: normalized.retryable,
        error: normalized.message,
        details: normalized.details,
      });
      if (claimed) {
        try {
          await store.failEvent(budgetEvent.eventId, normalized, new Date());
        } catch (storeError) {
          logger.error("Failed to persist event failure status.", { error: storeError.message });
        }
      }
      await publishNotificationSafely(notifier, logger, {
        type: "BUDGET_HARDCAP_ACTION_FAILED",
        eventId: budgetEvent.eventId,
        projectId: config.projectId,
        code: normalized.code,
        retryable: normalized.retryable,
      });
      throw normalized;
    }
  };

  return async function manageInstancesOnBudget(event, context = {}) {
    try {
      return await runBudgetWorkflow(event, context);
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.retryable) throw normalized;

      const logger = dependencies.logger || createLogger();
      logger.error("Non-retryable event acknowledged without provider retry.", {
        code: normalized.code,
        error: normalized.message,
        retryable: false,
      });
      return {
        status: "REJECTED_NON_RETRYABLE",
        code: normalized.code,
        reason: normalized.message,
        retryable: false,
        actionCount: 0,
        actions: [],
      };
    }
  };
}

async function executePlan({ budgetEvent, compute, config, logger, policy }) {
  if (!config.automationEnabled) {
    logger.warn("Automation is disabled; producing a read-only plan.");
  }
  if (policy.decision === DECISIONS.NO_ACTION) {
    return summary("PLAN_NO_ACTION", policy, []);
  }
  if (policy.decision === DECISIONS.RECOVER) {
    return summary("PLAN_RECOVERY_REQUIRES_AUDIT_STORE", policy, [], {
      reason: "Recovery targets are intentionally sourced from the production audit store.",
    });
  }

  const instances = await compute.listInstances();
  const candidates = selectManagedInstances(instances, config, "RUNNING");
  enforceActionLimit(candidates, config);
  const actions = candidates.map((instance) => publicAction("stop", instance));
  const result = summary("PLAN", policy, actions, {
    sourceEventId: budgetEvent.eventId,
    configuredScope: publicConfig(config),
  });
  logger.info("Read-only action plan generated.", result);
  return result;
}

async function buildActionPlan({ budgetEvent, compute, store, config, policy, now }) {
  const pendingActions = await store.listPendingActions(budgetEvent.eventId);
  if (pendingActions.length > 0) {
    return pendingActions.map((record) => ({
      action: record.action,
      actionId: record.actionId,
      operationName: record.operationName,
      requestId: record.requestId,
      resumeOperation: true,
      instance: {
        name: record.instanceName,
        zone: record.zone,
      },
    }));
  }

  const instances = await compute.listInstances();
  if (policy.decision === DECISIONS.STOP) {
    return selectManagedInstances(instances, config, "RUNNING").map((instance) => ({
      action: "stop",
      instance,
    }));
  }

  const cutoff = new Date(now.getTime() - config.recoveryDelaySeconds * 1000);
  const recoverable = await store.listRecoverableInstances(config.projectId, cutoff);
  const recoverableKeys = new Set(recoverable.map((record) => record.instanceKey));
  return selectManagedInstances(instances, config, "TERMINATED")
    .filter((instance) => recoverableKeys.has(instanceKey(instance)))
    .map((instance) => ({ action: "start", instance }));
}

async function executeActions({
  actionPlan,
  budgetEvent,
  compute,
  config,
  logger,
  store,
  sleep,
  nowProvider,
}) {
  const completed = [];
  for (let index = 0; index < actionPlan.length; index += 1) {
    const plannedAction = actionPlan[index];
    const { action, instance } = plannedAction;
    const key = instanceKey(instance);
    const requestId =
      plannedAction.requestId || deterministicRequestId(`${budgetEvent.eventId}:${action}:${key}`);
    const actionRecord = {
      eventId: budgetEvent.eventId,
      projectId: config.projectId,
      action,
      instanceKey: key,
      instanceName: instance.name,
      zone: instance.zone,
      requestId,
    };

    let actionId = plannedAction.actionId;
    let operation = plannedAction.resumeOperation
      ? { operationName: plannedAction.operationName, operationStatus: "PENDING" }
      : null;

    try {
      if (!plannedAction.resumeOperation) {
        const intentAt = nowProvider();
        actionId = await store.recordActionIntent(actionRecord, intentAt);
        logger.info("Action intent persisted.", {
          actionId,
          action,
          instance: instance.name,
          zone: instance.zone,
        });

        operation = await compute.submitAction(action, { ...instance, requestId });
        const submittedAt = nowProvider();
        await store.recordActionSubmitted(
          actionId,
          { ...actionRecord, ...operation },
          submittedAt,
        );
        logger.info("Compute Engine action submitted and audited.", {
          ...publicAction(action, instance),
          ...operation,
          status: "SUBMITTED",
        });
      } else {
        logger.info("Resuming a previously submitted Compute Engine operation.", {
          actionId,
          action,
          instance: instance.name,
          zone: instance.zone,
          operationName: operation.operationName,
        });
      }

      const terminalOperation = await compute.waitForOperation(operation.operationName, instance.zone, {
        timeoutMs: config.operationTimeoutSeconds * 1000,
        pollIntervalMs: config.operationPollIntervalMs,
        sleep,
        now: nowProvider,
      });
      const completedAt = nowProvider();
      await store.recordActionCompleted(
        actionId,
        { ...actionRecord, ...operation, ...terminalOperation },
        completedAt,
      );
      const result = {
        ...publicAction(action, instance),
        ...operation,
        ...terminalOperation,
        status: "COMPLETED",
      };
      completed.push(result);
      logger.info("Compute Engine action reached terminal success and was audited.", result);
    } catch (error) {
      const normalized = normalizeError(error);
      const terminalFailure = normalized.details?.terminal === true;
      if (!operation || terminalFailure || !normalized.retryable) {
        await store.recordActionFailed(
          actionId,
          {
            action,
            instanceKey: key,
            errorCode: normalized.code,
            errorMessage: normalized.message,
            retryable: normalized.retryable,
          },
          nowProvider(),
        );
      }
      throw normalized;
    }

    if (index < actionPlan.length - 1 && config.actionDelayMs > 0) {
      await sleep(config.actionDelayMs);
    }
  }
  return completed;
}

async function checkCooldown(store, config, policy, now) {
  if (config.cooldownSeconds === 0) return { active: false };
  const state = await store.getControlState(config.projectId);
  const lastActionAt = state?.lastActionAt?.toDate?.() || state?.lastActionAt;
  if (!lastActionAt || state.lastDecision !== policy.decision) return { active: false };
  const until = new Date(new Date(lastActionAt).getTime() + config.cooldownSeconds * 1000);
  return { active: until > now, until };
}

function enforceActionLimit(actions, config) {
  if (actions.length > config.maxActionsPerEvent) {
    throw new SafetyError(
      `Action plan contains ${actions.length} instances, exceeding MAX_ACTIONS_PER_EVENT=${config.maxActionsPerEvent}.`,
      { plannedActions: actions.length },
    );
  }
}

function deterministicRequestId(seed) {
  const bytes = Buffer.from(crypto.createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function eventRecord(budgetEvent, policy, config) {
  return {
    eventId: budgetEvent.eventId,
    fingerprint: budgetEvent.fingerprint,
    projectId: config.projectId,
    budgetDisplayName: budgetEvent.budgetDisplayName,
    costAmount: budgetEvent.costAmount,
    budgetAmount: budgetEvent.budgetAmount ?? null,
    currencyCode: budgetEvent.currencyCode,
    publishedAt: budgetEvent.publishedAt,
    decision: policy.decision,
    executionMode: config.executionMode,
  };
}

function publicAction(action, instance) {
  return { action, instance: instance.name, zone: instance.zone };
}

function summary(status, policy, actions, extra = {}) {
  return {
    status,
    decision: policy.decision,
    reason: policy.reason,
    actionCount: actions.length,
    actions,
    ...extra,
  };
}

function normalizeError(error) {
  if (error instanceof AppError) return error;
  return new AppError("Unexpected budget hardcap failure.", {
    code: "INTERNAL_ERROR",
    retryable: true,
    details: { cause: error.message },
  });
}

async function publishNotificationSafely(notifier, logger, notification) {
  try {
    await notifier.publish(notification);
  } catch (error) {
    logger.warn("Operator notification could not be published.", { error: error.message });
  }
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = {
  buildActionPlan,
  createBudgetHandler,
  deterministicRequestId,
  enforceActionLimit,
  executeActions,
};
