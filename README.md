# fun-site

ボートレースの **スタート予想** と **AI による総合評価** を、当日全レース分の静的ページとして配信するファンサイト。

[BoatraceCSV](https://github.com/BoatraceCSV) が 2 分間隔で更新する CSV を Pub/Sub 経由で受け取り、Cloud Run Job が当日全ページを再ビルドして GCS + Cloud CDN で配信する。

## 特徴

- **スタート予想の俯瞰図**: 進入コース順に並べた SVG で、各艇のスタートタイミングを直感的に把握できる
- **AI 総合評価の寄与pt 内訳**: 枠番・選手・モーター・展示・気象の 5 要素の寄与pt を枠ごとに横棒で可視化
- **直前情報の自動反映**: `previews/stt` が公開済みのレースは進入コースを反映、未取得のレースは枠番で仮表示
- **3連単 的中率・回収率**: 確定済みレースは `results/payouts` と買い目フォーメーションを突合して当日サマリー / レース別の「もし買ったら」を表示
- **完全静的・サーバーレス**: Astro SSG でゼロ JS のページを生成し、Cloud Storage + Cloud CDN で配信
- **データソース 1 系統**: 自前の推論パイプラインを持たず、BoatraceCSV の CSV のみを使う

## 技術スタック

| カテゴリ | 技術 |
|---|---|
| ランタイム | Node.js 22 |
| パッケージ管理 | pnpm 10（monorepo） |
| 静的サイト | Astro 5 + Tailwind CSS 4 |
| バッチ実行 | Cloud Run Jobs + Eventarc + Workflows |
| ホスティング | Cloud Storage + Cloud CDN |
| CI/CD | Cloud Build |
| インフラ | Terraform |
| テスト | Vitest |
| Lint / Format | Biome |

## クイックスタート

```bash
corepack enable
pnpm install

# 開発サーバー (http://localhost:4321)
pnpm --filter @fun-site/web run dev
```

詳細は [docs/development.md](docs/development.md) を参照。

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 全体アーキテクチャ |
| [docs/domain.md](docs/domain.md) | ボートレースのドメイン知識 |
| [docs/data-sources.md](docs/data-sources.md) | BoatraceCSV の CSV スキーマ・GCS パス規約 |
| [docs/batch.md](docs/batch.md) | バッチ処理パイプライン |
| [docs/web.md](docs/web.md) | フロントエンド構成 |
| [docs/infrastructure.md](docs/infrastructure.md) | GCP / Terraform |
| [docs/development.md](docs/development.md) | ローカル開発・主要コマンド |
| [docs/operations.md](docs/operations.md) | デプロイ・運用・トラブルシューティング |

Claude Code 向けの作業ルールは [CLAUDE.md](CLAUDE.md)。

## ライセンス

Private
