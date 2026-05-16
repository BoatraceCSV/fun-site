# ローカル開発

ローカルで fun-site を開発・検証するための手順。

## 前提条件

- Node.js >= 22
- pnpm 10.x（`corepack enable` で有効化）
- GCP 認証（バッチを実行する場合のみ）

## セットアップ

```bash
git clone <repository-url>
cd fun-site
corepack enable
pnpm install
```

## プロジェクト構成

```
fun-site/
├── packages/
│   ├── shared/   # 共通型・定数・ユーティリティ
│   ├── batch/    # CSV 取得 → JSON 生成 → Astro ビルド → GCS デプロイ
│   └── web/      # Astro SSG フロントエンド
├── infra/        # Terraform（GCP インフラ）
├── docs/         # ドキュメント
├── scripts/      # ワンショットの運用スクリプト
├── cloudbuild.yaml
└── package.json
```

詳細は各パッケージのドキュメントを参照:

- [batch.md](./batch.md)
- [web.md](./web.md)
- [infrastructure.md](./infrastructure.md)

## よく使うコマンド

ワークスペースルートから実行する。

```bash
# Lint（Biome）
pnpm lint
pnpm lint:fix

# 型チェック（全パッケージ）
pnpm typecheck

# テスト（全パッケージ、Vitest）
pnpm test

# 全パッケージのビルド
pnpm build
```

## 開発サーバー

```bash
pnpm --filter @fun-site/web run dev
```

`http://localhost:4321` で確認できる。

データが空（`packages/web/src/data/races/` に JSON が無い状態）では「本日の予想データはまだありません」と表示される。実データで確認したい場合は下記のバッチ実行で JSON を書き出すか、開発用のフィクスチャを `packages/web/src/data/races/{YYYY-MM-DD}/` に置く。

### ビルド対象日の制御

| 環境変数 | 効果 |
|---|---|
| なし | JST 当日のみビルド |
| `BUILD_TARGET_DATE=YYYY-MM-DD` | 明示指定 |
| `BUILD_ALL_DATES=1` | `src/data/races/` 配下の全日付 |

## バッチのローカル実行

GCS / Pub/Sub に実アクセスするので、GCP 認証と環境変数が必要。

```bash
export GCP_PROJECT_ID=boatrace-487212
export GCS_WEB_BUCKET=fun-site-web-boatrace-487212
export GCS_DATA_BUCKET=fun-site-data-boatrace-487212

# CSV 取得元（gcs を指定すると GCS ミラー、無指定で GitHub Pages 経由）
export CSV_SOURCE=gcs

gcloud auth application-default login

pnpm --filter @fun-site/batch run start
```

引数 / 環境変数で Pub/Sub message を渡すこともできる:

```bash
# JSON を引数で渡す
pnpm --filter @fun-site/batch run start '{"publishedAt":"...","raceDate":"2026-05-16","updatedRaces":[]}'

# あるいは環境変数
export PUBSUB_MESSAGE='{"publishedAt":"...","raceDate":"2026-05-16","updatedRaces":[]}'
pnpm --filter @fun-site/batch run start
```

メッセージが無ければ JST 当日の全レースを対象に再ビルドするフォールバック動作になる。

### 早期 return を無効化

通常は前回ビルドから CSV generation が変わっていないと即終了する。強制的に再ビルドしたい場合:

```bash
export FORCE_REBUILD=1
pnpm --filter @fun-site/batch run start
```

## テスト

各パッケージで Vitest を使用。

```bash
# 全パッケージ
pnpm test

# 個別パッケージ
pnpm --filter @fun-site/batch run test
pnpm --filter @fun-site/shared run test
```

## Lint / Format

Biome を使用。設定は [`biome.json`](../biome.json)。

```bash
pnpm lint        # チェックのみ
pnpm lint:fix    # 自動修正
```

## 関連ドキュメント

- 全体像: [architecture.md](./architecture.md)
- インフラ構築: [infrastructure.md](./infrastructure.md)
- 本番デプロイと動作確認: [operations.md](./operations.md)
