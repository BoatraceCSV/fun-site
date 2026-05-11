variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all resources. preview-realtime と統一するため asia-northeast1 を採用。"
  type        = string
  default     = "asia-northeast1"
}

variable "project_name" {
  description = "Project name used as prefix for resource naming"
  type        = string
  default     = "fun-site"
}

variable "domain_name" {
  description = "Custom domain name for the site"
  type        = string
}

# 旧朝バッチ用の batch_schedule / batch_timezone 変数は、preview-realtime → Pub/Sub →
# Eventarc 駆動への移行に伴い廃止。当日初回ビルドは preview-realtime の JST 08:00
# (Scheduler `preview-realtime-daytime`) 発火で自動的に走る。

variable "batch_cpu" {
  description = "CPU allocation for Cloud Run Jobs batch"
  type        = string
  default     = "2"
}

variable "batch_memory" {
  description = "Memory allocation for Cloud Run Jobs batch"
  type        = string
  default     = "2Gi"
}

variable "batch_timeout" {
  description = "Timeout in seconds for Cloud Run Jobs batch"
  type        = string
  default     = "1800s"
}

variable "batch_max_retries" {
  description = "Maximum retries for Cloud Run Jobs batch"
  type        = number
  default     = 1
}

variable "cdn_cache_ttl" {
  description = "Default TTL in seconds for Cloud CDN cache"
  type        = number
  default     = 3600
}

variable "storage_lifecycle_age_days" {
  description = "Days before transitioning old objects to Nearline storage class"
  type        = number
  default     = 90
}

variable "alert_notification_email" {
  description = "Email address for monitoring alert notifications"
  type        = string
}

variable "vertex_ai_location" {
  description = "Location for Vertex AI API calls"
  type        = string
  default     = "global"
}

variable "github_owner" {
  description = "GitHub repository owner (username or organization)"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
}

variable "preview_realtime_sa_email" {
  description = "Service account email of the preview-realtime Cloud Run Job (defined in boatracecsv.github.io/infra). Granted publisher / object-writer access in this project."
  type        = string
  default     = "preview-realtime-runner@boatrace-487212.iam.gserviceaccount.com"
}

variable "csv_mirror_bucket_name" {
  description = "GCS bucket name for the daily CSV mirror written by preview-realtime and read by fun-site."
  type        = string
  default     = "boatrace-realtime-data"
}
