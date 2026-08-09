"use strict";

function createControlStore({ local, audit = local, auditSource = "local" } = {}) {
  if (!local || !audit) throw new TypeError("Local and audit stores are required.");

  return {
    auditSource,
    getSetting: (...args) => local.getSetting(...args),
    setSetting: (...args) => local.setSetting(...args),
    listActions: (...args) => audit.listActions(...args),
    listEvents: (...args) => audit.listEvents(...args),
    listManagedInstances: (...args) => audit.listManagedInstances(...args),
    getStats: (...args) => audit.getStats(...args),
    async close() {
      if (audit !== local) await audit.close?.();
      await local.close?.();
    },
  };
}

module.exports = { createControlStore };
