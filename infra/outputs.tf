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
  description = "Global IP address of the load balancer"
  value       = google_compute_global_address.default.address
}

output "site_url" {
  description = "Public URL of the site"
  value       = "https://${var.domain_name}"
}

output "dns_name_servers" {
  description = "Name servers for the DNS zone (configure at your registrar)"
  value       = google_dns_managed_zone.default.name_servers
}
