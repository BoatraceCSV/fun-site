# データソース

fun-site が取得・利用する [BoatraceCSV](https://github.com/BoatraceCSV) の CSV データと、それらの保管場所・取得方法。

## CSV 種別

| 種別 | パス（プレフィックス省略） | 内容 | 利用箇所 |
|---|---|---|---|
| `programs/title` | `programs/title/YYYY/MM/DD.csv` | 出走表メタ（レース名・グレード・締切時刻） | ヘッダ |
| `programs/race_cards` | `programs/race_cards/YYYY/MM/DD.csv` | 選手プロフィール・モーター/ボート成績・全国平均ST・F/L 本数・節間14スロット成績 | スタート予想・出走表 |
| `previews/stt` | `previews/stt/YYYY/MM/DD.csv` | 直前情報（進入コース・スタート展示） | スタート予想の進入コース・展示ST |
| `previews/tkz` | `previews/tkz/YYYY/MM/DD.csv` | 直前情報（体重・体重調整・展示タイム・チルト） | 直前情報セクション |
| `previews/sui` | `previews/sui/YYYY/MM/DD.csv` | 直前情報（水面気象: 風速・風向・波高・天候・気温・水温） | 直前情報セクション |
| `previews/original_exhibition` | `previews/original_exhibition/YYYY/MM/DD.csv` | 直前情報（場別オリジナル展示: 一周/まわり足/直線 等の計測値） | 直前情報セクション |
| `programs/recent_national` | `programs/recent_national/YYYY/MM/DD.csv` | 全国近況5節（節期間・場・グレード・着順時系列） | 近況5節セクション |
| `programs/recent_local` | `programs/recent_local/YYYY/MM/DD.csv` | 当地近況5節（同形式、当地ソースのみ） | 近況5節セクション |
| `programs/motor_stats` | `programs/motor_stats/YYYY/MM/DD.csv` | モーター期成績（1 モーター 1 行: 3連率・優勝/優出回数・平均ラップ等） | 出走表のモーター情報 |
| `estimate/{predictor_id}` | `estimate/{predictor_id}/YYYY/MM/DD.csv` | 各 active 予想者の強さpt と寄与pt | 予想者ごとの AI 総合評価・買い目・回収率 |
| `results/realtime` | `results/realtime/YYYY/MM/DD.csv` | 当日確定直後のレース結果 | レース結果セクション・的中判定 |
| `results/payouts` | `results/payouts/YYYY/MM/DD.csv` | 当日確定直後の払戻金（単勝/複勝/2連単/2連複/拡連複/3連単/3連複） | 3連単 戦略の回収率計算 |

廃止済み:

- 旧 `programs/YYYY/MM/DD.csv`（サブディレクトリなし）: 上流で生成停止
- `prediction-preview` / `estimate`（旧）/ `confirm`: 上流の ML 予測パイプライン廃止
- K-file 由来の `results/daily/YYYY/MM/DD.csv`: 翌日確定 results。本サイトでは使わない

## 取得元

実装は [`packages/batch/src/fetcher/csv-client.ts`](../packages/batch/src/fetcher/csv-client.ts)。
`CSV_SOURCE` 環境変数で切り替える。

### GCS ミラー（推奨・本番）

`CSV_SOURCE=gcs`

`gs://boatrace-realtime-data-{project_id}/data/{種別}/{YYYY}/{MM}/{DD}.csv`

preview-realtime が CSV を取得して直接書き込む。HTTPS / CDN ラグなしで読める。本番の Cloud Run Job ではこちらを使う。

### HTTP（デフォルト・開発）

`https://boatracecsv.github.io/data/{種別}/{YYYY}/{MM}/{DD}.csv`

GitHub Pages 経由。ローカル開発や検証で GCS を使いたくない場合のフォールバック。

### リトライと world generation

- HTTP / GCS のいずれも exponential backoff で最大 3 回リトライ
- GCS object の `generation`（更新時刻ベースの整数）を取得し、`_meta/last-build.json` に記録
- 次回起動時に全 CSV の generation が一致していれば早期 return（`FORCE_REBUILD=1` で無効化）

## 主要な型

実装は [`packages/shared/src/types/csv.ts`](../packages/shared/src/types/csv.ts) と [`packages/shared/src/types/prediction.ts`](../packages/shared/src/types/prediction.ts)。

### 上流の CSV 行（一部）

| 型 | 対応 CSV | 主なフィールド |
|---|---|---|
| `TitleRow` | `programs/title` | レース名、グレード、締切時刻 |
| `RaceCardRow` / `RaceCardRacer` / `SessionResultSlot` | `programs/race_cards` | 選手名・級別・年齢・支部・出身地、全国/当地/モーター/ボートの勝率・2/3連対率、全国平均ST、F/L 本数(`flyingCount`/`lateCount`)・賞除(`prizeExcluded`)、節間 14 スロット成績(`sessionResults`: 日次・走・R番号・進入・枠・ST・着順) |
| `SttRow` / `SttBoat` | `previews/stt` | 進入コース、スタート展示 |
| `TkzRow` / `TkzBoat` | `previews/tkz` | 体重・体重調整・展示タイム・チルト（6 艇） |
| `SuiRow` | `previews/sui` | 気象観測時刻・風速・風向・波高・天候コード・気温・水温 |
| `OriginalExhibitionRow` / `OriginalExhibitionBoat` | `previews/original_exhibition` | 場別計測項目ラベル（`itemLabels`、非空のみ）と艇別計測値（`values`、長さは itemLabels と一致） |
| `RecentFormRow` / `RecentFormBoat` / `RecentFormSession` | `programs/recent_national`, `programs/recent_local` | 艇別・節別の開始/終了日・場名・グレード・着順列（両 CSV 同一スキーマ） |
| `MotorStatsRow` | `programs/motor_stats` | `(記録日, 場コード, モーター番号)` キー。勝率・2/3連率・優勝/優出回数・平均ラップ秒など |
| `IndexRow` / `IndexEntry` | `estimate/{predictor_id}` | 由来予想者 ID、状態（daily/realtime）、`componentKeys` ぶんの素点 / 寄与pt、強さpt |
| `RaceResultRow` / `RaceResultFinish` / `RaceResultCourse` / `RaceResultWeather` | `results/realtime` | 着順、決まり手、ST、天候 |
| `RacePayoutRow` / `SinglePayout` / `CombinationPayout` | `results/payouts` | 単勝・複勝・2連単・2連複・拡連複（3スロット固定）・3連単・3連複の組番／払戻金／人気 |

### 統合した予想型

| 型 | 役割 |
|---|---|
| `RacePrediction` | レース 1 件分の統合予想。バッチが書き出し、Astro が読み込む |
| `PredictorPrediction` | `RacePrediction.predictions[]` の要素。1 予想者 / 1 レースの AI 評価 + 買い目 + 回収率 |
| `PredictorSpec` | 予想者の宣言的定義 (id, displayName, slot, componentKeys, status, startedAt)。レジストリは [`packages/shared/src/predictors.ts`](../packages/shared/src/predictors.ts) |
| `StartPrediction` / `StartPredictionEntry` | スタート予想（進入コース + スタートタイミング）。`exhibitionStartTiming` に stt 由来のスタート展示実測ST を保持（未計測=null）。`RaceRacer` は 3連対率（`nationalTop3Rate` / `localTop3Rate` / `motorTop3Rate`）も保持し出走表で表示 |
| `RacePreview` / `RacePreviewBoat` / `RaceWeather` / `OriginalExhibition` / `OriginalExhibitionView` | 直前情報。`RacePrediction.preview` にぶら下がり、tkz（体重・展示タイム・チルト、`exhibitionTime` は 0→null）・sui（水面気象、天候はコード生値）・original_exhibition（場別オリジナル展示、`labels` + 艇別 `values`）を結合。いずれの CSV も未取得のレースでは `preview` 自体が undefined |
| `RaceRecentForm` / `RacerRecentForm` / `RecentFormSessionView` | 近況5節。`RacePrediction.recentForm` にぶら下がり、recent_national / recent_local を艇番で突合し全国・当地を結合。空セッションは除外。どちらの CSV も未取得のレースでは `recentForm` 自体が undefined。着順列の可視化は `tokenizeRankString`（`packages/shared/src/utils/rank-marks.ts`） |
| `MotorStats`（`RaceRacer.motorStats`） | モーター期成績。motor_stats を `(場コード-モーター番号)` で各艇に突合（同一キーは記録日が新しい行を採用）。3連率・3連率順位・優勝/優出回数・平均ラップ秒を保持。当該場が motor_stats 未収録のレースでは undefined |
| `AiEvaluation` / `AiEvaluationEntry` / `AiEvaluationContribution` | AI 総合評価（`componentKeys` ぶんの寄与pt と強さpt） |
| `BetHitStatus` | 当日買い目・直前買い目の三連単フォーメーションが結果と一致したか |
| `BetPayoutResult` / `RaceBetPayoutSummary` / `DailyBetPayoutAggregate` | 3連単 フォーメーションを 1 点 ¥100 で買った場合の払戻 / 回収率（レース単位 / 当日集計） |
| `BettingTolerance` / `bettingToleranceFor` | 買い目の着順別しきい値（1着 / 2着 / 3着 の ± 許容幅）と予想者 ID からの解決関数。既定は全着順 ±0.10（`DEFAULT_BETTING_TOLERANCE`）。`BETTING_TOLERANCE_BY_PREDICTOR` に予想者別オーバーライドを定義（現状オーバーライド無し＝全予想者 ±0.10。以前は `v2_tenkai`=B君予想に 1着0.02 / 2着0.10 / 3着0.20 を設定していたが 2026-06-13 に A君予想へ揃えるため削除）。再最適化の根拠は boatracecsv 側 [`notebooks/threshold_optimization.ipynb`](https://github.com/BoatraceCSV) |

`RacePrediction` は `packages/web/src/data/races/{YYYY-MM-DD}/{raceCode}.json` に 1 ファイルずつ書き出される。`predictions[]` 配列にレジストリの active 予想者ぶんの `PredictorPrediction` が slot 昇順で並ぶ (旧 `aiEvaluation` / `betPayout` フィールドは primary predictor の値を平坦化して残しており、後方互換性のため当面保持)。

## レースコードの規約

`YYYYMMDDSSRR` の 12 桁。

- `YYYYMMDD`: 開催日（JST）
- `SS`: 会場 ID（`01`〜`24`、左ゼロ埋め）
- `RR`: レース番号（`01`〜`12`、左ゼロ埋め）

実装: [`packages/shared/src/utils/race-code.ts`](../packages/shared/src/utils/race-code.ts) (`parseRaceCode` / `buildRaceCode`)

## 会場マスタ

24 場のマスタは [`packages/shared/src/constants/stadiums.ts`](../packages/shared/src/constants/stadiums.ts)。`id` は `"01"`〜`"24"` の文字列、`name` と `prefecture` を持つ。

## アーカイブ日付インデックス (`_meta/dates.json`)

過去公開済み日付のリストを `gs://${GCS_WEB_BUCKET}/_meta/dates.json` に保持する。
`/archive/` インデックスページと `/archive/[date]` の「他の日付」セクションを
描画するためのソース。

形式:

```json
{ "dates": ["2024-01-01", "2024-01-02", ...] }
```

更新フロー:

1. バッチ `buildAndDeploy()` 開始時に GCS から取得し、当日分を追加。
2. ローカル `packages/web/src/data/_meta/dates.json` に書き出し → Astro が `loadHistoricalDates()` で読む。
3. デプロイ成功後、マージ済みのリストを GCS へ書き戻し。

初回シード（既存の公開済み過去ページを取り込む 1 回限りの操作）は
[`packages/batch/src/scripts/seed-archive-dates.ts`](../packages/batch/src/scripts/seed-archive-dates.ts)
を使う。手順は [operations.md](./operations.md) を参照。

実装: [`packages/batch/src/site-builder/dates-index.ts`](../packages/batch/src/site-builder/dates-index.ts) / [`packages/web/src/lib/data.ts`](../packages/web/src/lib/data.ts)。

## 統計集計の生成物 (`predictors/breakdown.json`)

`/stats/` ページ用の分析軸別集計。バッチの [`predictor-breakdown.ts`](../packages/batch/src/aggregator/predictor-breakdown.ts) が
`packages/web/src/data/predictors/breakdown.json` に書き出す。型は [`packages/shared/src/types/predictor-stats.ts`](../packages/shared/src/types/predictor-stats.ts)
で定義し、バッチ (生成) と web (描画) で共有する。値はすべて **直前 (realtime) のみ** (`metric: "realtime"`)。

```ts
type Metrics = {
  raceCount: number;            // n: 直前買い目が組めたレース数
  hitCount: number;             // 直前的中レース数
  hitRate: number | null;       // hitCount / raceCount (n=0 → null)
  betCostYen: number;           // 直前購入額 (1 点 ¥100)
  payoutYen: number;            // 直前払戻額
  recoveryRate: number | null;  // payoutYen / betCostYen (cost=0 → null)
};
type Bucket = { key: string; label: string; metrics: Metrics };
type TimeseriesPoint = { date: string; metrics: Metrics; cumulative: Metrics };
type PredictorBreakdown = {
  predictorId; predictorName; slot; status; startedAt;
  total: Metrics;
  timeseries: TimeseriesPoint[];   // 日次 (古→新)、各点は当日単独 + 累積
  byStadium; byGrade; byBetCount; byHonmeiWaku; byPayoutBand; byWindSpeed: Bucket[];
};
type PredictorBreakdownReport = {
  schemaVersion: 1; updatedAt: string; metric: "realtime";
  predictors: PredictorBreakdown[];
};
```

軸の定義・突合ルール (各軸の `raceCount` 合計が `total.raceCount` と一致、配当帯/風速は「不明」込みで一致) は
[batch.md](batch.md) の predictor-breakdown aggregator を参照。

## CSV のライフサイクル（GCS）

CSV ミラーバケットは以下のライフサイクルで自動遷移する（[infrastructure.md](./infrastructure.md) 参照）:

- 30 日超: NEARLINE
- 365 日超: COLDLINE

過去日付のレースページを再ビルドする場合、当日の CSV が NEARLINE / COLDLINE に落ちていてもコスト面の問題はあるが取得は可能。
