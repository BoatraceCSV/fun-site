# バッチパイプライン

`packages/batch` の責務と処理フロー。Cloud Run Job として実行され、preview-realtime からの Pub/Sub 通知をトリガーに当日全レースの静的ページを再ビルドする。

## エントリポイント

| パス | 役割 |
|---|---|
| [`packages/batch/src/main.ts`](../packages/batch/src/main.ts) | `runPipeline()` を呼ぶだけのシンラッパー |
| [`packages/batch/src/pipeline.ts`](../packages/batch/src/pipeline.ts) | 全体のオーケストレーション |

`package.json` の scripts:

- `pnpm --filter @fun-site/batch run start` → `node --import tsx/esm src/main.ts`（開発・ローカル実行）
- `pnpm --filter @fun-site/batch run start:prod` → `node --conditions=production dist/main.js`（コンテナ実行）

## 処理フロー

```
event-parser  ─►  build-state check  ─►  fetcher  ─►  prediction-builder  ─►  site-builder
                  (早期 return 判定)      (CSV 5 種)    (RacePrediction 生成)    (write local + GCS data → dates-index → series-aggregator → astro build → deploy → dates-index 書き戻し)
```

### 1. event-parser

[`packages/batch/src/event-parser.ts`](../packages/batch/src/event-parser.ts)

Eventarc CloudEvent / Pub/Sub message を `RealtimeCompletedMessage` に復元する。

メッセージは以下の優先順で受け取る:

1. `process.argv[2]`（Workflow が `containerOverrides.args` で渡す）
2. `PUBSUB_MESSAGE` 環境変数
3. `CE_DATA` 環境変数

メッセージが無ければ全レース再ビルドのフォールバック動作。

```ts
type RealtimeCompletedMessage = {
  publishedAt: string;          // ISO 日時
  raceDate: string;             // "YYYY-MM-DD"
  trigger?: "realtime" | "daily-bootstrap" | "manual";
  updatedRaces: UpdatedRace[];
  gcsPrefix?: string;
};

type UpdatedRace = {
  raceCode: string;             // "YYYYMMDDSSRR"
  stadiumId: string;
  raceNumber: number;
  csvTypes: string[];           // ["stt", "index", ...]
  indexState?: "daily" | "realtime";
};
```

### 2. build-state チェック（早期 return）

[`packages/batch/src/build-state.ts`](../packages/batch/src/build-state.ts)

GCS の `_meta/last-build.json` から前回ビルド時の CSV generation を読み出し、今回フェッチ対象の CSV generation と全種類比較する。すべて一致していれば `Skipping build: CSV generations unchanged` をログに出して即終了する。

`FORCE_REBUILD=1` で無効化できる。

### 3. fetcher

[`packages/batch/src/fetcher/`](../packages/batch/src/fetcher/) ディレクトリ。

| ファイル | 役割 |
|---|---|
| `csv-client.ts` | HTTP / GCS 切り替え、リトライ、generation 取得。`fetchIndexCsvText(predictor, date)` で予想者別 index CSV を取得 |
| `schemas.ts` | `programs/title` のパーサ |
| `race-card-schemas.ts` | `programs/race_cards`, `previews/stt` と予想者別 `estimate/{predictor_id}` のパーサ。`parseIndex(csvText, predictor)` は `predictor.componentKeys` に基づいて CSV 列名を動的に解決する |
| `result-schemas.ts` | `results/realtime` のパーサ |
| `payout-schemas.ts` | `results/payouts` のパーサ |
| `index.ts` | `fetchAllCsvData()` で固定 CSV + 各 active 予想者の index を並列取得して `FetchedCsvData` に統合 (`indexesByPredictor: PredictorIndexFetch[]` で予想者単位に分離) |

CSV 種別と取得元のパスは [data-sources.md](./data-sources.md) を参照。

### 4. prediction-builder

[`packages/batch/src/site-builder/prediction-builder.ts`](../packages/batch/src/site-builder/prediction-builder.ts)

レースコードで CSV を結合し、レース 1 件あたり `RacePrediction` を組み立てる。`indexesByPredictor` を `(raceCode, predictorId)` でグループ化し、active 予想者ごとに `PredictorPrediction` (daily / realtime それぞれの `AiEvaluation`・買い目・回収率) を生成して `RacePrediction.predictions[]` に slot 昇順で並べる。後方互換用に primary predictor (slot=1) の `aiEvaluation` / `betPayout` / `betHitStatus` も平坦化して保持する。

### 4.5. predictor-stats aggregator

[`packages/batch/src/aggregator/predictor-stats.ts`](../packages/batch/src/aggregator/predictor-stats.ts)

`gs://${GCS_DATA_BUCKET}/predictions/{date}/*.json` を active 予想者の startedAt から当日まで読み、各予想者の月次・通算統計 (レース数・的中率・購入額・払戻・回収率) を計算して `packages/web/src/data/predictors/stats.json` に書き出す。`/predictors/` ページがこの JSON を読み込んで比較表を描画する。集計失敗は非致命で、`/predictors/` は空状態で表示される。

主なロジック:

- **stt 未取得時のフォールバック**: 進入コース = 枠番、スタートタイミング = 全国平均ST
- **AI 評価の state 処理**: `状態=daily` では展示・気象の寄与pt を 0 として除外、3 要素のみ表示
- **買い目生成**: 1 マーク予想の AI 寄与度から三連単フォーメーションを生成（当日買い目・直前買い目の 2 種類）
- **的中判定**: `results/realtime` が取得できているレースは [`packages/shared/src/utils/bet-hit.ts`](../packages/shared/src/utils/bet-hit.ts) で当日・直前買い目それぞれの的中可否を判定
- **3連単 払戻 / 回収率**: `results/payouts` が取得できているレースは [`packages/shared/src/utils/bet-payout.ts`](../packages/shared/src/utils/bet-payout.ts) でフォーメーション内の組合せ数 × ¥100 を賭け金、的中時は `sanrentan.payout` を払戻として `RaceBetPayoutSummary` を計算（当日 / 直前 別）

### 5. site-builder

[`packages/batch/src/site-builder/`](../packages/batch/src/site-builder/) ディレクトリ。

| ファイル | 役割 |
|---|---|
| `data-writer.ts` | `RacePrediction[]` を JSON として (a) ローカル `packages/web/src/data/races/{YYYY-MM-DD}/{raceCode}.json` に書き出し、(b) `gs://${GCS_DATA_BUCKET}/predictions/{YYYY-MM-DD}/{raceCode}.json` へアップロード (節集計の incremental キャッシュ生成用、非致命)。`fetchHistoricalPredictions(date)` で過去日 JSON を取り戻すヘルパも持つ |
| `dates-index.ts` | `gs://${GCS_WEB_BUCKET}/_meta/dates.json` を取得 → 当日マージ → `packages/web/src/data/_meta/dates.json` に書き出し。デプロイ後に GCS へ書き戻し |
| `series-aggregator.ts` | 節集計 (直前買い目戦略の的中率・回収率)。会場ページの「今節成績」セクション用。`SERIES_LOOKBACK_DAYS = 7`。`_meta/series-summary.json` を `packages/web/src/data/_meta/` に書き出す |
| `series-state-store.ts` | 節集計の incremental キャッシュ。`gs://${GCS_DATA_BUCKET}/_meta/series-state.json` で stadium × date のスナップショット + dayLabel を保持。過去日は再計算不要、当日分のみ毎ビルドで上書き。`lookback` 上限を超えた古い日は prune |
| `build.ts` | Astro CLI を直接実行（pnpm 経由のオーバーヘッドを避ける） |
| `deploy.ts` | `web/dist/` 配下を GCS の Web バケットへアップロード。content-type / cache-control を設定。古い日付の HTML (`race/{date}/`, `archive/{date}/`) と `_astro/` (content-hash 付き CSS / JS チャンク)、`images/`、`_meta/` は削除しないフィルタで GCS に残置 |
| `index.ts` | `buildAndDeploy(predictions, raceDate)` で上記を順に呼び、最後に `last-build.json` を更新 |

## 環境変数

| 変数 | 用途 | 既定値 |
|---|---|---|
| `GCP_PROJECT_ID` | GCS / Pub/Sub クライアントに渡す project | 必須 |
| `GCS_WEB_BUCKET` | 静的サイトのデプロイ先バケット | 必須 |
| `GCS_DATA_BUCKET` | `last-build.json` の保管先 | 必須 |
| `CSV_SOURCE` | `gcs` で GCS ミラー、それ以外で HTTP（GitHub Pages） | HTTP |
| `CSV_GCS_BUCKET` | `CSV_SOURCE=gcs` 時の取得元バケット | `boatrace-realtime-data-{project}` |
| `FORCE_REBUILD` | `1` で early-return を無効化 | 未設定 |
| `BUILD_TARGET_DATE` | Astro 側で参照。ビルド対象日を `YYYY-MM-DD` で明示 | JST 当日 |

## ローカル実行

```bash
export GCP_PROJECT_ID=boatrace-487212
export GCS_WEB_BUCKET=fun-site-web-boatrace-487212
export GCS_DATA_BUCKET=fun-site-data-boatrace-487212
gcloud auth application-default login
pnpm --filter @fun-site/batch run start
```

詳細は [development.md](./development.md) を参照。

## 関連ドキュメント

- 上流 CSV のスキーマ: [data-sources.md](./data-sources.md)
- 出力した JSON を読む側: [web.md](./web.md)
- Cloud Run Job のデプロイ: [infrastructure.md](./infrastructure.md)
- 動作確認・トラブルシューティング: [operations.md](./operations.md)
