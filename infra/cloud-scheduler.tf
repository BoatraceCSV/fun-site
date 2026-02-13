resource "google_cloud_scheduler_job" "daily_batch" {
  name        = "${local.prefix}-daily-batch"
  description = "Triggers the daily batch job at AM 2:00 JST"
  schedule    = var.batch_schedule
  time_zone   = var.batch_timezone
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.batch.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  retry_config {
    retry_count          = 3
    min_backoff_duration = "10s"
    max_backoff_duration = "300s"
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}
