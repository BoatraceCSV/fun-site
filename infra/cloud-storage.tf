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

  # 2 分サイクルの再デプロイで HTML を上書き・削除するたびに、既定の soft delete
  # (7 日保持) が旧データを課金対象として残す。復旧用途は無いので無効化する。
  soft_delete_policy {
    retention_duration_seconds = 0
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }
}

# LB (backend bucket) 経由の配信用。Firebase Hosting へ切り替えた後は Web バケットを
# _meta/ (ビルド状態) と切り戻し用のコピーとしてだけ使うので、公開を外す。
resource "google_storage_bucket_iam_member" "web_public_read" {
  count = local.lb_enabled ? 1 : 0

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

  # 過去日の予想 JSON (predictions/{date}/) はダイジェスト生成後ほぼ読まれない
  # ので NEARLINE に落とす。_meta/ 配下 (ダイジェスト・節集計 state・last-build)
  # は毎ビルド読むため対象外 (NEARLINE だと読取ごとに取得料が乗る)。
  lifecycle_rule {
    condition {
      age            = var.storage_lifecycle_age_days
      matches_prefix = ["predictions/"]
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  # 旧バージョン (noncurrent) は削除する。以前はバージョン管理を有効にしたまま
  # 削除ルールが無く、ビルドごとの predictions/ 上書きで旧バージョンが無制限に
  # 蓄積していた (2026-09 時点で live 1.3 GB に対し noncurrent 約 290 GB)。
  # バージョン管理は無効化するが、既存の noncurrent オブジェクトはこのルールで
  # 順次 (無料で) 消える。
  lifecycle_rule {
    condition {
      num_newer_versions = 1
    }
    action {
      type = "Delete"
    }
  }

  versioning {
    enabled = false
  }

  soft_delete_policy {
    retention_duration_seconds = 0
  }
}

moved {
  from = google_storage_bucket_iam_member.web_public_read
  to   = google_storage_bucket_iam_member.web_public_read[0]
}
