# -----------------------------------------------------------------------------
# Realtime pipeline: preview-realtime → GCS mirror → Pub/Sub → Eventarc →
#                    Workflows → fun-site batch (Cloud Run Job)
#
# 旧 Cloud Scheduler 経由の朝バッチは廃止。当日初回ビルドは preview-realtime の
# JST 08:00 (Scheduler `preview-realtime-daytime`, cron `*/5 8-22 * * *`) 発火で
# programs/title・race_cards も含めて GCS にミラーされ、Pub/Sub → Workflows
# 経由で fun-site の Cloud Run Job が起動する。
#
# Workflows を中継する理由:
#   Terraform google / google-beta provider 6.x の `google_eventarc_trigger` の
#   `destination` は cloud_run_service / gke / workflow / http_endpoint のみ対応で、
#   Cloud Run **Job** を直接 destination 指定できない。Workflows を 1 ステップ挟むと
#   Cloud Run Job の `run.jobs.run` 呼び出し時にメッセージ本体を container args として
#   そのまま受け渡せるため、`event-parser.ts` の Pub/Sub envelope パスがそのまま動く。
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# Pub/Sub topic — preview-realtime からの完了通知を受ける
# -----------------------------------------------------------------------------
resource "google_pubsub_topic" "realtime_completed" {
  name    = "${local.prefix}-realtime-completed"
  labels  = local.labels
  project = var.project_id

  message_retention_duration = "86400s" # 1 day; Eventarc が即時に消費する想定

  depends_on = [google_project_service.apis["pubsub.googleapis.com"]]
}

# -----------------------------------------------------------------------------
# CSV mirror bucket — preview-realtime が当日 CSV をミラー、fun-site が読む
# -----------------------------------------------------------------------------
resource "google_storage_bucket" "csv_mirror" {
  name     = "${var.csv_mirror_bucket_name}-${var.project_id}"
  location = var.region
  labels   = local.labels

  uniform_bucket_level_access = true
  force_destroy               = false

  # 当日 CSV だけがホットパス。30 日経過したら NEARLINE に逃がす。
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type          = "SetStorageClass"
      storage_class = "COLDLINE"
    }
  }

  versioning {
    enabled = false
  }
}

# -----------------------------------------------------------------------------
# preview-realtime SA への権限付与 (SA 自体は boatracecsv.github.io/infra 側で作成済)
# -----------------------------------------------------------------------------
resource "google_storage_bucket_iam_member" "preview_realtime_csv_writer" {
  bucket = google_storage_bucket.csv_mirror.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${var.preview_realtime_sa_email}"
}

resource "google_pubsub_topic_iam_member" "preview_realtime_publisher" {
  topic   = google_pubsub_topic.realtime_completed.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${var.preview_realtime_sa_email}"
  project = var.project_id
}

# -----------------------------------------------------------------------------
# fun-site batch SA への権限付与 (CSV mirror bucket 読取)
# -----------------------------------------------------------------------------
resource "google_storage_bucket_iam_member" "batch_csv_mirror_reader" {
  bucket = google_storage_bucket.csv_mirror.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.batch.email}"
}

# -----------------------------------------------------------------------------
# Workflows 用 SA — Cloud Run Job を起動する
# -----------------------------------------------------------------------------
resource "google_service_account" "workflows" {
  account_id   = "${local.prefix}-workflows"
  display_name = "Workflows runtime SA for realtime-completed dispatcher"
  description  = "Used by Workflows to invoke the fun-site batch Cloud Run Job"
}

# Workflows が Cloud Run Job を実行できるようにする
# （`run.jobs.run` API + container override のため `roles/run.developer` が必要）
resource "google_cloud_run_v2_job_iam_member" "workflows_run_developer" {
  name     = google_cloud_run_v2_job.batch.name
  location = var.region
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.workflows.email}"
}

# Workflows が `googleapis.run.v2.projects.locations.jobs.run` 後に operation の
# 完了をポーリングするとき `run.operations.get` を呼ぶ。operation リソースは
# IAM scoping できないため、プロジェクトレベルで read 権限を付与する。
# `roles/run.viewer` は read-only で、operations.get / executions.get / jobs.get 等を含む。
resource "google_project_iam_member" "workflows_run_viewer" {
  project = var.project_id
  role    = "roles/run.viewer"
  member  = "serviceAccount:${google_service_account.workflows.email}"
}

# Workflows が Cloud Run Job の SA (batch SA) として実行する権限
resource "google_service_account_iam_member" "workflows_act_as_batch" {
  service_account_id = google_service_account.batch.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.workflows.email}"
}

# Workflows のログ出力
resource "google_project_iam_member" "workflows_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.workflows.email}"
}

# -----------------------------------------------------------------------------
# Workflow — Pub/Sub event を受けて Cloud Run Job を起動する小さな中継
# -----------------------------------------------------------------------------
resource "google_workflows_workflow" "realtime_dispatcher" {
  name            = "${local.prefix}-realtime-dispatcher"
  region          = var.region
  description     = "Eventarc から受けた realtime-completed Pub/Sub message を fun-site batch Cloud Run Job に転送する"
  service_account = google_service_account.workflows.email
  labels          = local.labels

  # Pub/Sub message の data (base64) を Cloud Run Job container の argv[2] に
  # そのまま渡すことで、`packages/batch/src/event-parser.ts` の base64 経路で
  # 受け取れるようにする。
  #
  # 注意: Cloud Run Jobs API の `containerOverrides` は `args` / `env` / `clearArgs`
  # のみで `command` (entrypoint) は上書き不可。
  # Dockerfile 側で `ENTRYPOINT ["node", "--import", "tsx/esm", "src/main.ts"]` +
  # `CMD []` としておき、ここでは `args` に Pub/Sub message を渡すだけで
  # `node --import tsx/esm src/main.ts <base64>` の形に組み立てる。
  source_contents = <<-EOT
    main:
      params: [event]
      steps:
        - extract_message:
            assign:
              - encoded_data: $${event.data.message.data}
        - run_batch_job:
            try:
              call: googleapis.run.v2.projects.locations.jobs.run
              args:
                name: projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.batch.name}
                body:
                  overrides:
                    containerOverrides:
                      - args:
                          - $${encoded_data}
              result: execution
            except:
              as: e
              steps:
                - log_error:
                    call: sys.log
                    args:
                      severity: ERROR
                      data: $${e}
                - return_error:
                    return: $${e}
        - done:
            return: $${execution}
  EOT

  depends_on = [
    google_project_service.apis["workflows.googleapis.com"],
    google_cloud_run_v2_job_iam_member.workflows_run_developer,
    google_service_account_iam_member.workflows_act_as_batch,
  ]
}

# -----------------------------------------------------------------------------
# Eventarc trigger SA — Pub/Sub message を受けて Workflows を起動する
# -----------------------------------------------------------------------------
resource "google_service_account" "eventarc" {
  account_id   = "${local.prefix}-eventarc"
  display_name = "Eventarc trigger invoker for realtime dispatcher workflow"
  description  = "Used by Eventarc to dispatch realtime-completed messages to Workflows"
}

# Eventarc は Pub/Sub から PUSH 型 subscription を作るので subscriber 権限が必要
resource "google_pubsub_topic_iam_member" "eventarc_subscriber" {
  topic   = google_pubsub_topic.realtime_completed.name
  role    = "roles/pubsub.subscriber"
  member  = "serviceAccount:${google_service_account.eventarc.email}"
  project = var.project_id
}

# Eventarc が Workflows を起動するための権限
resource "google_project_iam_member" "eventarc_workflows_invoker" {
  project = var.project_id
  role    = "roles/workflows.invoker"
  member  = "serviceAccount:${google_service_account.eventarc.email}"
}

resource "google_project_iam_member" "eventarc_event_receiver" {
  project = var.project_id
  role    = "roles/eventarc.eventReceiver"
  member  = "serviceAccount:${google_service_account.eventarc.email}"
}

# -----------------------------------------------------------------------------
# Eventarc trigger: realtime-completed Pub/Sub topic → Workflows
# -----------------------------------------------------------------------------
resource "google_eventarc_trigger" "realtime_completed_to_workflow" {
  name     = "${local.prefix}-realtime-completed"
  location = var.region

  matching_criteria {
    attribute = "type"
    value     = "google.cloud.pubsub.topic.v1.messagePublished"
  }

  transport {
    pubsub {
      topic = google_pubsub_topic.realtime_completed.id
    }
  }

  destination {
    workflow = google_workflows_workflow.realtime_dispatcher.id
  }

  service_account = google_service_account.eventarc.email

  depends_on = [
    google_project_service.apis["eventarc.googleapis.com"],
    google_pubsub_topic_iam_member.eventarc_subscriber,
    google_project_iam_member.eventarc_workflows_invoker,
    google_project_iam_member.eventarc_event_receiver,
  ]
}
