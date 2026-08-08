"use strict";

const { publicConfig, readConfig } = require("./config");

function healthCheck(request, response) {
  try {
    const config = readConfig();
    response.status(200).json({
      status: "ok",
      service: "gcc-budget-hardcap",
      config: publicConfig(config),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    response.status(503).json({
      status: "not_ready",
      service: "gcc-budget-hardcap",
      code: error.code || "CONFIGURATION_ERROR",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = { healthCheck };
