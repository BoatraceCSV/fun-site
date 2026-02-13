resource "google_artifact_registry_repository" "batch" {
  location      = var.region
  repository_id = "${local.prefix}-batch"
  description   = "Docker repository for batch processing container images"
  format        = "DOCKER"
  labels        = local.labels

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"

    condition {
      older_than = "2592000s" # 30 days
    }
  }

  depends_on = [google_project_service.apis["artifactregistry.googleapis.com"]]
}
