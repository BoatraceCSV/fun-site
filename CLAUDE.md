# CLAUDE.md

このファイルは Claude Code がリポジトリで作業する際に従う運用ルール。

## ドキュメント更新ルール

コードや設定を変更する PR では、対応する `docs/` も同じ PR で更新する。

| 変更対象 | 更新する docs |
|---|---|
| `packages/batch/` の処理フロー変更 | [docs/batch.md](docs/batch.md) |
| `packages/web/` のページ・主要コンポーネント変更 | [docs/web.md](docs/web.md) |
| `packages/shared/` の型・定数変更 | [docs/data-sources.md](docs/data-sources.md) または [docs/domain.md](docs/domain.md) |
| `infra/*.tf` の変更 | [docs/infrastructure.md](docs/infrastructure.md)、必要なら [docs/operations.md](docs/operations.md) |
| `cloudbuild.yaml` の変更 | [docs/infrastructure.md](docs/infrastructure.md) の CI/CD セクション |
| BoatraceCSV 取得仕様の変更 | [docs/data-sources.md](docs/data-sources.md) |
| アーキテクチャ方針の変更 | [docs/architecture.md](docs/architecture.md) 本文を書き換え、末尾「経緯」節に日付付きで追記 |
| ローカル開発コマンド・環境変数の追加 | [docs/development.md](docs/development.md) |
| デプロイ・運用手順の変更 | [docs/operations.md](docs/operations.md) |

### 原則

- `docs/` は **現行仕様 (as-is)** のみを書く。提案や検討中の案は書かない
- 方針転換は as-is 本文を直接書き換え、末尾の「経緯」節に 1 行追記する
- 過去のスナップショットが必要なら `git log --follow docs/<file>.md` で辿る
- `README.md` には詳細を書かない。詳細は `docs/` に書き、`README.md` からリンクする

## コーディング規約

- Lint / Format: Biome（[biome.json](biome.json)）
- 型: TypeScript 5.7+、`tsc --noEmit` で全パッケージが通ること
- テスト: Vitest（パッケージごとに `pnpm --filter @fun-site/<pkg> run test`）
- パッケージマネージャー: pnpm 10（`corepack enable`）

PR 前に最低限以下を通す:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## ディレクトリの責務

- [packages/shared](packages/shared/) — 共通型・定数・ユーティリティ
- [packages/batch](packages/batch/) — Cloud Run Job のバッチ処理
- [packages/web](packages/web/) — Astro SSG フロントエンド
- [infra](infra/) — Terraform（GCP）
- [docs](docs/) — 現行仕様ドキュメント
- [scripts](scripts/) — ワンショットの運用スクリプト

詳細は [docs/](docs/) を参照。
