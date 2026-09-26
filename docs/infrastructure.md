# インフラストラクチャ

GCP 上の構成と Terraform の責務。アーキテクチャ全体像は [architecture.md](./architecture.md) を参照。

## 基本情報

| 項目 | 値 |
|---|---|
| GCP Project | `boatrace-487212` |
| Region | `asia-northeast1` |
| Terraform | >= 1.5 |
| Providers | google / google-beta ~6.0 |
| Backend | GCS（`terraform init -backend-config="bucket=..."` で指定） |

入力変数の定義は [`infra/variables.tf`](../infra/variables.tf)、現在の値は `terraform.tfvars`（gitignore 済み、`terraform.tfvars.example` をコピーして編集）。

## ファイル別の責務

| ファイル | 主なリソース |
|---|---|
| [`infra/main.tf`](../infra/main.tf) | provider 設定、必須 API の有効化 |
| [`infra/variables.tf`](../infra/variables.tf) | 入力変数の宣言 |
| [`infra/outputs.tf`](../infra/outputs.tf) | バケット名・URL・Job 名・LB IP・Firebase Hosting の既定 URL / カスタムドメイン状態などの出力 |
| [`infra/artifact-registry.tf`](../infra/artifact-registry.tf) | Docker レジストリ（batch コンテナ用、最新 10 世代 + 30 日保持） |
| [`infra/cloud-build.tf`](../infra/cloud-build.tf) | main ブランチ push トリガー |
| [`infra/cloud-run-jobs.tf`](../infra/cloud-run-jobs.tf) | `fun-site-batch` Cloud Run Job（既定 1 vCPU / 2Gi。Astro ビルドは単一スレッド主体で、課金は vCPU 秒比例のため 2 vCPU にしない） |
| [`infra/cloud-scheduler.tf`](../infra/cloud-scheduler.tf) | 空（旧朝バッチ廃止後、destroy 対象の受け皿） |
| [`infra/cloud-storage.tf`](../infra/cloud-storage.tf) | Web / Data バケット |
| [`infra/dns.tf`](../infra/dns.tf) | Cloud DNS ゾーン + A レコード (LB または Firebase Hosting) + Firebase 所有権確認の TXT |
| [`infra/firebase.tf`](../infra/firebase.tf) | Firebase プロジェクト、Hosting サイト、カスタムドメイン、batch SA の `firebasehosting.admin` |
| [`infra/iam.tf`](../infra/iam.tf) | batch SA、Cloud Build SA |
| [`infra/monitoring.tf`](../infra/monitoring.tf) | 通知チャネル、アラートポリシー、ログメトリクス、ダッシュボード |
| [`infra/networking.tf`](../infra/networking.tf) | グローバル IP、backend bucket、CDN、URL Map、証明書、LB。`web_hosting = "firebase_only"` で全削除 (`count`) |
| [`infra/realtime-pipeline.tf`](../infra/realtime-pipeline.tf) | Pub/Sub topic、CSV ミラーバケット、Workflow、Eventarc trigger、各種 IAM |

## サービスアカウント

| SA | 主な権限 |
|---|---|
| `fun-site-batch@` | Cloud Run Job 実行。Web/Data バケット書込、CSV ミラーバケット読取、Firebase Hosting へのデプロイ (`firebasehosting.admin`)、logging |
| `fun-site-workflows@` | Workflow 実行。`run.developer`、`run.viewer`、`logging.logWriter`、batch SA の impersonate |
| `fun-site-eventarc@` | Eventarc → Workflow 起動。`pubsub.subscriber`、`workflows.invoker`、`eventarc.eventReceiver` |
| Cloud Build SA | Artifact Registry write、Cloud Run Job 更新、batch SA の impersonate |
| `preview-realtime-runner@` | （別プロジェクトの SA だが）CSV ミラーバケットへの書込権、Pub/Sub topic への publish 権を IAM で付与済み |

## ストレージバケット

| バケット名（テンプレ） | 用途 | ライフサイクル | 公開 |
|---|---|---|---|
| `fun-site-web-{project}` | LB 経由の静的サイト配信 + `_meta/` (`last-build.json` / `dates.json` / Firebase Hosting の manifest) | なし | `web_hosting` が `lb` / `firebase` の間は公開読取（CDN 経由）。`firebase_only` で非公開 |
| `fun-site-data-{project}` | `predictions/{date}/` (予想 JSON)、`_meta/` (ダイジェスト・節集計 state・`last-build.json`) | `predictions/` のみ 90 日超 → NEARLINE。旧バージョン (noncurrent) は削除。バージョン管理なし | 非公開 |
| `boatrace-realtime-data-{project}` | preview-realtime が書く CSV ミラー | 30 日超 → NEARLINE、365 日超 → COLDLINE | 非公開 |

3 バケットとも soft delete は無効 (`retention_duration_seconds = 0`)。5 分サイクルの
上書き・削除で旧データが 7 日ぶん課金対象として残るのを避けるため。

Data バケットは以前バージョン管理が有効で、ビルドごとの `predictions/` 上書きにより
旧バージョンが無制限に蓄積していた (2026-09 時点で live 1.3 GB に対し noncurrent 約
290 GB)。`num_newer_versions = 1` の削除ルールが既存の旧バージョンも順次消す
(ライフサイクルによる削除は操作課金なし)。

## ネットワーク・配信

配信は Global LB + Cloud CDN から Firebase Hosting へ段階的に移す。段階は変数
`web_hosting` で切り替え、DNS の向き先・LB の有無・バッチのデプロイ先
(`DEPLOY_TARGETS`) が連動する。切替手順は [operations.md](./operations.md#firebase-hosting-への切替)。

| `web_hosting` | A レコード | LB + CDN | `DEPLOY_TARGETS` |
|---|---|---|---|
| `lb` (既定) | LB の IP | あり | `gcs,firebase` (Firebase は seed 前ならスキップ) |
| `firebase` | Firebase Hosting (`firebase_hosting_ip`) | あり (旧 DNS キャッシュ向け) | `gcs,firebase` |
| `firebase_only` | Firebase Hosting | 削除。Web バケットの公開も外す | `firebase` |

### Firebase Hosting

- サイト ID は `firebase_hosting_site_id` (既定 `boatrace-fun`、既定 URL `https://boatrace-fun.web.app`)。カスタムドメインは `domain_name`
- 所有権は apex の TXT `hosting-site=<site_id>` で確認される。証明書は A レコードが Firebase を向いた後に発行される
- デプロイはバッチが REST API で行う ([batch.md](./batch.md) の `firebase-hosting.ts`)。キャッシュヘッダは version の設定で付ける: HTML (ディレクトリ URL・拡張子なし・`.html`) は `public, max-age=0, s-maxage=86400, must-revalidate`、`_astro/` は `immutable` 1 年、その他は Firebase 既定 (`max-age=3600`)。Firebase の CDN は release ごとに全キャッシュを破棄するので、HTML を CDN で長く持っても古いページは配信されない
- 保持 version 数 (`maxVersions`) は Terraform に項目が無いので `seed-firebase-hosting` が設定する (既定 5)。古い version もストレージ課金の対象になるため
- 無料枠はストレージ 10 GB・転送 10 GB/月。サイトは約 10 GB (2026-09) で 1 日 150 MB ほど増え、転送は 1 日約 1 GB なので両方とも超過分が従量課金になる ($0.026/GB・$0.15/GB)
- google-beta provider は `user_project_override = true` (Firebase Management API をユーザー認証で呼ぶと quota project が必要なため)

### Global LB + Cloud CDN (`web_hosting` が `lb` / `firebase` の間だけ)

- グローバル静的 IP × 1
- HTTPS LB（Certificate Manager の管理証明書、HTTP は HTTPS にリダイレクト）
- backend bucket で Web バケットを背後に、Cloud CDN を有効化（既定 TTL は `cdn_cache_ttl` 変数）
- Cloud CDN は `CACHE_ALL_STATIC` でオブジェクトの `Cache-Control` を尊重する。`deploy.ts` がアップロード時に種別ごとに付与する: `.html` は `no-cache`（毎回再検証で常に最新）、`_astro/` の content-hash 付き CSS/JS は `public, max-age=31536000, immutable`、その他は `public, max-age=3600`。`Cache-Control` を付けないと HTML まで `cdn_cache_ttl` ぶんキャッシュされ、再ビルドしても古いトップページが配信され続けるため必須
- forwarding rule の固定費 (月 ~$18) が 2026-09 時点で GCP 費用の最大項目だったため廃止する

DNS のネームサーバーは `terraform output dns_name_servers` で取得しレジストラに登録する。

## リアルタイムパイプライン

`infra/realtime-pipeline.tf` で以下を構築する。

```
preview-realtime (別 project の Cloud Run Job)
  ├ GCS object 書込 (boatrace-realtime-data-...)
  └ Pub/Sub publish (fun-site-realtime-completed)
                              │
                              ▼
                Eventarc trigger (fun-site-realtime-completed)
                              │
                              ▼
                Workflow (fun-site-realtime-dispatcher)
                  ├ message.data (base64) を decode
                  └ run.jobs.run API + containerOverrides.args
                              │
                              ▼
                Cloud Run Job (fun-site-batch)
```

| 項目 | 値 |
|---|---|
| Pub/Sub topic | `fun-site-realtime-completed`（保持 1 日） |
| Eventarc trigger | `fun-site-realtime-completed`（asia-northeast1） |
| Workflow | `fun-site-realtime-dispatcher`（asia-northeast1） |
| Cloud Run Job | `fun-site-batch` |

Workflow を中継する理由は [architecture.md#なぜ-workflow-を挟むか](./architecture.md) を参照。

## 監視

[`infra/monitoring.tf`](../infra/monitoring.tf):

- 通知チャネル: メール（`alert_notification_email` 変数）
- アラートポリシー: Cloud Run Job の ERROR ログを検出（1 時間ごとに最大 1 通知）
- ログメトリクス: batch 実行時間
- ダッシュボード: Job 実行数、CDN リクエスト数、キャッシュヒット率、ストレージ容量

## CI/CD

[`cloudbuild.yaml`](../cloudbuild.yaml) のステップ:

1. `install`: pnpm 依存関係インストール
2. `lint` / `typecheck` / `test`: 並列実行
3. `docker-build`: `packages/batch/Dockerfile` から batch イメージをビルド（タグ: `batch:$COMMIT_SHA` + `batch:latest`）
4. `docker-push`: Artifact Registry に push
5. `deploy`: Cloud Run Job のイメージを更新

main ブランチ push で自動実行される。トリガーは `infra/cloud-build.tf` 定義。

## Terraform 操作

```bash
cd infra

# 初期化（state バケットを指定）
terraform init -backend-config="bucket=YOUR_PROJECT_ID-tfstate"

# プラン確認
terraform plan

# 適用
terraform apply
```

state バケット自体は Terraform 管理外。事前に `gsutil mb` で作成する。

## 経緯

- 初期構成: `us-central1` リージョン、Cloud Scheduler で JST 09:00 にバッチ起動
- 2026-05: preview-realtime のリアルタイム化に合わせ `asia-northeast1` に移行、Cloud Scheduler を廃止して Pub/Sub → Eventarc → Workflow → Cloud Run Job のチェーンに切り替え
- 2026-05: Eventarc の destination が Cloud Run Service のみ対応のため、Workflow を中継層として導入
- 2026-09: 費用削減のため配信を Global LB + Cloud CDN から Firebase Hosting へ移行開始 (`web_hosting` 変数で段階切替)。LB の forwarding rule 固定費 (月 ~$18) が最大の費用項目だった
