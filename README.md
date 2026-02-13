# fun-site

ボートレースの展開予想を AI 生成画像で視覚化するファンサイト。
毎日 AM 2:00 のバッチ処理で当日の全レース予想ページを自動生成し、GCP 上で静的サイトとして配信する。

第4回 Agentic AI Hackathon with Google Cloud 応募作品。

## 特徴

- **Agentic AI パイプライン**: Gemini 3 Pro による展開予想分析 → 画像生成 → 品質チェック → 不合格ならリトライという自律的フィードバックループ
- **ML + AI のハイブリッド予想**: [BoatraceCSV](https://github.com/BoatraceCSV) の ML 予測データを Gemini 3 Pro が総合分析し、展開シナリオ・買い目・信頼度を生成
- **展開予想の画像化**: テキストの買い目羅列ではなく、スタート隊形から 1 マーク攻防までの流れを画像で直感的に表現
- **完全サーバーレス**: Cloud Run Jobs + Cloud Scheduler + Cloud Storage + Cloud CDN で運用コスト最小化
- **静的サイト配信**: Astro SSG でゼロ JS の高速ページを生成し、Lighthouse 100 を目指す設計

## アーキテクチャ

```
Cloud Scheduler (AM 2:00 JST)
    │
    ▼
Cloud Run Job ─────────────────────────────────────────────────
│                                                              │
│  1. Fetch CSV ─→ 2. Predict ─→ 3. Generate ─→ 4. Quality   │
│     (BoatraceCSV)  (Gemini 3     Images        Check        │
│                     Pro)        (Gemini 3     (Gemini 3     │
│                                  Pro Image)    Pro)         │
│                                       │            │         │
│                                       │   NG → リトライ(2回) │
│                                       │   or SVG fallback   │
│                                       ▼                      │
│                           5. Build (Astro SSG)               │
│                              + Deploy (GCS)                  │
└──────────────────────────────────────────────────────────────
    │
    ▼
Cloud Storage + Cloud CDN ──→ ユーザー
```

### バッチ処理の 5 ステップ

| Step | 処理 | 技術 |
|------|------|------|
| 1 | BoatraceCSV から当日の出走表・ML 予測データを取得 | fetch + csv-parse |
| 2 | 出走表 + ML 予測を統合し、Gemini 3 Pro でレース展開を分析 | Vertex AI SDK |
| 3 | 分析結果から展開予想図を画像生成（+ SVG フォールバック） | Gemini 3 Pro Image |
| 4 | 生成画像をマルチモーダルで品質検証、不合格なら再生成 | Gemini 3 Pro |
| 5 | 予想データを JSON 書き出し → Astro ビルド → GCS デプロイ | Astro SSG + GCS SDK |

## 技術スタック

| カテゴリ | 技術 |
|----------|------|
| ランタイム | Node.js 22 |
| パッケージ管理 | pnpm 10 (monorepo) |
| 静的サイト | Astro 5 + Tailwind CSS 4 |
| AI 分析・画像生成 | Gemini 3 Pro / Gemini 3 Pro Image (Vertex AI) |
| バッチ実行 | Cloud Run Jobs + Cloud Scheduler |
| ホスティング | Cloud Storage + Cloud CDN |
| CI/CD | Cloud Build |
| インフラ | Terraform |
| テスト | Vitest |
| Lint / Format | Biome |

## プロジェクト構成

```
fun-site/
├── packages/
│   ├── shared/          # 共通型・定数・ユーティリティ
│   │   └── src/
│   │       ├── types/           # 型定義 (CSV, 予想, 会場)
│   │       ├── constants/       # マスタデータ (24会場, 艇色, 決まり手)
│   │       └── utils/           # 日付操作, レースコード
│   ├── batch/           # バッチ処理パイプライン
│   │   └── src/
│   │       ├── fetcher/         # BoatraceCSV データ取得 + CSV パース
│   │       ├── predictor/       # Gemini 3 Pro 展開予想分析
│   │       ├── image-generator/ # 画像生成 + SVG フォールバック + GCS アップロード
│   │       ├── quality-checker/ # マルチモーダル品質検証
│   │       ├── site-builder/    # データ書き出し + Astro ビルド + デプロイ
│   │       └── lib/             # 共通 (Vertex AI クライアント)
│   └── web/             # Astro SSG フロントエンド
│       └── src/
│           ├── pages/           # ルーティング (トップ, 会場別, レース別, アーカイブ, 統計)
│           ├── components/      # UI コンポーネント
│           ├── layouts/         # ベースレイアウト
│           └── content/         # バッチが書き出す予想データ (JSON)
├── infra/               # Terraform (GCP インフラ 12ファイル)
├── cloudbuild.yaml      # CI/CD パイプライン定義
└── biome.json           # Lint / Format 設定
```

## ページ構成

| URL | ページ | 内容 |
|-----|--------|------|
| `/` | トップ | 当日の全会場・全レース予想一覧 |
| `/stadium/{id}/` | 会場別 | 全 24 会場の個別ページ |
| `/race/{date}/{stadiumId}/{raceNumber}` | レース別 | 個別レース詳細（AI 展開予想図・出走表・買い目） |
| `/archive/{date}` | アーカイブ | 過去日付の予想結果 |
| `/stats` | 的中実績 | ML 予測と AI 予想の的中率統計 |

## データソース

[BoatraceCSV](https://github.com/BoatraceCSV) が GitHub Pages で公開している CSV データを利用する。

| CSV | 内容 | 取得タイミング |
|-----|------|----------------|
| programs | 出走表（選手・モーター・成績） | 当日分 |
| prediction-preview | ML 展示会予測（コース・ST・展示タイム） | 当日分 |
| estimate | ML 着順予想（予想着順・決まり手） | 当日分 |
| results | レース結果（着順・配当） | 前日分 |
| confirm | ML 予想の的中確認 | 前日分 |

## セットアップ

```bash
corepack enable
pnpm install
```

## 開発コマンド

```bash
# 開発サーバー (http://localhost:4321)
pnpm --filter @fun-site/web run dev

# Lint / 型チェック / テスト
pnpm lint
pnpm typecheck
pnpm test

# Web サイトビルド
pnpm --filter @fun-site/web run build
```

## デプロイ

`main` ブランチへの push で Cloud Build が自動実行される。
lint → typecheck → test（並列）→ Docker build → Artifact Registry push → Cloud Run Job 更新。

GCP インフラの構築手順や環境変数の設定は [QUICK_START.md](./QUICK_START.md) を参照。

## ライセンス

Private
