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
  description = "Allow recovery only for VMs this automation recorded as stopped."
  type        = bool
  default     = false
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
