"use strict";

function createLogger(base = {}) {
  function write(severity, message, fields = {}) {
    const record = {
      severity,
      message,
      ...base,
      ...sanitize(fields),
      timestamp: new Date().toISOString(),
    };
    const output = JSON.stringify(record);
    if (severity === "ERROR" || severity === "CRITICAL") console.error(output);
    else if (severity === "WARNING") console.warn(output);
    else console.log(output);
  }

  return {
    child(fields) {
      return createLogger({ ...base, ...sanitize(fields) });
    },
    debug(message, fields) {
      write("DEBUG", message, fields);
    },
    info(message, fields) {
      write("INFO", message, fields);
    },
    warn(message, fields) {
      write("WARNING", message, fields);
    },
    error(message, fields) {
      write("ERROR", message, fields);
    },
  };
}

function sanitize(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]),
    );
  }
  if (/(authorization|credential|password|secret|token)/i.test(key)) {
    return value ? "[REDACTED]" : value;
  }
  return value;
}

module.exports = { createLogger, sanitize };
