"use strict";

const { ProviderError } = require("./errors");

function createNotifier(config, googleFactory = defaultGoogleFactory) {
  if (!config.notificationTopic) return { publish: async () => {} };
  const google = googleFactory();
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const pubsub = google.pubsub("v1");
  const topic = normalizeTopic(config.projectId, config.notificationTopic);

  return {
    async publish(notification) {
      try {
        await pubsub.projects.topics.publish({
          topic,
          auth,
          requestBody: {
            messages: [{ data: Buffer.from(JSON.stringify(notification)).toString("base64") }],
          },
        });
      } catch (error) {
        throw new ProviderError("Failed to publish the operator notification.", {
          retryable: true,
          details: { cause: error.message },
        });
      }
    },
  };
}

function normalizeTopic(projectId, topic) {
  return topic.startsWith("projects/") ? topic : `projects/${projectId}/topics/${topic}`;
}

function defaultGoogleFactory() {
  return require("googleapis").google;
}

module.exports = { createNotifier, normalizeTopic };
