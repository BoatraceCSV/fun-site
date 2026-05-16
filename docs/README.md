# fun-site ドキュメント

fun-site の設計・実装・運用に関する as-is ドキュメント。

リポジトリ全体の概要は [../README.md](../README.md) を参照。

## 目次

| ドキュメント | 内容 |
|---|---|
| [architecture.md](./architecture.md) | 全体アーキテクチャ（イベント駆動バッチ + 静的サイト） |
| [domain.md](./domain.md) | ボートレースのドメイン知識・予想根拠 |
| [data-sources.md](./data-sources.md) | BoatraceCSV の CSV スキーマ・GCS パス規約 |
| [batch.md](./batch.md) | `packages/batch` のパイプライン |
| [web.md](./web.md) | `packages/web` の構成・ページ・主要コンポーネント |
| [infrastructure.md](./infrastructure.md) | Terraform / GCP リソース |
| [development.md](./development.md) | ローカル開発・主要コマンド |
| [operations.md](./operations.md) | デプロイ・運用・トラブルシューティング |

## ドキュメント運用ルール

- 各 doc は **現行仕様 (as-is)** を書く。提案や検討中の案は書かない
- 大きな方針転換は当該 doc 本文を書き換え、末尾の「経緯」節に1行追記する
- 過去のスナップショットが必要なら `git log --follow docs/<file>.md` で辿る
- コード・インフラの変更時は同じ PR で対応 doc を更新する（詳細は [../CLAUDE.md](../CLAUDE.md)）
