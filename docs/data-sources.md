# データソース

fun-site が取得・利用する [BoatraceCSV](https://github.com/BoatraceCSV) の CSV データと、それらの保管場所・取得方法。

## CSV 種別

| 種別 | パス（プレフィックス省略） | 内容 | 利用箇所 |
|---|---|---|---|
| `programs/title` | `programs/title/YYYY/MM/DD.csv` | 出走表メタ（レース名・グレード・締切時刻） | ヘッダ |
| `programs/race_cards` | `programs/race_cards/YYYY/MM/DD.csv` | 選手プロフィール・モーター・全国平均ST | スタート予想・出走表 |
| `previews/stt` | `previews/stt/YYYY/MM/DD.csv` | 直前情報（進入コース・スタート展示） | スタート予想の進入コース |
| `estimate/index` | `estimate/index/YYYY/MM/DD.csv` | AI 強さpt（5 要素の寄与pt） | AI 総合評価 |
| `results/realtime` | `results/realtime/YYYY/MM/DD.csv` | 当日確定直後のレース結果 | レース結果セクション・的中判定 |

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
| `RaceCardRow` / `RaceCardRacer` | `programs/race_cards` | 選手名・級別・年齢・支部、勝率・連対率、モーター情報、全国平均ST |
| `SttRow` / `SttBoat` | `previews/stt` | 進入コース、スタート展示 |
| `IndexRow` / `IndexEntry` | `estimate/index` | 状態（daily/realtime）、5 要素の寄与pt、強さpt |
| `RaceResultRow` / `RaceResultFinish` / `RaceResultCourse` / `RaceResultWeather` | `results/realtime` | 着順、決まり手、ST、天候 |

### 統合した予想型

| 型 | 役割 |
|---|---|
| `RacePrediction` | レース 1 件分の統合予想。バッチが書き出し、Astro が読み込む |
| `StartPrediction` / `StartPredictionEntry` | スタート予想（進入コース + スタートタイミング） |
| `AiEvaluation` / `AiEvaluationEntry` / `AiEvaluationContribution` | AI 総合評価（強さpt と寄与の内訳） |
| `BetHitStatus` | 当日買い目・直前買い目の三連単フォーメーションが結果と一致したか |

`RacePrediction` は `packages/web/src/data/races/{YYYY-MM-DD}/{raceCode}.json` に 1 ファイルずつ書き出される。

## レースコードの規約

`YYYYMMDDSSRR` の 12 桁。

- `YYYYMMDD`: 開催日（JST）
- `SS`: 会場 ID（`01`〜`24`、左ゼロ埋め）
- `RR`: レース番号（`01`〜`12`、左ゼロ埋め）

実装: [`packages/shared/src/utils/race-code.ts`](../packages/shared/src/utils/race-code.ts) (`parseRaceCode` / `buildRaceCode`)

## 会場マスタ

24 場のマスタは [`packages/shared/src/constants/stadiums.ts`](../packages/shared/src/constants/stadiums.ts)。`id` は `"01"`〜`"24"` の文字列、`name` と `prefecture` を持つ。

## CSV のライフサイクル（GCS）

CSV ミラーバケットは以下のライフサイクルで自動遷移する（[infrastructure.md](./infrastructure.md) 参照）:

- 30 日超: NEARLINE
- 365 日超: COLDLINE

過去日付のレースページを再ビルドする場合、当日の CSV が NEARLINE / COLDLINE に落ちていてもコスト面の問題はあるが取得は可能。
