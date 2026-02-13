# -----------------------------------------------------------------------------
# Notification channel (email)
# -----------------------------------------------------------------------------
resource "google_monitoring_notification_channel" "email" {
  display_name = "${local.prefix} Alert Email"
  type         = "email"

  labels = {
    email_address = var.alert_notification_email
  }
}

# -----------------------------------------------------------------------------
# Alert: Batch job failure
# -----------------------------------------------------------------------------
resource "google_monitoring_alert_policy" "batch_failure" {
  display_name = "${local.prefix}-batch-failure"
  combiner     = "OR"

  conditions {
    display_name = "Cloud Run Job execution failed"

    condition_matched_log {
      filter = <<-EOT
        resource.type="cloud_run_job"
        resource.labels.job_name="${google_cloud_run_v2_job.batch.name}"
        resource.labels.location="${var.region}"
        severity>=ERROR
      EOT
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  documentation {
    content   = "The daily batch job `${google_cloud_run_v2_job.batch.name}` has failed. Check Cloud Run Jobs logs for details."
    mime_type = "text/markdown"
  }
}

# -----------------------------------------------------------------------------
# Log-based metric: batch execution duration
# -----------------------------------------------------------------------------
resource "google_logging_metric" "batch_duration" {
  name   = "${local.prefix}-batch-duration"
  filter = <<-EOT
    resource.type="cloud_run_job"
    resource.labels.job_name="${google_cloud_run_v2_job.batch.name}"
    resource.labels.location="${var.region}"
    textPayload=~"duration"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "s"
    display_name = "Batch Job Duration"
  }
}

# -----------------------------------------------------------------------------
# Dashboard: project overview
# -----------------------------------------------------------------------------
resource "google_monitoring_dashboard" "overview" {
  dashboard_json = jsonencode({
    displayName = "${local.prefix} Overview"
    gridLayout = {
      columns = 2
      widgets = [
        {
          title = "Cloud Run Job Executions"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"${google_cloud_run_v2_job.batch.name}\""
                  aggregation = {
                    alignmentPeriod  = "3600s"
                    perSeriesAligner = "ALIGN_COUNT"
                  }
                }
              }
            }]
          }
        },
        {
          title = "CDN Request Count"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"https_lb_rule\" AND metric.type=\"loadbalancing.googleapis.com/https/request_count\""
                  aggregation = {
                    alignmentPeriod  = "3600s"
                    perSeriesAligner = "ALIGN_RATE"
                  }
                }
              }
            }]
          }
        },
        {
          title = "CDN Cache Hit Ratio"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"https_lb_rule\" AND metric.type=\"loadbalancing.googleapis.com/https/backend_request_count\""
                  aggregation = {
                    alignmentPeriod  = "3600s"
                    perSeriesAligner = "ALIGN_RATE"
                  }
                }
              }
            }]
          }
        },
        {
          title = "Storage Bucket Size"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"gcs_bucket\" AND metric.type=\"storage.googleapis.com/storage/total_bytes\""
                  aggregation = {
                    alignmentPeriod  = "86400s"
                    perSeriesAligner = "ALIGN_MEAN"
                  }
                }
              }
            }]
          }
        },
      ]
    }
  })
}
