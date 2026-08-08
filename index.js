"use strict";

const { createBudgetHandler } = require("./src/handler");
const { healthCheck } = require("./src/health");

exports.manageInstancesOnBudget = createBudgetHandler();
exports.healthCheck = healthCheck;
