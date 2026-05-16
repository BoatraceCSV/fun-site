# フロントエンド

`packages/web` の構成。Astro 5 + Tailwind CSS 4 による静的サイト生成（SSG）。

## ページ

実装は [`packages/web/src/pages/`](../packages/web/src/pages/)。

| ファイル | URL | 役割 |
|---|---|---|
| `index.astro` | `/` | トップ。当日開催中 24 場の次レースを一覧表示 |
| `stadium/[stadiumId]/index.astro` | `/stadium/{01-24}/` | 会場別。当日 1〜12R |
| `race/[date]/[stadiumId]/[raceNumber].astro` | `/race/{YYYY-MM-DD}/{01-24}/{1-12}/` | レース詳細 |
| `archive/[date].astro` | `/archive/{YYYY-MM-DD}/` | 過去日付の一覧 |

### ビルド対象日の制御

`getStaticPaths()` 内で [`packages/web/src/lib/data.ts`](../packages/web/src/lib/data.ts) を呼び、対象日を決める。

| 環境変数 | 効果 |
|---|---|
| なし（既定） | JST 当日 1 日分のみビルド |
| `BUILD_TARGET_DATE=YYYY-MM-DD` | 明示指定（CI / backfill 用） |
| `BUILD_ALL_DATES=1` | `src/data/races/` 配下に存在する全日付（ローカル開発） |

過去日付の HTML は GCS に残置されるため、`BUILD_ALL_DATES=1` でなくとも公開済みページは閲覧可能。

## レイアウト

[`packages/web/src/layouts/BaseLayout.astro`](../packages/web/src/layouts/BaseLayout.astro)

HTML 骨組み、meta タグ（OGP / Twitter Card）、ヘッダー、フッター、Tailwind の global CSS インポートを担う。

## 主要コンポーネント

[`packages/web/src/components/`](../packages/web/src/components/)

| コンポーネント | 役割 |
|---|---|
| `StartPredictionDiagram.astro` | スタート予想図（進入コース順に並べた SVG） |
| `OneMarkPredictionDiagram.astro` | 1 マーク予想（AI 寄与度ベース）の可視化 |
| `AiEvaluationChart.astro` | AI 総合評価（枠別 5 要素の寄与pt を横棒で積み上げ） |
| `RacerTable.astro` | 出走表（選手名・級別・勝率・モーター情報） |
| `BettingPicks.astro` | 当日買い目・直前買い目の三連単フォーメーションと的中可否 |
| `BetPayoutSummary.astro` | 「もし買ったら」セクション。レース 1 件分の 3連単 フォーメーション × 1点¥100 の払戻 / 回収率を当日・直前別に表示 |
| `DailyBetSummary.astro` | トップページの当日サマリー。締切済み全レースを集計した 3連単 戦略の的中率・回収率（当日・直前別） |
| `RaceResultSection.astro` | レース結果（着順・ST・決まり手・天候） |
| `RaceCard.astro` | トップ・会場別ページのレース概要カード（グレードバッジ・締切・確定状態） |
| `ConfidenceStars.astro` | 信頼度を星で表示 |
| `PredictionImage.astro` | 予想画像（OGP 用） |
| `ShareButton.astro` | SNS 共有ボタン |

## データ読み込み

ビルド時の読み込みのみ。ランタイム fetch はしない（SSG なので JS ゼロ）。

[`packages/web/src/lib/data.ts`](../packages/web/src/lib/data.ts):

| 関数 | 役割 |
|---|---|
| `loadPredictions(date)` | `src/data/races/{date}/*.json` を全件読み込み、`RacePrediction[]` を返す。古いスキーマの JSON は除外 |
| `loadAvailableDates()` | `src/data/races/` の `YYYY-MM-DD` ディレクトリ一覧を返す。`BUILD_ALL_DATES` で挙動切り替え |
| `getBuildTargetDate()` | `BUILD_TARGET_DATE` 環境変数優先、無ければ JST 当日 |

データの出処は `packages/batch` が書き出す JSON。バッチ実行前は空の状態になり、開発サーバーでは「本日の予想データはまだありません」と表示される。

## スタイル

- Tailwind CSS 4 を Vite plugin (`@tailwindcss/vite`) 経由で利用
- グローバル CSS は `BaseLayout` から import
- 艇番ごとの色（白/黒/赤/青/黄/緑）は [`packages/shared/src/constants/boat-colors.ts`](../packages/shared/src/constants/boat-colors.ts) を参照して Tailwind のクラスに反映
- グレードバッジの色定義は [`packages/shared/src/constants/race-grades.ts`](../packages/shared/src/constants/race-grades.ts)

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
