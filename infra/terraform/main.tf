provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  required_apis = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudfunctions.googleapis.com",
    "compute.googleapis.com",
    "eventarc.googleapis.com",
    "firestore.googleapis.com",
    "logging.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
  ])
}

resource "google_project_service" "required" {
  for_each           = local.required_apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "random_id" "source_bucket" {
  byte_length = 4
}

resource "google_storage_bucket" "source" {
  name                        = "${var.project_id}-budget-hardcap-source-${random_id.source_bucket.hex}"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false
}

data "archive_file" "source" {
  type        = "zip"
  source_dir  = "${path.module}/../.."
  output_path = "${path.module}/budget-hardcap-source.zip"
  excludes = [
    ".git",
    ".github",
    "coverage",
    "docs",
    "infra",
    "node_modules",
    "test",
    "tmp",
  ]
}

resource "google_storage_bucket_object" "source" {
  name   = "source-${data.archive_file.source.output_md5}.zip"
  bucket = google_storage_bucket.source.name
  source = data.archive_file.source.output_path
}

resource "google_pubsub_topic" "budget_alerts" {
  name = var.budget_topic_name
}

resource "google_pubsub_topic" "operator_notifications" {
  count = var.notification_topic_name == "" ? 0 : 1
  name  = var.notification_topic_name
}

resource "google_firestore_database" "default" {
  count       = var.create_firestore_database ? 1 : 0
  project     = var.project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  deletion_policy = "ABANDON"
  depends_on      = [google_project_service.required]
}

resource "google_firestore_field" "event_expiry" {
  project    = var.project_id
  database   = "(default)"
  collection = "${var.firestore_prefix}_events"
  field      = "expiresAt"

  ttl_config {}
  depends_on = [google_project_service.required]
}

resource "google_firestore_field" "action_expiry" {
  project    = var.project_id
  database   = "(default)"
  collection = "${var.firestore_prefix}_actions"
  field      = "expiresAt"

  ttl_config {}
  depends_on = [google_project_service.required]
}

resource "google_service_account" "function" {
  account_id   = "budget-hardcap-function"
  display_name = "Budget hardcap Cloud Function"
}

resource "google_project_iam_custom_role" "vm_operator" {
  role_id     = "budgetHardcapVmOperator"
  title       = "Budget Hardcap VM Operator"
  description = "Lists, starts, and stops explicitly scoped Compute Engine instances."
  permissions = [
    "compute.instances.get",
    "compute.instances.list",
    "compute.instances.start",
    "compute.instances.stop",
    "compute.projects.get",
    "compute.zoneOperations.get",
  ]
}

resource "google_project_iam_member" "vm_operator" {
  project = var.project_id
  role    = google_project_iam_custom_role.vm_operator.name
  member  = "serviceAccount:${google_service_account.function.email}"
}

resource "google_project_iam_member" "function_roles" {
  for_each = toset([
    "roles/datastore.user",
    "roles/eventarc.eventReceiver",
    "roles/logging.logWriter",
    "roles/pubsub.subscriber",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.function.email}"
}

resource "google_project_iam_member" "notification_publisher" {
  count   = var.notification_topic_name == "" ? 0 : 1
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.function.email}"
}

resource "google_cloudfunctions2_function" "budget_hardcap" {
  name     = "manage-instances-on-budget"
  location = var.region

  build_config {
    runtime     = "nodejs22"
    entry_point = "manageInstancesOnBudget"
    source {
      storage_source {
        bucket = google_storage_bucket.source.name
        object = google_storage_bucket_object.source.name
      }
    }
  }

  service_config {
    available_memory      = "256M"
    timeout_seconds       = 540
    max_instance_count    = 3
    service_account_email = google_service_account.function.email
    environment_variables = {
      PROJECT_ID                  = var.project_id
      EXECUTION_MODE              = var.execution_mode
      AUTOMATION_ENABLED          = tostring(var.automation_enabled)
      ENABLE_AUTOMATIC_RECOVERY   = tostring(var.enable_automatic_recovery)
      ALLOWED_BUDGET_NAMES        = join(",", var.allowed_budget_names)
      EXPECTED_CURRENCY           = upper(var.expected_currency)
      ALLOWED_ZONES               = join(",", var.allowed_zones)
      BUDGET_LIMIT                = tostring(var.budget_limit)
      THRESHOLD_RATIO             = tostring(var.threshold_ratio)
      MAX_ACTIONS_PER_EVENT       = tostring(var.max_actions_per_event)
      OPERATION_TIMEOUT_SECONDS   = tostring(var.operation_timeout_seconds)
      OPERATION_POLL_INTERVAL_MS  = tostring(var.operation_poll_interval_ms)
      PROVIDER_REQUEST_TIMEOUT_MS = tostring(var.provider_request_timeout_ms)
      FIRESTORE_PREFIX            = var.firestore_prefix
      AUDIT_RETENTION_DAYS        = tostring(var.audit_retention_days)
      NOTIFICATION_TOPIC          = var.notification_topic_name
    }
  }

  event_trigger {
    trigger_region        = var.region
    event_type            = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic          = google_pubsub_topic.budget_alerts.id
    retry_policy          = "RETRY_POLICY_RETRY"
    service_account_email = google_service_account.function.email
  }

  depends_on = [
    google_project_service.required,
    google_project_iam_member.function_roles,
    google_project_iam_member.vm_operator,
  ]
}

resource "google_cloudfunctions2_function" "health" {
  name     = "budget-hardcap-health"
  location = var.region

  build_config {
    runtime     = "nodejs22"
    entry_point = "healthCheck"
    source {
      storage_source {
        bucket = google_storage_bucket.source.name
        object = google_storage_bucket_object.source.name
      }
    }
  }

  service_config {
    available_memory      = "128M"
    timeout_seconds       = 30
    max_instance_count    = 2
    ingress_settings      = "ALLOW_ALL"
    service_account_email = google_service_account.function.email
    environment_variables = {
      PROJECT_ID                  = var.project_id
      EXECUTION_MODE              = var.execution_mode
      AUTOMATION_ENABLED          = tostring(var.automation_enabled)
      ENABLE_AUTOMATIC_RECOVERY   = tostring(var.enable_automatic_recovery)
      ALLOWED_BUDGET_NAMES        = join(",", var.allowed_budget_names)
      EXPECTED_CURRENCY           = upper(var.expected_currency)
      ALLOWED_ZONES               = join(",", var.allowed_zones)
      BUDGET_LIMIT                = tostring(var.budget_limit)
      THRESHOLD_RATIO             = tostring(var.threshold_ratio)
      MAX_ACTIONS_PER_EVENT       = tostring(var.max_actions_per_event)
      OPERATION_TIMEOUT_SECONDS   = tostring(var.operation_timeout_seconds)
      OPERATION_POLL_INTERVAL_MS  = tostring(var.operation_poll_interval_ms)
      PROVIDER_REQUEST_TIMEOUT_MS = tostring(var.provider_request_timeout_ms)
      FIRESTORE_PREFIX            = var.firestore_prefix
      AUDIT_RETENTION_DAYS        = tostring(var.audit_retention_days)
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_service_iam_member" "health_invoker" {
  for_each = toset(var.health_invoker_members)
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.health.name
  role     = "roles/run.invoker"
  member   = each.value
}
