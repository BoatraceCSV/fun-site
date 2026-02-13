# -----------------------------------------------------------------------------
# Web hosting bucket (static site)
# -----------------------------------------------------------------------------
resource "google_storage_bucket" "web" {
  name     = "${local.prefix}-web-${var.project_id}"
  location = var.region
  labels   = local.labels

  uniform_bucket_level_access = true
  force_destroy               = false

  website {
    main_page_suffix = "index.html"
    not_found_page   = "404.html"
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }
}

resource "google_storage_bucket_iam_member" "web_public_read" {
  bucket = google_storage_bucket.web.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# -----------------------------------------------------------------------------
# Data bucket (prediction data, images, intermediate files)
# -----------------------------------------------------------------------------
resource "google_storage_bucket" "data" {
  name     = "${local.prefix}-data-${var.project_id}"
  location = var.region
  labels   = local.labels

  uniform_bucket_level_access = true
  force_destroy               = false

  lifecycle_rule {
    condition {
      age = var.storage_lifecycle_age_days
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  versioning {
    enabled = true
  }
}
