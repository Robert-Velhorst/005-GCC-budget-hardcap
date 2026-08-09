"use strict";

const { createComputeGateway, instanceKey } = require("../src/compute");
const { readConfig } = require("../src/config");
const { createFirestoreStore } = require("../src/store");

async function main() {
  const apply = process.argv.includes("--apply");
  const config = readConfig({ ...process.env, EXECUTION_MODE: "plan" });
  const compute = createComputeGateway(config);
  const store = createFirestoreStore(config);
  const [instances, ambiguous] = await Promise.all([
    compute.listInstances(),
    store.listAmbiguousInstances(config.projectId),
  ]);
  const currentByKey = new Map(instances.map((instance) => [instanceKey(instance), instance]));
  const results = [];

  for (const record of ambiguous) {
    const current = currentByKey.get(record.instanceKey);
    const reconciledState = reconcileState(record.status, current?.status);
    if (apply) await store.markManagedInstance(record.instanceKey, reconciledState, new Date());
    results.push({
      instanceKey: record.instanceKey,
      computeStatus: current?.status || "NOT_FOUND",
      reconciledState,
      applied: apply,
    });
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", count: results.length, results }, null, 2));
}

function reconcileState(auditStatus, computeStatus) {
  if (auditStatus.startsWith("STOP_")) {
    if (computeStatus === "TERMINATED") return "STOP_COMPLETED";
    if (computeStatus === "RUNNING") return "STOP_FAILED_NO_CHANGE";
  }
  if (auditStatus === "START_SUBMITTED") {
    if (computeStatus === "RUNNING") return "START_COMPLETED";
    if (computeStatus === "TERMINATED") return "START_FAILED_NO_CHANGE";
  }
  return "MANUAL_REVIEW_REQUIRED";
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", code: error.code, message: error.message }, null, 2));
  process.exitCode = 1;
});
