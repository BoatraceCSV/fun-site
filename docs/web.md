# フロントエンド

`packages/web` の構成。Astro 5 + Tailwind CSS 4 による静的サイト生成（SSG）。

## ページ

実装は [`packages/web/src/pages/`](../packages/web/src/pages/)。

| ファイル | URL | 役割 |
|---|---|---|
| `index.astro` | `/` | トップ。当日開催中 24 場の次レースを一覧表示。下部から `/archive/` へ導線 |
| `stadium/[stadiumId]/index.astro` | `/stadium/{01-24}/` | 会場別。当日 1〜12R |
| `race/[date]/[stadiumId]/[raceNumber].astro` | `/race/{YYYY-MM-DD}/{01-24}/{1-12}/` | レース詳細。`prediction.predictions[]` をループして各予想者ぶんの `PredictorCard` を縦並び描画 |
| `predictors/index.astro` | `/predictors/` | 予想者比較。`src/data/predictors/stats.json` を読み、active 予想者の通算回収率・月次推移・採用成分を表で表示 |
| `archive/index.astro` | `/archive/` | 過去公開日付のインデックス。月別グルーピング |
| `archive/[date].astro` | `/archive/{YYYY-MM-DD}/` | 過去日付の一覧。「他の日付」セクションで同月+前月の日付へ誘導 |

### ビルド対象日の制御

`getStaticPaths()` 内で [`packages/web/src/lib/data.ts`](../packages/web/src/lib/data.ts) を呼び、対象日を決める。

| 環境変数 | 効果 |
|---|---|
| なし（既定） | JST 当日 1 日分のみビルド |
| `BUILD_TARGET_DATE=YYYY-MM-DD` | 明示指定（CI / backfill 用） |
| `BUILD_ALL_DATES=1` | `src/data/races/` 配下に存在する全日付（ローカル開発） |

過去日付の HTML は GCS に残置されるため、`BUILD_ALL_DATES=1` でなくとも公開済みページは閲覧可能。
公開済み日付の一覧は `_meta/dates.json` (バッチが GCS から取得して `src/data/_meta/` に配置)
に保持され、`/archive/` インデックスから辿れる。

## レイアウト

[`packages/web/src/layouts/BaseLayout.astro`](../packages/web/src/layouts/BaseLayout.astro)

HTML 骨組み、meta タグ（OGP / Twitter Card）、ヘッダー、フッター、Tailwind の global CSS インポートを担う。

## 主要コンポーネント

[`packages/web/src/components/`](../packages/web/src/components/)

| コンポーネント | 役割 |
|---|---|
| `StartPredictionDiagram.astro` | スタート予想図（進入コース順に並べた SVG） |
| `OneMarkPredictionDiagram.astro` | 1 マーク予想（AI 寄与度ベース）の可視化 |
| `AiEvaluationChart.astro` | AI 総合評価（枠別 寄与pt を横棒で積み上げ。採用成分は `evaluation.componentKeys` で動的に決まる) |
| `RacerTable.astro` | 出走表（選手名・級別・勝率・モーター情報） |
| `PredictorCard.astro` | 1 予想者ぶんの予想カード。表示名・買い目 (BettingPicks) ・回収率 (BetPayoutSummary)・AI 評価チャートを 1 セクションに集約。レース詳細ページは `prediction.predictions[]` をループしてこれを縦並びレンダリングする |
| `BettingPicks.astro` | A君直前買い目・B君直前買い目の三連単フォーメーションと的中可否 (PredictorCard 内部で利用) |
| `BetPayoutSummary.astro` | 「もし買ったら」セクション。レース 1 件分の 3連単 フォーメーション × 1点¥100 の払戻 / 回収率を A君直前・B君直前別に表示 (PredictorCard 内部で利用) |
| `DailyBetSummary.astro` | トップページの当日サマリー。締切済み全レースを集計した 3連単 戦略の的中率・回収率（A君直前・B君直前別） |
| `StadiumSeriesSummary.astro` | レース詳細ページの 1R-12R リンクバー直下に表示する今節成績。`_meta/series-summary.json` から当該会場の「節初日〜当日」3連単 戦略（B君直前買い目）の的中率・回収率・期間を表示 |
| `RaceResultSection.astro` | レース結果（着順・ST・決まり手・天候）。A君直前買い目 / B君直前買い目の的中バッジも表示 |
| `RaceCard.astro` | トップ・会場別ページのレース概要カード（グレードバッジ・締切・確定状態）。3 行目に「今節成績」(B君直前買い目戦略の的中率 / 回収率) を表示。`seriesAggregate` prop を渡さない / null の場合は「集計データなし」表示 |
| `ConfidenceStars.astro` | 信頼度を星で表示 |
| `PredictionImage.astro` | 予想画像（OGP 用） |
| `ShareButton.astro` | SNS 共有ボタン |

## データ読み込み

ビルド時の読み込みのみ。ランタイム fetch はしない（SSG なので JS ゼロ）。

[`packages/web/src/lib/data.ts`](../packages/web/src/lib/data.ts):

| 関数 | 役割 |
|---|---|
| `loadPredictions(date)` | `src/data/races/{date}/*.json` を全件読み込み、`RacePrediction[]` を返す。古いスキーマの JSON は除外 |
| `loadAvailableDates()` | `src/data/races/` の `YYYY-MM-DD` ディレクトリ一覧を返す。`BUILD_ALL_DATES` で挙動切り替え。既定では当日 1 件のみ (`getStaticPaths` の生成対象を絞るため) |
| `loadHistoricalDates()` | `src/data/_meta/dates.json` から過去公開済み日付の全リストを降順で返す。バッチが GCS から取得した dates index を読む。`/archive/` インデックスと `/archive/[date]` の「他の日付」表示用 |
| `loadSeriesSummary()` | `src/data/_meta/series-summary.json` を読み、`byStadium[stadiumId]` 形式の節集計を返す。会場ページの `getStaticPaths` から 1 度だけ呼んで 24 会場分を配り直す想定。ファイルが無い / 壊れている場合は null を返す |
| `getBuildTargetDate()` | `BUILD_TARGET_DATE` 環境変数優先、無ければ JST 当日 |

データの出処は `packages/batch` が書き出す JSON。バッチ実行前は空の状態になり、開発サーバーでは「本日の予想データはまだありません」と表示される。

## スタイル

- Tailwind CSS 4 を Vite plugin (`@tailwindcss/vite`) 経由で利用
- グローバル CSS は `BaseLayout` から import
- 艇番ごとの色（白/黒/赤/青/黄/緑）は [`packages/shared/src/constants/boat-colors.ts`](../packages/shared/src/constants/boat-colors.ts) を参照して Tailwind のクラスに反映
- グレードバッジの色定義は [`packages/shared/src/constants/race-grades.ts`](../packages/shared/src/constants/race-grades.ts)
- `packages/shared/src/` の TS から動的に組み立てる Tailwind クラス（例: `race-grades.ts` の `bg-amber-500`）は Tailwind v4 のデフォルト content scan から外れるため、[`packages/web/src/styles/global.css`](../packages/web/src/styles/global.css) の `@source "../../../shared/src/**/*.ts";` で明示スキャンする。本番 (batch コンテナ内での Astro ビルド) でもこのスキャンが効くよう、`packages/batch/Dockerfile` の runner ステージで `packages/shared/src/` を runner にコピーしている

## 開発コマンド

```bash
# 開発サーバー (http://localhost:4321)
pnpm --filter @fun-site/web run dev

# 単体ビルド
pnpm --filter @fun-site/web run build

# 型チェック
pnpm --filter @fun-site/web run typecheck
```

開発サーバーは `src/data/races/` を直接読むため、`packages/batch` を実行して JSON を書き出してから起動すると実データで確認できる。

## 関連ドキュメント

- データ生成側: [batch.md](./batch.md)
- 配信インフラ（GCS / CDN）: [infrastructure.md](./infrastructure.md)
- ローカル起動: [development.md](./development.md)
