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

## Firebase Hosting への切替

配信を Global LB + Cloud CDN から Firebase Hosting へ移す手順。`infra/terraform.tfvars`
の `web_hosting` を 1 段ずつ進めて `terraform apply` する (各段階の意味は
[infrastructure.md](./infrastructure.md#ネットワーク配信))。

1. **`web_hosting = "lb"` で apply** — Firebase プロジェクト・Hosting サイト・カスタム
   ドメイン・所有権確認の TXT を作り、バッチの `DEPLOY_TARGETS` を `gcs,firebase` にする。
   配信は LB のまま。seed 前なので Firebase へのデプロイはスキップされる
   (`has no release yet` の warn ログ)
2. **seed** — Web バケットの全ファイルを Firebase Hosting へ初回 release する
   (約 13 万ファイル / 10 GB。ローカルから数十分)。以降はバッチが当日分を重ねていく
   ```bash
   gcloud auth application-default login
   pnpm --filter @fun-site/batch run seed-firebase-hosting
   ```
3. **既定 URL で確認** — `terraform output firebase_hosting_default_url`
   (`https://boatrace-fun.web.app`) でトップ・当日レース・過去日付のレース・404 を確認する。
   次のバッチ実行後に当日ページが更新されることも確認する
4. **`web_hosting = "firebase"` で apply** — A レコードを Firebase Hosting に向ける。
   証明書は DNS 切替後に発行されるため、**発行まで (数分〜1 時間程度) HTTPS がエラーになる**。
   状態は `terraform output firebase_hosting_custom_domain_state` の `cert` が
   `CERT_ACTIVE` になれば完了。LB は旧 DNS キャッシュ向けに残っている
5. **`web_hosting = "firebase_only"` で apply** — 証明書が有効になり 1 日ほど様子を見てから。
   LB 一式と Web バケットの公開設定を削除し、デプロイ先を Firebase のみにする。
   Web バケットは `_meta/` の保管場所と切り戻し用のコピーとして残る (更新は止まる)

切り戻しは `web_hosting` を 1 段戻して apply する。`firebase_only` から戻す場合、LB は
作り直しになり (IP も変わる) 証明書の再発行を待つ必要がある。Web バケットは
`firebase_only` の間更新されないので、戻した直後の過去日付ページは古いまま
(当日分は次のバッチで追いつく)。

Firebase Hosting 側の rollback は Firebase コンソールの Hosting → リリース履歴から
直前の version に戻せる。次のバッチは manifest と live version の食い違いを検知して
API から一覧を復元してからデプロイする。

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

## 節集計データ (GCS の保管物)

会場ページの「今節成績」表示に使う節集計は、バッチ
([`series-aggregator.ts`](../packages/batch/src/site-builder/series-aggregator.ts))
が以下を生成・参照する:

| GCS パス | 役割 | 更新タイミング |
|---|---|---|
| `gs://${GCS_DATA_BUCKET}/predictions/{YYYY-MM-DD}/{raceCode}.json` | レース予想の生 JSON。節集計の incremental キャッシュにヒットしなかった過去日を補完するために `fetchHistoricalPredictions(date)` で取得する。カスタムメタデータ `predictionContentHash` (`generatedAt` を除いた内容の sha256) を持ち、次回ビルドの差分判定に使う | 当日ビルド毎、内容が変わったレースのみ上書き |
| `gs://${GCS_DATA_BUCKET}/_meta/series-state.json` | stadium × date のスナップショット (`settledRaceCount` / `hitCount` / `totalBetCostYen` / `totalPayoutYen` + `dayLabel`) を保持。過去日エントリは再計算せずに再利用、当日分は毎ビルド上書き、`SERIES_LOOKBACK_DAYS` 上限を超えた古い日は prune | 当日ビルド毎 |
| `gs://${GCS_DATA_BUCKET}/_meta/prediction-digests/{YYYY-MM-DD}.json` | 予想者統計 (`/predictors`) と分析軸別集計 (`/stats`) 用の日別ダイジェスト (`PredictionDigest[]`)。集計に必要な項目だけを持つ軽量版で、過去日はこれを再利用、当日は毎ビルド上書き。無い過去日は `predictions/{date}/` から射影して補完する ([batch.md](batch.md) 4.4) | 当日ビルド毎 (過去日は初回のみ) |
| `packages/web/src/data/_meta/series-summary.json` | Astro が読む集計結果 (`byStadium[stadiumId]: SeriesBetPayoutAggregate`)。GCS にはアップロードせず Astro ビルド入力としてのみ使う | 当日ビルド毎 |

通常運用では追加の操作は不要。手動で state を捨てて作り直したい場合は GCS の
`_meta/series-state.json` を削除すれば、次回ビルドで `lookback` 範囲を GCS から
再構築する (一時的に集計が縮退するだけで致命的ではない)。

統計集計のダイジェストも同様で、`_meta/prediction-digests/<date>.json` を削除すれば
次回ビルドでその日だけ `predictions/<date>/` から作り直す。全日を作り直したいときは
コード側で `PREDICTION_DIGEST_SCHEMA_VERSION` を上げる。初回 (キャッシュが無い状態)
のビルドは全期間の予想 JSON を読むため数分かかるが、メモリは日単位で解放されるので
期間の長さで OOM にはならない。

## アーカイブ日付インデックスのシード

`/archive/` インデックスと `/archive/[date]` の「他の日付」セクションは、
`gs://${GCS_WEB_BUCKET}/_meta/dates.json` に保持された日付リストを参照する。
通常運用ではバッチが当日分を毎ビルドで追記するが、機能導入直後など、
既に GCS に過去ページが残っているのにインデックスが空の状態のときは、
シードスクリプトを 1 度実行してバケットの実態から流し込む:

スクリプトは `@google-cloud/storage` SDK を使うため、batch パッケージの依存解決経由で実行する:

```bash
# 認証
gcloud auth application-default login

# 既存の `archive/<date>/` プレフィックスを列挙して dates.json を生成
pnpm --filter @fun-site/batch run seed-archive-dates

# 内容確認のみ (書き込まない)
DRY_RUN=1 pnpm --filter @fun-site/batch run seed-archive-dates
```

## 過去ページの CSS 参照を復旧する

旧 `deploy.ts` は `_astro/` 配下を毎回 rsync 削除していたため、
過去日付の `race/<date>/.../index.html` と `archive/<date>/index.html` が
既に消えた CSS ハッシュを参照して 404 になることがある。
現行 `deploy.ts` では `_astro/` を保護対象に追加して将来の削除を止めているが、
既に発生している 404 は HTML を書き換えて現行ハッシュに揃える必要がある:

```bash
gcloud auth application-default login

# 内容確認 (書き込まない)
DRY_RUN=1 pnpm --filter @fun-site/batch run recover-past-css

# 本番適用
pnpm --filter @fun-site/batch run recover-past-css
```

スクリプトは GCS 上の `_astro/*.css` を列挙してから、過去日付 HTML の
`<link rel="stylesheet" href="/_astro/*.css">` を検査し、リンク先が
現存しないものだけ現行 CSS に置き換える。既に有効なリンクは触らない。

CDN キャッシュが残っていると書き換え後も古い 404 が返る場合があるので、
必要に応じて Cloud CDN のキャッシュ無効化を併用する。

その後の運用では、バッチ (`packages/batch/src/site-builder/dates-index.ts`)
が `buildAndDeploy` の最後で `dates.json` に当日を追記して GCS に書き戻す
ので、追加の操作は不要。

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
- ダッシュボード: Job 実行数、CDN リクエスト数、キャッシュヒット率、ストレージ容量 (CDN 系は LB 廃止後は 0。Firebase Hosting の転送量・ストレージは Firebase コンソールの Hosting → 使用状況で見る)

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
| Firebase Hosting に反映されない | batch ログの `Firebase Hosting` 行 (`has no release yet` なら seed 未実行、`requires content` なら manifest 不整合 → `_meta/firebase-hosting-manifest.json.gz` を削除すると次回 API から復元)。`DEPLOY_TARGETS` に `firebase` が入っているか |
| カスタムドメインで証明書エラー | `terraform output firebase_hosting_custom_domain_state`。A レコード切替直後は発行待ち |

## 経緯

- 2026-05: us-central1 から asia-northeast1 への移行。旧リソース（Cloud Scheduler、旧バケット、旧 LB / SSL）を destroy し、リアルタイムパイプラインを新設
- 2026-05: 旧 `programs/YYYY/MM/DD.csv`（サブディレクトリなし）パスから新パスへの上流移行に追随、`results/realtime` の取り込みを追加
- 2026-09: 配信を Firebase Hosting へ段階的に移す手順 (`web_hosting` 変数) を追加
