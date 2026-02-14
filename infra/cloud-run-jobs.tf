resource "google_cloud_run_v2_job" "batch" {
  name     = "${local.prefix}-batch"
  location = var.region
  labels   = local.labels
  deletion_protection = false

  template {
    task_count = 1

    template {
      max_retries = var.batch_max_retries
      timeout     = var.batch_timeout

      service_account = google_service_account.batch.email

      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.batch.repository_id}/batch:latest"

        resources {
          limits = {
            cpu    = var.batch_cpu
            memory = var.batch_memory
          }
        }

        env {
          name  = "GCP_PROJECT_ID"
          value = var.project_id
        }

        env {
          name  = "GCS_WEB_BUCKET"
          value = google_storage_bucket.web.name
        }

        env {
          name  = "GCS_DATA_BUCKET"
          value = google_storage_bucket.data.name
        }

        env {
          name  = "VERTEX_AI_LOCATION"
          value = var.vertex_ai_location
        }

        env {
          name  = "VERTEX_AI_IMAGE_LOCATION"
          value = "global"
        }

        env {
          name  = "GOOGLE_GENAI_USE_VERTEXAI"
          value = "true"
        }

        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }

        env {
          name  = "GOOGLE_CLOUD_LOCATION"
          value = var.vertex_ai_location
        }

        env {
          name  = "SITE_URL"
          value = "https://${var.domain_name}"
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_artifact_registry_repository.batch,
  ]
}
