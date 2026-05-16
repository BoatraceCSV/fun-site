# 運用

本番環境のデプロイ・動作確認・トラブルシューティング。インフラ構成は [infrastructure.md](./infrastructure.md) を参照。

## デプロイ

通常運用では main ブランチ push のみ。Cloud Build が `cloudbuild.yaml` のステップを自動実行する（lint → typecheck → test → docker-build → docker-push → Cloud Run Job 更新）。

インフラ変更を伴う場合は別途 Terraform の適用が必要:

```bash
cd infra
terraform plan
terraform apply
```

## 動作確認

### 1. preview-realtime を手動実行して発火させる

```bash
gcloud run jobs execute preview-realtime \
  --region=asia-northeast1 \
  --wait
```

実行後、Cloud Logging で GCS upload と Pub/Sub publish を確認:

```bash
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="preview-realtime"
   AND (textPayload:"gcs_upload_success" OR textPayload:"pubsub_publish_success")' \
  --limit=20 --freshness=10m
```

### 2. CSV ミラーバケットに CSV が届いているか

```bash
gsutil ls gs://boatrace-realtime-data-boatrace-487212/data/programs/title/$(date +'%Y/%m')/
gsutil ls gs://boatrace-realtime-data-boatrace-487212/data/estimate/index/$(date +'%Y/%m')/
```

### 3. Eventarc → Workflow → Cloud Run Job のチェーン

```bash
# Workflow の実行履歴
gcloud workflows executions list \
  --workflow=fun-site-realtime-dispatcher \
  --location=asia-northeast1 \
  --limit=5

# 直近実行の詳細（state=SUCCEEDED なら成功）
gcloud workflows executions describe \
  $(gcloud workflows executions list \
      --workflow=fun-site-realtime-dispatcher \
      --location=asia-northeast1 \
      --limit=1 --format='value(name)') \
  --workflow=fun-site-realtime-dispatcher \
  --location=asia-northeast1

# Cloud Run Job の実行履歴
gcloud beta run jobs executions list \
  --job=fun-site-batch \
  --region=asia-northeast1 \
  --limit=5
```

### 4. 早期 return ロジックの確認

2 サイクル連続実行で 2 回目が `Skipping build: CSV generations unchanged ...` で終了することを確認:

```bash
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="fun-site-batch"
   AND textPayload:"Skipping build"' \
  --limit=5 --freshness=10m
```

### 5. 公開サイトに反映されているか

```bash
# 任意の開催中レースのページを開く
open "https://${DOMAIN}/race/$(date +'%Y-%m-%d')/12/12/"
```

## 強制再ビルド

`last-build.json` を無視して全レース再ビルドしたい場合、Cloud Run Job 側に `FORCE_REBUILD=1` を渡す。

一時的に env を上書きして実行:

```bash
gcloud run jobs execute fun-site-batch \
  --region=asia-northeast1 \
  --update-env-vars FORCE_REBUILD=1 \
  --wait
```

実行が終わったら env を元に戻す（次回以降の早期 return を保つため）:

```bash
gcloud run jobs update fun-site-batch \
  --region=asia-northeast1 \
  --remove-env-vars FORCE_REBUILD
```

## バックフィル（過去日付）

特定日の再生成は `BUILD_TARGET_DATE` を渡す:

```bash
gcloud run jobs execute fun-site-batch \
  --region=asia-northeast1 \
  --update-env-vars BUILD_TARGET_DATE=2026-05-15,FORCE_REBUILD=1 \
  --wait

# 後始末
gcloud run jobs update fun-site-batch \
  --region=asia-northeast1 \
  --remove-env-vars BUILD_TARGET_DATE,FORCE_REBUILD
```

## 監視・アラート

[`infra/monitoring.tf`](../infra/monitoring.tf) で以下を構成済み:

- Cloud Run Job の ERROR ログ検出 → メール通知（`alert_notification_email` 変数）
- batch 実行時間のログメトリクス
- ダッシュボード: Job 実行数、CDN リクエスト数、キャッシュヒット率、ストレージ容量

GCP コンソールの Monitoring → Dashboards から `fun-site overview` を開く。

## ロールバック

### preview-realtime → fun-site のチェーンを止める

Eventarc trigger を一時削除（Pub/Sub にメッセージは溜まるが Workflow が起動しない）:

```bash
gcloud eventarc triggers delete fun-site-realtime-completed \
  --location=asia-northeast1
```

または preview-realtime 側で `BOATRACE_PUBSUB_TOPIC` を空にして publish を止める。

復旧は `terraform apply` で trigger を作り直す。

### 緊急用: 朝バッチを一時復活

通常運用では使わない。Pub/Sub チェーンが回復するまでの繋ぎとして、Cloud Scheduler を手動作成して 1 日 1 回起動する:

```bash
gcloud scheduler jobs create http fun-site-emergency-daily \
  --location=asia-northeast1 \
  --schedule="0 9 * * *" --time-zone="Asia/Tokyo" \
  --uri="https://asia-northeast1-run.googleapis.com/v2/projects/boatrace-487212/locations/asia-northeast1/jobs/fun-site-batch:run" \
  --http-method=POST \
  --oauth-service-account-email="fun-site-batch@boatrace-487212.iam.gserviceaccount.com"
```

Pub/Sub チェーン復旧後は `gcloud scheduler jobs delete` で削除する。

## トラブルシューティング

| 症状 | 確認ポイント |
|---|---|
| サイトが更新されない | Workflow `fun-site-realtime-dispatcher` の executions、Cloud Run Job `fun-site-batch` の executions、`Skipping build` ログの有無 |
| 直前情報が反映されない | CSV ミラーバケットに最新の `previews/stt` が届いているか、`estimate/index` の `状態=realtime` になっているか |
| ビルドが空振りで終わる | `last-build.json` の generation を確認。`FORCE_REBUILD=1` で再実行 |
| Cloud Build が失敗する | lint / typecheck / test のいずれかでエラー。ローカルで再現確認 |
| LB 経由で 502 / 504 | backend bucket の設定、Web バケットの IAM（`allUsers` への `objectViewer`）、CDN キャッシュ |

## 経緯

- 2026-05: us-central1 から asia-northeast1 への移行。旧リソース（Cloud Scheduler、旧バケット、旧 LB / SSL）を destroy し、リアルタイムパイプラインを新設
- 2026-05: 旧 `programs/YYYY/MM/DD.csv`（サブディレクトリなし）パスから新パスへの上流移行に追随、`results/realtime` の取り込みを追加
