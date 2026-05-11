# fun-site

ボートレースの **スタート予想** と **AI による総合評価** を、当日の全レースについて静的ページで配信するファンサイト。
毎日 AM 9:00 JST のバッチ処理が当日全レース分のページを生成し、GCP 上で静的サイトとして配信する（BoatraceCSV の `daily-sync.yml` が 07:30 JST に起動し ~22 分で当日分データを公開し終える）。

## 特徴

- **スタート予想の俰瞰図**: 進入コース順に並べた SVG 図で、各艇のスタートタイミングを直感的に把握できる
- **AI 総合評価の寄与pt 内訳**: 枠番・選手・モーター・展示・気象 の 5 要素の寄与pt を枠ごとに横棒で可視化
- **直前情報の自動反映**: `data/previews/stt`（直前情報）が公開済みのレースは進入コースを反映、未取得のレースは枠番を仮表示
- **完全静的・サーバーレス**: Astro SSG でゼロ JS のページを生成し、Cloud Storage + Cloud CDN で配信
- **データソース 1 系統**: 推論パイプラインを持たず、[BoatraceCSV](https://github.com/BoatraceCSV) が公開する CSV を組み合わせるだけで全ての値が決まる

## レース詳細ページに表示する情報

各レースの詳細ページ (`/race/{date}/{stadiumId}/{raceNumber}/`) は以下の構成。

1. **ヘッダ**: 会場・レース番号・レース名・締切時刻
2. **スタート予想（俰瞰型 SVG）**
    - 進入コース: `data/previews/stt` から取得。未取得時は枠番をそのまま進入コースとして仮表示
    - スタートタイミング: `data/programs/race_cards` の **全国平均ST** をそのまま採用
3. **AI による総合評価（横棒グラフ）**
    - 値: `data/index` の **寄与pt** を枠ごとに積み上げ。合計が **強さpt** に相当する
    - `状態 = daily`（直前情報未取得）のレースは展示・気象セグメントを除外し 3 要素のみ表示
4. **出走表**
    - `data/programs/race_cards` の選手名・級別・年齢・支部・全国勝率/2連対率・当地勝率/2連対率・モーター番号/2連対率

リアルタイム更新は行わない（バッチ実行時のスナップショットのみ）。

## アーキテクチャ

```
Cloud Scheduler (AM 9:00 JST)
    │
    ▼
Cloud Run Job ───────────────────────────────────────────────
│                                                            │
│  1. Fetch CSV ─→ 2. Build Predictions ─→ 3. Build & Deploy │
│     (BoatraceCSV)   (CSV を結合し           (Astro SSG +    │
│                      RacePrediction          GCS)           │
│                      JSON を生成)                           │
└────────────────────────────────────────────────────────────
    │
    ▼
Cloud Storage + Cloud CDN ──→ ユーザー
```

### バッチ処理の 3 ステップ

| Step | 処理 | 技術 |
|------|------|------|
| 1 | BoatraceCSV から `programs/title` / `programs/race_cards` / `previews/stt` / `index` / `results` を取得・パース | fetch + csv-parse |
| 2 | レースコードで結合し、レース 1 件ごとに `RacePrediction` JSON を書き出す | TypeScript |
| 3 | Astro でビルド → GCS にデプロイ | Astro SSG + GCS SDK |

## 技術スタック

| カテゴリ | 技術 |
|----------|------|
| ランタイム | Node.js 22 |
| パッケージ管理 | pnpm 10 (monorepo) |
| 静的サイト | Astro 5 + Tailwind CSS 4 |
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
│   │       ├── types/           # 型定義 (CSV, RacePrediction, 会場)
│   │       ├── constants/       # マスタデータ (24会場, 艇色)
│   │       └── utils/           # 日付操作, レースコード
│   ├── batch/           # バッチ処理パイプライン
│   │   └── src/
│   │       ├── fetcher/         # BoatraceCSV データ取得 + CSV パース
│   │       │                    #  (title / race_cards / stt / index / results)
│   │       └── site-builder/    # CSV → RacePrediction 統合
│   │                            #  + Astro ビルド + デプロイ
│   └── web/             # Astro SSG フロントエンド
│       └── src/
│           ├── pages/           # トップ, 会場別, レース別, アーカイブ
│           ├── components/      # StartPredictionDiagram /
│           │                    #  AiEvaluationChart / RacerTable など
│           ├── layouts/
│           └── data/races/      # バッチが書き出す予想 JSON
├── infra/               # Terraform (GCP インフラ)
├── cloudbuild.yaml      # CI/CD パイプライン定義
└── biome.json           # Lint / Format 設定
```

## ページ構成

| URL | ページ | 内容 |
|-----|--------|------|
| `/` | トップ | 当日の全会場・全レース一覧 |
| `/stadium/{id}/` | 会場別 | 全 24 会場の当日レース一覧 |
| `/race/{date}/{stadiumId}/{raceNumber}/` | レース別 | スタート予想 + AI 総合評価 + 出走表 |
| `/archive/{date}/` | アーカイブ | 過去日付のレース一覧 |

## データソース

[BoatraceCSV](https://github.com/BoatraceCSV) が GitHub Pages で公開している CSV データを利用する。

| CSV | 内容 | 利用箇所 |
|-----|------|---------|
| `programs/title/YYYY/MM/DD.csv` | 出走表メタ（レース名・タイトル・グレード・締切時刻 等） | ヘッダ |
| `programs/race_cards/YYYY/MM/DD.csv` | 選手プロフィール・全国平均ST 等 | スタート予想の ST / 出走表 |
| `previews/stt/YYYY/MM/DD.csv` | 直前情報（進入コース・スタート展示） | スタート予想の進入コース |
| `index/YYYY/MM/DD.csv` | 強さpt（5 要素の寄与pt） | AI 総合評価 |
| `results/YYYY/MM/DD.csv` | 前日のレース結果・配当 | 集計用（前日分） |

`previews/stt` は直前情報のため、AM 9:00 バッチ時点ではまだ多くのレースが未公開（実際には締切 5 分前にしか出ない）。その場合は **進入コース = 枠番**、ST = 全国平均ST で仮表示する。`index` の `状態 = daily`（朝バッチ時点）のレースは、展示・気象の寄与pt が暫定値（50, 寄与 0）のため、展示・気象セグメントを非表示にする。

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

# バッチ実行（CSV 取得 → JSON 書き出し → Astro ビルド → デプロイ）
pnpm --filter @fun-site/batch run start
```

## デプロイ

`main` ブランチへの push で Cloud Build が自動実行される。
lint → typecheck → test（並列）→ Docker build → Artifact Registry push → Cloud Run Job 更新。

GCP インフラの構築手順や環境変数の設定は [QUICK_START.md](./QUICK_START.md) を参照。

## ライセンス

Private
