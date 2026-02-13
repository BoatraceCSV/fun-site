# -----------------------------------------------------------------------------
# Batch processing service account (Cloud Run Jobs)
# -----------------------------------------------------------------------------
resource "google_service_account" "batch" {
  account_id   = "${local.prefix}-batch"
  display_name = "Batch Processing Service Account"
  description  = "Service account for Cloud Run Jobs batch processing"
}

resource "google_project_iam_member" "batch_vertex_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.batch.email}"
}

# Bucket-level IAM: batch SA can read/write objects only in the web and data buckets
resource "google_storage_bucket_iam_member" "batch_web_bucket" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.batch.email}"
}

resource "google_storage_bucket_iam_member" "batch_data_bucket" {
  bucket = google_storage_bucket.data.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.batch.email}"
}

resource "google_project_iam_member" "batch_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.batch.email}"
}

# -----------------------------------------------------------------------------
# Cloud Scheduler service account (to invoke Cloud Run Jobs)
# -----------------------------------------------------------------------------
resource "google_service_account" "scheduler" {
  account_id   = "${local.prefix}-scheduler"
  display_name = "Cloud Scheduler Service Account"
  description  = "Service account for Cloud Scheduler to invoke Cloud Run Jobs"
}

# Scoped: Scheduler SA can only invoke the batch job (not all Cloud Run resources)
resource "google_cloud_run_v2_job_iam_member" "scheduler_run_invoker" {
  name     = google_cloud_run_v2_job.batch.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# -----------------------------------------------------------------------------
# Cloud Build service account
# -----------------------------------------------------------------------------
resource "google_service_account" "cloud_build" {
  account_id   = "${local.prefix}-cloudbuild"
  display_name = "Cloud Build Service Account"
  description  = "Service account for Cloud Build CI/CD pipeline"
}

resource "google_project_iam_member" "cloud_build_builder" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.builder"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}

# Scoped: Cloud Build SA can only manage the batch job (not all Cloud Run resources)
resource "google_cloud_run_v2_job_iam_member" "cloud_build_run_developer" {
  name     = google_cloud_run_v2_job.batch.name
  location = var.region
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.cloud_build.email}"
}

resource "google_project_iam_member" "cloud_build_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}

# Scoped: Cloud Build SA can only impersonate the batch SA (not all SAs in the project)
resource "google_service_account_iam_member" "cloud_build_impersonate_batch" {
  service_account_id = google_service_account.batch.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.cloud_build.email}"
}

resource "google_project_iam_member" "cloud_build_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}
