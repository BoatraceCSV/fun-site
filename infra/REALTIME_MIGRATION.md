# 直前情報リアルタイム反映への移行手順

`docs/realtime-architecture-proposal.md` で承認した設計の Terraform / 運用手順をまとめる。

旧 JST 09:00 朝バッチ (`google_cloud_scheduler_job.daily_batch`) を廃止し、
preview-realtime → Pub/Sub → Eventarc → fun-site batch のチェーンに切り替える。

---

## 0. 前提

| 項目 | 値 |
| --- | --- |
| GCP Project | `boatrace-487212` |
| Region | `asia-northeast1`（preview-realtime と統一） |
| preview-realtime SA | `preview-realtime-runner@boatrace-487212.iam.gserviceaccount.com` |
| fun-site batch SA | `fun-site-batch@boatrace-487212.iam.gserviceaccount.com` |
| 旧 region | `us-central1`（移行が必要） |

---

## 1. リージョン移行（us-central1 → asia-northeast1）

旧バケット・Cloud Run Job・Artifact Registry・LB を `asia-northeast1` に作り直す必要がある。

### 1.1 既存リソースのバックアップ

```bash
PROJECT_ID=boatrace-487212
OLD_REGION=us-central1

# 既存 web bucket の中身を退避
gsutil -m rsync -r gs://fun-site-web-${PROJECT_ID}/ ./_backup/web/

# Artifact Registry のイメージは region をまたいで pull/push する必要があるが、
# Cloud Build で次回 SHA をビルドすれば asia-northeast1 側の AR に直接 push される。
```

### 1.2 旧リソースの destroy

```bash
cd infra
# variables.tf の region を asia-northeast1 にしてから:
terraform plan -out=migration.plan
# us-central1 の Cloud Run Job / GCS bucket / LB / SSL 等が destroy 計画に乗っていることを確認
terraform apply migration.plan
```

> **注意**: `google_storage_bucket.web` には `force_destroy = false` が指定されているため、
> 中身が空でない場合は事前に object を全削除するか、`force_destroy = true` に一時的に変更
> する必要がある（バックアップ後に実施）。

### 1.3 ドメイン / DNS の再ポイント

LB の global IP が変わるので、`google_dns_record_set` で A レコードを更新（既に Terraform 管理済みなら自動で書き換わる）。

---

## 2. 新規リソースの作成

```bash
cd infra
terraform plan -out=plan.realtime
terraform apply plan.realtime
```

これにより以下が新規作成される（`infra/realtime-pipeline.tf`）:

| リソース | 用途 |
| --- | --- |
| `google_pubsub_topic.realtime_completed` | preview-realtime の完了通知トピック |
| `google_storage_bucket.csv_mirror` | preview-realtime が書く CSV ミラー（fun-site が読む） |
| `google_storage_bucket_iam_member.preview_realtime_csv_writer` | preview-realtime SA に書込権 |
| `google_pubsub_topic_iam_member.preview_realtime_publisher` | preview-realtime SA に publish 権 |
| `google_storage_bucket_iam_member.batch_csv_mirror_reader` | fun-site batch SA に読取権 |
| `google_workflows_workflow.realtime_dispatcher` | Pub/Sub event を Cloud Run Job に転送する中継 Workflow |
| `google_service_account.workflows` | Workflows ランタイム SA（Cloud Run Job 起動用） |
| `google_service_account.eventarc` | Eventarc → Workflow 用 SA |
| `google_eventarc_trigger.realtime_completed_to_workflow` | topic → Workflow → Cloud Run Job のチェーン |

> **設計メモ**: Terraform google provider 6.x の `google_eventarc_trigger.destination` は
> Cloud Run **Service** のみ直接指定可能で、Cloud Run **Job** は指定不可。Workflows を
> 1 ステップ挟むことで、Pub/Sub message 本体を `containerOverrides.args` に乗せて
> Cloud Run Job に渡せる（fun-site の `event-parser.ts` がそのまま受け取れる）。

旧 `google_cloud_scheduler_job.daily_batch` と `google_service_account.scheduler` は
`infra/cloud-scheduler.tf` / `infra/iam.tf` の更新で destroy される。

---

## 3. preview-realtime Cloud Run Job の環境変数を設定

preview-realtime 側の Cloud Run Job spec に以下の env を渡す（boatracecsv.github.io リポジトリの
infra/cloudbuild.yaml で `gcloud run jobs deploy --update-env-vars` を追加するか、手動で設定）:

```bash
gcloud run jobs update preview-realtime \
  --region=asia-northeast1 \
  --update-env-vars="BOATRACE_GCS_CSV_BUCKET=boatrace-realtime-data-boatrace-487212,BOATRACE_PUBSUB_TOPIC=projects/boatrace-487212/topics/fun-site-realtime-completed"
```

設定が無い場合は `scripts/boatrace/gcs_publisher.py` が安全に no-op するため、
コードを先にデプロイしてから環境変数を後付けする段階的ロールアウトも可能。

---

## 4. 動作確認

### 4.1 preview-realtime の手動実行で GCS upload + Pub/Sub publish を発火

```bash
gcloud run jobs execute preview-realtime --region=asia-northeast1 --wait

# Cloud Logging で gcs_upload_success / pubsub_publish_success を確認
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="preview-realtime"
   AND (textPayload:"gcs_upload_success" OR textPayload:"pubsub_publish_success")' \
  --limit=20 --freshness=10m
```

### 4.2 GCS バケットに CSV が届いていることを確認

```bash
gsutil ls gs://boatrace-realtime-data-boatrace-487212/data/programs/title/$(date +'%Y/%m')/
gsutil ls gs://boatrace-realtime-data-boatrace-487212/data/estimate/index/$(date +'%Y/%m')/
```

### 4.3 Eventarc → Workflow → Cloud Run Job のチェーンが動くことを確認

Pub/Sub publish 後の流れを順に確認:

```bash
# Workflow の execution を確認
gcloud workflows executions list \
  --workflow=fun-site-realtime-dispatcher \
  --location=asia-northeast1 \
  --limit=5

# 直近の execution 詳細（成功なら state=SUCCEEDED）
gcloud workflows executions describe \
  $(gcloud workflows executions list \
      --workflow=fun-site-realtime-dispatcher \
      --location=asia-northeast1 \
      --limit=1 --format='value(name)') \
  --workflow=fun-site-realtime-dispatcher \
  --location=asia-northeast1

# Cloud Run Jobs の execution
gcloud beta run jobs executions list --job=fun-site-batch --region=asia-northeast1 --limit=5
```

### 4.4 fun-site の早期 return ロジック確認

2 サイクル連続で実行し、2 回目が `Skipping build: CSV generations unchanged ...` で
すぐ終わることを確認:

```bash
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="fun-site-batch"
   AND textPayload:"Skipping build"' \
  --limit=5 --freshness=10m
```

### 4.5 公開サイトに直前情報が反映されることを確認

```bash
# 任意の現在開催中レースのページを開いて、進入コース・展示・index (state=realtime) が
# 反映されているか目視確認
open "https://${DOMAIN}/race/$(date +'%Y-%m-%d')/12/12"
```

---

## 5. ロールバック

### 5.1 Eventarc trigger を停止

```bash
# trigger を一時的に削除（Pub/Sub にメッセージは溜まるが Workflow が起動しない）
gcloud eventarc triggers delete fun-site-realtime-completed --location=asia-northeast1
```

または preview-realtime 側の `BOATRACE_PUBSUB_TOPIC` を空にして publish を止める。

### 5.2 旧朝バッチを一時復活

```bash
# Cloud Scheduler を 1 回限りで作成（Terraform を介さない緊急対応）
gcloud scheduler jobs create http fun-site-emergency-daily \
  --location=asia-northeast1 \
  --schedule="0 9 * * *" --time-zone="Asia/Tokyo" \
  --uri="https://asia-northeast1-run.googleapis.com/v2/projects/boatrace-487212/locations/asia-northeast1/jobs/fun-site-batch:run" \
  --http-method=POST \
  --oauth-service-account-email="fun-site-batch@boatrace-487212.iam.gserviceaccount.com"
```

> 通常運用では使わない。Pub/Sub チェーンが回復したら `gcloud scheduler jobs delete` で消す。
