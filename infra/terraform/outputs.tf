output "function_name" {
  value = google_cloudfunctions2_function.budget_hardcap.name
}

output "budget_topic" {
  value = google_pubsub_topic.budget_alerts.id
}

output "function_service_account" {
  value = google_service_account.function.email
}

output "health_uri" {
  value = google_cloudfunctions2_function.health.service_config[0].uri
}
