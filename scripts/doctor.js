"use strict";

const { createComputeGateway } = require("../src/compute");
const { publicConfig, readConfig } = require("../src/config");
const { createFirestoreStore } = require("../src/store");

async function main() {
  const verifyProvider = process.argv.includes("--provider");
  const config = readConfig();
  const report = {
    status: "ok",
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    config: publicConfig(config),
    checks: [{ name: "configuration", status: "passed" }],
  };

  if (verifyProvider) {
    const compute = createComputeGateway(config);
    const store = createFirestoreStore(config);
    const [project, instances] = await Promise.all([
      compute.getProject(),
      compute.listInstances(),
      store.getControlState(config.projectId),
    ]);
    report.checks.push({ name: "compute-project-access", status: "passed", project });
    report.checks.push({
      name: "compute-inventory-access",
      status: "passed",
      instanceCount: instances.length,
    });
    report.checks.push({ name: "firestore-read-access", status: "passed" });
  } else {
    report.checks.push({
      name: "compute-project-access",
      status: "not-run",
      reason: "Run npm run doctor -- --provider with Application Default Credentials.",
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", code: error.code, message: error.message }, null, 2));
  process.exitCode = 1;
});
