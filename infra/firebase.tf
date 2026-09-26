# -----------------------------------------------------------------------------
# Firebase Hosting — 静的サイトの配信 (Global LB + Cloud CDN の置き換え)
#
# デプロイはバッチ (packages/batch/src/site-builder/firebase-hosting.ts) が
# REST API で行う。初回だけ seed-firebase-hosting で過去ページを投入する。
# 保持 version 数の上限 (maxVersions) は Terraform に項目が無いため seed スクリプトが設定する。
# -----------------------------------------------------------------------------

resource "google_firebase_project" "default" {
  provider = google-beta
  project  = var.project_id

  depends_on = [
    google_project_service.apis["firebase.googleapis.com"],
    google_project_service.apis["firebasehosting.googleapis.com"],
  ]
}

resource "google_firebase_hosting_site" "default" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.firebase_hosting_site_id

  depends_on = [google_firebase_project.default]
}

# カスタムドメイン。所有権は apex の TXT (hosting-site=<site_id>) で確認され、
# 証明書は A レコードが Firebase を向いた後に発行される (var.web_hosting = "firebase")。
resource "google_firebase_hosting_custom_domain" "default" {
  provider      = google-beta
  project       = var.project_id
  site_id       = google_firebase_hosting_site.default.site_id
  custom_domain = var.domain_name

  wait_dns_verification = false
}

# バッチ SA が version 作成・release を行う
resource "google_project_iam_member" "batch_firebase_hosting" {
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:${google_service_account.batch.email}"
}
