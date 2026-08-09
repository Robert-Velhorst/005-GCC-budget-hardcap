"use strict";

const { ProviderError } = require("./errors");

function createComputeGateway(config, googleFactory = defaultGoogleFactory) {
  const google = googleFactory();
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const compute = google.compute("v1");

  return {
    async listInstances() {
      const instances = [];
      let pageToken;
      do {
        let response;
        try {
          response = await compute.instances.aggregatedList(
            {
              project: config.projectId,
              auth,
              pageToken,
              maxResults: 500,
            },
            requestOptions(config),
          );
        } catch (error) {
          throw providerError("Failed to list Compute Engine instances.", error);
        }

        for (const [scope, data] of Object.entries(response.data.items || {})) {
          if (!scope.startsWith("zones/")) continue;
          const zone = scope.slice("zones/".length);
          for (const instance of data.instances || []) {
            instances.push({
              id: String(instance.id || ""),
              name: instance.name,
              zone,
              status: instance.status,
              labels: { ...(instance.labels || {}) },
            });
          }
        }
        pageToken = response.data.nextPageToken;
      } while (pageToken);
      return instances;
    },

    async submitAction(action, instance) {
      if (action !== "stop" && action !== "start") {
        throw new TypeError(`Unsupported Compute Engine action: ${action}`);
      }
      try {
        const response = await compute.instances[action](
          {
            project: config.projectId,
            zone: instance.zone,
            instance: instance.name,
            auth,
            requestId: instance.requestId,
          },
          requestOptions(config),
        );
        return {
          operationId: String(response.data.id || ""),
          operationName: response.data.name || null,
          operationStatus: response.data.status || "PENDING",
        };
      } catch (error) {
        throw providerError(`Failed to submit ${action} for ${instance.name}.`, error);
      }
    },

    async waitForOperation(operationName, zone, options = {}) {
      if (!operationName) {
        throw new ProviderError("Compute Engine returned no operation name.", { retryable: false });
      }

      const timeoutMs = options.timeoutMs ?? config.operationTimeoutSeconds * 1000;
      const pollIntervalMs = options.pollIntervalMs ?? config.operationPollIntervalMs;
      const sleep = options.sleep || defaultSleep;
      const now = options.now || (() => new Date());
      const deadline = now().getTime() + timeoutMs;

      while (true) {
        let response;
        try {
          response = await compute.zoneOperations.get(
            {
              project: config.projectId,
              zone,
              operation: operationName,
              auth,
            },
            requestOptions(config),
          );
        } catch (error) {
          throw providerError(`Failed to read Compute Engine operation ${operationName}.`, error);
        }

        if (response.data.status === "DONE") {
          const operationErrors = response.data.error?.errors || [];
          if (operationErrors.length > 0) {
            throw operationFailure(operationName, operationErrors);
          }
          return {
            operationId: String(response.data.id || ""),
            operationName: response.data.name || operationName,
            operationStatus: "DONE",
          };
        }

        if (now().getTime() >= deadline) {
          throw new ProviderError(`Compute Engine operation ${operationName} did not finish in time.`, {
            retryable: true,
            details: { operationName, zone, timeoutMs },
          });
        }
        await sleep(pollIntervalMs);
      }
    },

    async getProject() {
      try {
        const response = await compute.projects.get(
          { project: config.projectId, auth },
          requestOptions(config),
        );
        return { id: String(response.data.id || ""), name: response.data.name };
      } catch (error) {
        throw providerError("Failed to verify Compute Engine project access.", error);
      }
    },
  };
}

function selectManagedInstances(instances, config, requiredStatus) {
  return instances.filter((instance) => {
    if (instance.status !== requiredStatus) return false;
    if (instance.labels[config.managedLabelKey] !== config.managedLabelValue) return false;
    if (instance.labels[config.protectedLabelKey] === config.protectedLabelValue) return false;
    if (config.allowedZones.length > 0 && !config.allowedZones.includes(instance.zone)) return false;
    if (config.excludedInstances.includes(instance.name)) return false;
    return true;
  });
}

function instanceKey(instance) {
  return `${instance.zone}/${instance.name}`;
}

function defaultGoogleFactory() {
  return require("./google-rest").createComputeGoogleFactory();
}

function providerError(message, error) {
  const status = Number(error.code || error.response?.status);
  const retryable = !Number.isFinite(status) || status === 408 || status === 429 || status >= 500;
  return new ProviderError(message, {
    retryable,
    details: { status: Number.isFinite(status) ? status : undefined, cause: error.message },
  });
}

function operationFailure(operationName, errors) {
  return new ProviderError(`Compute Engine operation ${operationName} failed.`, {
    retryable: false,
    details: {
      operationName,
      terminal: true,
      errors: errors.map((error) => ({ code: error.code, message: error.message })),
    },
  });
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestOptions(config) {
  return { timeout: config.providerRequestTimeoutMs };
}

module.exports = { createComputeGateway, instanceKey, selectManagedInstances };
