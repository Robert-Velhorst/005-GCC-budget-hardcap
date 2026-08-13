variable "project_id" {
  description = "Google Cloud project containing the function and managed VMs."
  type        = string
}

variable "region" {
  description = "Function region."
  type        = string
  default     = "europe-west4"
}

variable "budget_topic_name" {
  description = "Pub/Sub topic receiving Cloud Billing budget notifications."
  type        = string
  default     = "budget-alerts"
}

variable "allowed_budget_names" {
  description = "Exact Cloud Billing budget display names accepted by the function."
  type        = list(string)
}

variable "expected_currency" {
  description = "ISO 4217 currency expected in budget notifications."
  type        = string
}

variable "allowed_zones" {
  description = "Zones in which VM actions are permitted."
  type        = list(string)
}

variable "execution_mode" {
  description = "Use plan for initial deployment; switch to execute only after verification."
  type        = string
  default     = "plan"
  validation {
    condition     = contains(["plan", "execute"], var.execution_mode)
    error_message = "execution_mode must be plan or execute."
  }
}

variable "automation_enabled" {
  description = "Emergency enable switch. Keep false during initial deployment."
  type        = bool
  default     = false
}

variable "enable_automatic_recovery" {
  description = "Automatically restart only selected VMs this automation recorded as stopped."
  type        = bool
  default     = true
}

variable "budget_limit" {
  type    = number
  default = 10
}

variable "threshold_ratio" {
  type    = number
  default = 1
}

variable "max_actions_per_event" {
  type    = number
  default = 20
}

variable "operation_timeout_seconds" {
  description = "Maximum time an invocation waits for each Compute operation."
  type        = number
  default     = 180
  validation {
    condition     = var.operation_timeout_seconds >= 10 && var.operation_timeout_seconds <= 480
    error_message = "operation_timeout_seconds must be between 10 and 480."
  }
}

variable "operation_poll_interval_ms" {
  description = "Delay between Compute operation status checks."
  type        = number
  default     = 2000
}

variable "provider_request_timeout_ms" {
  description = "Per-request timeout for Google provider API calls."
  type        = number
  default     = 8000
  validation {
    condition     = var.provider_request_timeout_ms >= 1000 && var.provider_request_timeout_ms <= 60000
    error_message = "provider_request_timeout_ms must be between 1000 and 60000."
  }
}

variable "firestore_prefix" {
  description = "Prefix used for Firestore audit and control collections."
  type        = string
  default     = "budgetHardcap"
}

variable "audit_retention_days" {
  description = "TTL for event and action audit records."
  type        = number
  default     = 90
  validation {
    condition     = var.audit_retention_days >= 1 && var.audit_retention_days <= 3650
    error_message = "audit_retention_days must be between 1 and 3650."
  }
}

variable "notification_topic_name" {
  description = "Optional existing topic for operator outcome notifications."
  type        = string
  default     = ""
}

variable "create_firestore_database" {
  description = "Create the default Firestore Native database. Set false when it already exists."
  type        = bool
  default     = true
}

variable "firestore_location" {
  description = "Firestore location used only when creating the default database."
  type        = string
  default     = "eur3"
}

variable "health_invoker_members" {
  description = "IAM members allowed to invoke the authenticated health function."
  type        = list(string)
  default     = []
}
