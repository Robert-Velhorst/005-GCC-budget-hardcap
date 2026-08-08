"use strict";

class AppError extends Error {
  constructor(message, { code = "INTERNAL_ERROR", retryable = false, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

class ConfigurationError extends AppError {
  constructor(message, details) {
    super(message, { code: "CONFIGURATION_ERROR", details });
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(message, { code: "VALIDATION_ERROR", details });
  }
}

class SafetyError extends AppError {
  constructor(message, details) {
    super(message, { code: "SAFETY_ERROR", details });
  }
}

class ProviderError extends AppError {
  constructor(message, { retryable = true, details } = {}) {
    super(message, { code: "PROVIDER_ERROR", retryable, details });
  }
}

module.exports = {
  AppError,
  ConfigurationError,
  ProviderError,
  SafetyError,
  ValidationError,
};
