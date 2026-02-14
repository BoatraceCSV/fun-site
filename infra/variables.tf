variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "us-central1"
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

variable "batch_schedule" {
  description = "Cron schedule for daily batch job (in Asia/Tokyo timezone)"
  type        = string
  default     = "0 2 * * *"
}

variable "batch_timezone" {
  description = "Timezone for Cloud Scheduler"
  type        = string
  default     = "Asia/Tokyo"
}

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
