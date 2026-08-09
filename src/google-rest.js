"use strict";

const COMPUTE_BASE = "https://compute.googleapis.com/compute/v1";
const PUBSUB_BASE = "https://pubsub.googleapis.com/v1";

function createComputeGoogleFactory() {
  const { GoogleAuth } = require("google-auth-library");
  return { auth: { GoogleAuth }, compute: () => createComputeRestClient() };
}

function createPubSubGoogleFactory() {
  const { GoogleAuth } = require("google-auth-library");
  return { auth: { GoogleAuth }, pubsub: () => createPubSubRestClient() };
}

function createComputeRestClient() {
  return {
    instances: {
      aggregatedList(parameters, options) {
        return googleRequest(parameters.auth, {
          url: `${COMPUTE_BASE}/projects/${segment(parameters.project)}/aggregated/instances`,
          params: compact({ pageToken: parameters.pageToken, maxResults: parameters.maxResults }),
        }, options);
      },
      stop: (parameters, options) => instanceAction("stop", parameters, options),
      start: (parameters, options) => instanceAction("start", parameters, options),
    },
    zoneOperations: {
      get(parameters, options) {
        return googleRequest(parameters.auth, {
          url: `${COMPUTE_BASE}/projects/${segment(parameters.project)}/zones/${segment(parameters.zone)}/operations/${segment(parameters.operation)}`,
        }, options);
      },
    },
    projects: {
      get(parameters, options) {
        return googleRequest(parameters.auth, {
          url: `${COMPUTE_BASE}/projects/${segment(parameters.project)}`,
        }, options);
      },
    },
  };
}

function createPubSubRestClient() {
  return {
    projects: {
      topics: {
        publish(parameters, options) {
          return googleRequest(parameters.auth, {
            method: "POST",
            url: `${PUBSUB_BASE}/${resourceName(parameters.topic)}:publish`,
            data: parameters.requestBody,
          }, options);
        },
      },
    },
  };
}

function instanceAction(action, parameters, options) {
  return googleRequest(parameters.auth, {
    method: "POST",
    url: `${COMPUTE_BASE}/projects/${segment(parameters.project)}/zones/${segment(parameters.zone)}/instances/${segment(parameters.instance)}/${action}`,
    params: compact({ requestId: parameters.requestId }),
  }, options);
}

function googleRequest(auth, request, options = {}) {
  if (!auth || typeof auth.request !== "function") throw new TypeError("Google auth request client is required.");
  return auth.request({ ...request, timeout: options.timeout });
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}

function segment(value) {
  if (typeof value !== "string" || !value) throw new TypeError("Google resource segment is required.");
  return encodeURIComponent(value);
}

function resourceName(value) {
  if (typeof value !== "string" || !value) throw new TypeError("Google resource name is required.");
  return value.split("/").map(segment).join("/");
}

module.exports = {
  createComputeGoogleFactory,
  createComputeRestClient,
  createPubSubGoogleFactory,
  createPubSubRestClient,
};
