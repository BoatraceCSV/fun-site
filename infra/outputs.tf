output "web_bucket_name" {
  description = "Name of the web hosting Cloud Storage bucket"
  value       = google_storage_bucket.web.name
}

output "web_bucket_url" {
  description = "URL of the web hosting Cloud Storage bucket"
  value       = google_storage_bucket.web.url
}

output "data_bucket_name" {
  description = "Name of the data Cloud Storage bucket"
  value       = google_storage_bucket.data.name
}

output "batch_job_name" {
  description = "Name of the Cloud Run batch job"
  value       = google_cloud_run_v2_job.batch.name
}

output "batch_service_account_email" {
  description = "Email of the batch processing service account"
  value       = google_service_account.batch.email
}

output "artifact_registry_url" {
  description = "URL of the Artifact Registry Docker repository"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.batch.repository_id}"
}

output "load_balancer_ip" {
  description = "Global IP address of the load balancer (null after web_hosting = firebase_only)"
  value       = try(google_compute_global_address.default[0].address, null)
}

output "firebase_hosting_default_url" {
  description = "Default URL of the Firebase Hosting site (切替前の動作確認用)"
  value       = google_firebase_hosting_site.default.default_url
}

output "firebase_hosting_custom_domain_state" {
  description = "Firebase Hosting custom domain host / ownership / cert state"
  value = {
    host      = google_firebase_hosting_custom_domain.default.host_state
    ownership = google_firebase_hosting_custom_domain.default.ownership_state
    cert      = try(google_firebase_hosting_custom_domain.default.cert[0].state, null)
  }
}

output "site_url" {
  description = "Public URL of the site"
  value       = "https://${var.domain_name}"
}

output "dns_name_servers" {
  description = "Name servers for the DNS zone (configure at your registrar)"
  value       = google_dns_managed_zone.default.name_servers
}

output "csv_mirror_bucket_name" {
  description = "Name of the CSV mirror bucket consumed by fun-site (written by preview-realtime)"
  value       = google_storage_bucket.csv_mirror.name
}

output "realtime_completed_topic" {
  description = "Pub/Sub topic id for the realtime-completed events from preview-realtime"
  value       = google_pubsub_topic.realtime_completed.id
}

output "eventarc_trigger_name" {
  description = "Name of the Eventarc trigger that dispatches realtime-completed events to the dispatcher workflow"
  value       = google_eventarc_trigger.realtime_completed_to_workflow.name
}

output "realtime_dispatcher_workflow" {
  description = "Workflow that executes the fun-site batch Cloud Run Job in response to realtime-completed events"
  value       = google_workflows_workflow.realtime_dispatcher.id
}
