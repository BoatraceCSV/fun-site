# アーキテクチャ

fun-site の全体アーキテクチャ。データソース、処理パイプライン、配信経路を俯瞰する。

## 概要

ボートレースの **スタート予想** と **AI 総合評価** を、当日全レース分の静的ページとして配信するファンサイト。

- データソースは [BoatraceCSV](https://github.com/BoatraceCSV) の CSV のみ。自前の推論パイプラインは持たない
- preview-realtime（BoatraceCSV 側）が JST 08:00〜22:59 の 2 分間隔で当日 CSV を更新するたびに、fun-site batch がイベント駆動で全ページを再ビルドする
- 静的サイトは GCS + Cloud CDN で配信する。Astro SSG により JS ゼロのページを生成する

## システム構成図

```
┌────────────────────────────────────────────────────────────┐
│ BoatraceCSV 側 (別 GCP project から運用)                   │
│                                                            │
│  preview-realtime (Cloud Run Job, JST 08:00〜22:59 2分毎)  │
│   ├ CSV 取得・パース                                       │
│   ├ GCS にミラー → gs://boatrace-realtime-data-.../data/   │
│   └ Pub/Sub publish → fun-site-realtime-completed          │
└────────────────────────────────────────────────────────────┘
                          │ Pub/Sub message
                          ▼
┌────────────────────────────────────────────────────────────┐
│ fun-site 側 (同一 GCP project: boatrace-487212)            │
│                                                            │
│  Eventarc Trigger ─► Workflow (中継) ─► Cloud Run Job      │
│  (fun-site-realtime-completed)         (fun-site-batch)    │
│                                          │                 │
│                                          ▼                 │
│                       ┌────────────────────────────────┐   │
│                       │ 1. event-parser                │   │
│                       │ 2. build-state check (早期return)│  │
│                       │ 3. fetcher (CSV 5種 並列取得)   │   │
│                       │ 4. prediction-builder           │   │
│                       │ 5. Astro build                  │   │
│                       │ 6. GCS deploy + last-build更新  │   │
│                       └────────────────────────────────┘   │
│                                          │                 │
│                                          ▼                 │
│                              gs://fun-site-web-.../        │
│                                          │                 │
│                                          ▼                 │
│                       Cloud CDN ──► HTTPS LB ──► ユーザー  │
└────────────────────────────────────────────────────────────┘
```

## 主要コンポーネント

| コンポーネント | 実体 | 役割 |
|---|---|---|
| preview-realtime | 別リポジトリ (boatracecsv.github.io) の Cloud Run Job | BoatraceCSV を 2 分間隔でフェッチ・パース、GCS ミラー、Pub/Sub publish |
| CSV ミラーバケット | `boatrace-realtime-data-{project_id}` (GCS) | preview-realtime が書込、fun-site batch が読込 |
| Pub/Sub topic | `fun-site-realtime-completed` | preview-realtime の完了通知。`RealtimeCompletedMessage` を運ぶ |
| Eventarc trigger | `fun-site-realtime-completed` | topic → Workflow を起動 |
| Workflow | `fun-site-realtime-dispatcher` | Pub/Sub message を `containerOverrides.args` に乗せて Cloud Run Job を起動する中継 |
| Cloud Run Job | `fun-site-batch` | このリポジトリの `packages/batch`。CSV 取得 → JSON 生成 → Astro build → GCS deploy |
| Web バケット | `fun-site-web-{project_id}` (GCS) | 静的サイトの配信元 |
| CDN + LB | Cloud CDN + HTTPS Global LB | エッジキャッシュ・SSL 終端・カスタムドメイン |

## なぜ Workflow を挟むか

Terraform google provider 6.x の `google_eventarc_trigger.destination` は Cloud Run **Service** しか直接指定できず、Cloud Run **Job** は指定できない。間に Workflow を 1 ステップ挟むことで、Pub/Sub message 本体を `containerOverrides.args` に乗せて Cloud Run Job に渡す。`packages/batch/src/event-parser.ts` がそれを受け取って `RealtimeCompletedMessage` を復元する。

## データフローの粒度

- **更新粒度**: preview-realtime が CSV を更新するたび（最小 2 分間隔）。`updatedRaces` 配列で差分レースの情報が渡る
- **ビルド粒度**: 毎回フルリビルド。差分ビルドはしない（Astro SSG の構造上、当日分の依存関係が広いため）
- **早期 return**: 全 CSV の GCS object generation が前回ビルド時と同じなら `last-build.json` を見て即終了する。`FORCE_REBUILD=1` で無効化できる

## データソースとビルド成果物

詳細は [data-sources.md](./data-sources.md) を参照。

| 種別 | 用途 |
|---|---|
| `programs/title` | レース名・グレード・締切時刻 |
| `programs/race_cards` | 出走表（選手・モーター・全国平均ST） |
| `previews/stt` | 直前情報（進入コース・スタート展示） |
| `estimate/index` | AI 総合評価（5 要素の寄与pt） |
| `results/realtime` | 当日確定直後のレース結果（着順・決まり手・ST） |

レース 1 件あたり `RacePrediction` JSON を 1 ファイル生成し、`packages/web/src/data/races/{YYYY-MM-DD}/{raceCode}.json` に配置する。Astro はこれを `getStaticPaths()` 内で読み込んで静的ページを生成する。

## ページ構成

| URL | 役割 |
|---|---|
| `/` | 当日トップ。開催中 24 場の次レースを一覧表示 |
| `/stadium/{stadiumId}/` | 会場別。当日 1〜12R |
| `/race/{date}/{stadiumId}/{raceNumber}/` | レース詳細（スタート予想・AI 評価・出走表・結果） |
| `/archive/{date}/` | 過去日付の一覧 |

ビルド対象日は環境変数で制御する:

- 既定: JST 当日 1 日分のみビルド
- `BUILD_TARGET_DATE=YYYY-MM-DD`: 明示指定（CI / backfill 用）
- `BUILD_ALL_DATES=1`: `packages/web/src/data/races/` に存在する全日付（ローカル開発用）

過去日付の HTML は GCS に残置され、URL から参照できる。

## 関連ドキュメント

- バッチ処理の詳細: [batch.md](./batch.md)
- フロントエンド: [web.md](./web.md)
- インフラ構成: [infrastructure.md](./infrastructure.md)
- 運用手順: [operations.md](./operations.md)

## 経緯

- 初期設計: Cloud Scheduler で JST 09:00 に 1 日 1 回バッチ実行する案を採用
- 2026-05: preview-realtime が 2 分間隔で CSV を更新するようになったのに合わせ、朝バッチを廃止し Pub/Sub → Eventarc → Workflow → Cloud Run Job のイベント駆動チェーンに移行。リージョンも `us-central1` から `asia-northeast1` に統一
- 2026-05: 当初検討していた Vertex AI / Gemini による展開予想生成は採用見送り。`estimate/index` の強さpt をそのまま AI 総合評価として提示する方針に確定
