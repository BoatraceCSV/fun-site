# Quick Start

ボートレース展開予想サイト（fun-site）の構築手順。

## 前提条件

- Node.js >= 22
- pnpm 10.x (`corepack enable` で自動インストール)
- GCP プロジェクト（本番デプロイ時）
- Terraform >= 1.5（インフラ構築時）

## 1. ローカル開発環境のセットアップ

```bash
# リポジトリのクローン
git clone <repository-url>
cd fun-site

# pnpm の有効化と依存関係のインストール
corepack enable
pnpm install
```

## 2. 検証コマンド

```bash
# Lint
pnpm lint

# 型チェック（全パッケージ）
pnpm typecheck

# テスト（全パッケージ）
pnpm test

# Web サイトビルド
pnpm --filter @fun-site/web run build

# Lint 自動修正
pnpm lint:fix
```

## 3. ローカル開発サーバー

```bash
# Astro 開発サーバーを起動（http://localhost:4321）
pnpm --filter @fun-site/web run dev
```

予想データが無い状態では「本日の予想データはまだありません」と表示される。

## 4. バッチの手動実行（ローカル）

バッチ実行には GCP の認証情報と環境変数が必要。

```bash
# 環境変数の設定
export GCP_PROJECT_ID="your-gcp-project-id"
export GCS_WEB_BUCKET="your-web-bucket-name"
export GCS_DATA_BUCKET="your-data-bucket-name"
export VERTEX_AI_LOCATION="us-central1"

# GCP 認証（Application Default Credentials）
gcloud auth application-default login

# バッチ実行
pnpm --filter @fun-site/batch run start
```

バッチは以下のパイプラインを順に実行する:

1. BoatraceCSV から CSV データ取得
2. レースデータの結合
3. Gemini 3 Pro による展開予想分析
4. 画像生成 + 品質チェック
5. Astro ビルド + Cloud Storage デプロイ

## 5. GCP インフラの構築

### 5.1 Terraform state 用 GCS バケットの作成

```bash
# Terraform state を保存するバケットを事前に作成
gsutil mb -p YOUR_PROJECT_ID -l us-central1 gs://YOUR_PROJECT_ID-tfstate
```

### 5.2 Terraform 変数の設定

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` を編集し、以下の必須値を設定:

| 変数 | 説明 | 例 |
|---|---|---|
| `project_id` | GCP プロジェクト ID | `my-boatrace-project` |
| `domain_name` | サイトのカスタムドメイン | `boatrace.example.com` |
| `alert_notification_email` | 監視アラートの通知先 | `admin@example.com` |
| `github_owner` | GitHub リポジトリオーナー | `your-username` |
| `github_repo` | GitHub リポジトリ名 | `fun-site` |

### 5.3 Terraform の実行

```bash
cd infra

# 初期化（state バケットを指定）
terraform init -backend-config="bucket=YOUR_PROJECT_ID-tfstate"

# プラン確認
terraform plan

# 適用
terraform apply
```

作成されるリソース:

- Cloud Storage（Web ホスティング用 + データ用）
- Cloud CDN + ロードバランサ
- Cloud Run Jobs（バッチ処理）
- Cloud Scheduler（毎日 AM 2:00 JST に実行）
- Artifact Registry（Docker イメージ）
- Cloud Build（CI/CD トリガー）
- Cloud DNS ゾーン
- 各種 IAM サービスアカウント
- 監視アラート

### 5.4 DNS の設定

`terraform apply` 完了後、出力される `dns_name_servers` をドメインレジストラに設定する。

```bash
terraform output dns_name_servers
```

## 6. CI/CD

`main` ブランチへの push で Cloud Build が自動実行される。

Cloud Build のステップ:

1. `pnpm install` - 依存関係インストール
2. `pnpm lint` / `pnpm typecheck` / `pnpm test` - 並列で検証
3. Docker build - バッチコンテナのビルド
4. Artifact Registry へ push
5. Cloud Run Job のイメージを更新

## 7. プロジェクト構成

```
fun-site/
├── packages/
│   ├── shared/      # 共通型・定数・ユーティリティ
│   ├── batch/       # バッチ処理パイプライン
│   └── web/         # Astro SSG フロントエンド
├── infra/           # Terraform（GCP インフラ）
├── cloudbuild.yaml  # Cloud Build パイプライン定義
└── package.json     # ワークスペースルート
```

### パッケージの役割

| パッケージ | 技術 | 役割 |
|---|---|---|
| `@fun-site/shared` | TypeScript | 型定義、定数（会場・艇色）、ユーティリティ（日付・レースコード） |
| `@fun-site/batch` | TypeScript, Vertex AI SDK, GCS SDK | CSV 取得 → AI 分析 → 画像生成 → サイトビルド → デプロイ |
| `@fun-site/web` | Astro 5, Tailwind CSS 4 | 静的サイト生成（26ページ） |

### 環境変数一覧

| 変数名 | 必須 | 用途 | デフォルト |
|---|---|---|---|
| `GCP_PROJECT_ID` | batch | Vertex AI 呼び出し | - |
| `GCS_WEB_BUCKET` | batch | Web サイトのデプロイ先バケット | `fun-site-web` |
| `GCS_DATA_BUCKET` | batch | 画像データの保存先バケット | `fun-site-data` |
| `VERTEX_AI_LOCATION` | batch | Vertex AI のリージョン | `us-central1` |
| `SITE_URL` | web | Astro の `site` 設定 | `https://fun-site.example.com` |
