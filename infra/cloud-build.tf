resource "google_cloudbuild_trigger" "deploy" {
  name        = "${local.prefix}-deploy"
  description = "Build and deploy batch container on push to main branch"
  location    = var.region

  github {
    owner = var.github_owner
    name  = var.github_repo

    push {
      branch = "^main$"
    }
  }

  service_account = google_service_account.cloud_build.id
  filename        = "cloudbuild.yaml"

  substitutions = {
    _REGION          = var.region
    _REPOSITORY_NAME = google_artifact_registry_repository.batch.repository_id
    _JOB_NAME        = google_cloud_run_v2_job.batch.name
  }

  depends_on = [google_project_service.apis["cloudbuild.googleapis.com"]]
}
