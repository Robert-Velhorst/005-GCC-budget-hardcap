"use strict";

const { publicConfig, readConfig } = require("../src/config");

try {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    service: "gcc-budget-hardcap",
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    config: publicConfig(readConfig()),
    note: "This bundle deliberately excludes credentials, environment values not on the allowlist, and cloud data.",
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    service: "gcc-budget-hardcap",
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    configurationStatus: "invalid",
    error: error.message,
  }, null, 2));
  process.exitCode = 1;
}
