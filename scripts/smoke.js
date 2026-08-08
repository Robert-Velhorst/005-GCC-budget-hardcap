"use strict";

const { createBudgetHandler } = require("../src/handler");
const { readConfig } = require("../src/config");

async function main() {
  console.log("TEST-ONLY PROVIDER LAB: no Google Cloud resources will be changed.");
  const config = readConfig({
    PROJECT_ID: "smoke-test-project",
    EXECUTION_MODE: "plan",
    AUTOMATION_ENABLED: "false",
    BUDGET_LIMIT: "10",
    ALLOWED_ZONES: "europe-west4-a",
  });
  const event = {
    id: "smoke-event",
    time: new Date().toISOString(),
    data: {
      message: {
        messageId: "smoke-message",
        publishTime: new Date().toISOString(),
        data: Buffer.from(JSON.stringify({
          budgetDisplayName: "Smoke test budget",
          costAmount: 10,
          budgetAmount: 10,
          currencyCode: "EUR",
          alertThresholdExceeded: 1,
        })).toString("base64"),
      },
    },
  };
  const result = await createBudgetHandler({
    config,
    compute: {
      listInstances: async () => [{
        id: "test-id",
        name: "smoke-vm",
        zone: "europe-west4-a",
        status: "RUNNING",
        labels: { "budget-hardcap": "true" },
      }],
    },
    notifier: { publish: async () => {} },
  })(event);
  if (result.status !== "PLAN" || result.actionCount !== 1) {
    throw new Error(`Critical-path smoke test failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify({ status: "passed", result }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
