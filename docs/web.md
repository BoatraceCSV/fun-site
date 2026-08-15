# フロントエンド

`packages/web` の構成。Astro 5 + Tailwind CSS 4 による静的サイト生成（SSG）。

## ページ

実装は [`packages/web/src/pages/`](../packages/web/src/pages/)。

| ファイル | URL | 役割 |
|---|---|---|
| `index.astro` | `/` | トップ。当日開催中 24 場の次レースを一覧表示。下部から `/archive/` へ導線 |
| `stadium/[stadiumId]/index.astro` | `/stadium/{01-24}/` | 会場別。当日 1〜12R |
| `race/[date]/[stadiumId]/[raceNumber].astro` | `/race/{YYYY-MM-DD}/{01-24}/{1-12}/` | レース詳細。セクション順は レース結果 → 荒れ度メーター → 予想者カード → 直前情報 → 出走表 → 近況5節 → 得点率早見 → 枠番別過去10走。`prediction.predictions[]` をループして各予想者ぶんの `PredictorCard` を縦並び描画。上部の 1R-12R リンクバーは確定済みタイルに「確定」バッジと、**直前買い目が的中した予想者ぶんのアイコン**（`PredictorSpec.icon`。本命 🎯 / スジ 🧩 / 穴 💎）を slot 昇順で並べる |
| `predictors/index.astro` | `/predictors/` | 予想者比較。`src/data/predictors/stats.json` を読み、active 予想者の通算回収率・月次推移・採用成分を表で表示 |
| `stats/index.astro` | `/stats/` | 統計。`src/data/predictors/breakdown.json` を読み、各予想者の直前回収率・的中率を時系列推移 (累積、`TrendLineChart` の折れ線) と 6 軸 (場別 / グレード別 / 買い目点数別 / 本命枠番別 / 配当帯別 / 風速別) のテーブルで表示。各セルは n とセットで出し、`n < 20` は参考値として淡色表示 |
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

HTML 骨組み、meta タグ（OGP / Twitter Card）、ヘッダー（トップ / 予想者比較 / 統計 のナビ）、フッター、Tailwind の global CSS インポートを担う。

## 主要コンポーネント

[`packages/web/src/components/`](../packages/web/src/components/)

| コンポーネント | 役割 |
|---|---|
| `StartPredictionDiagram.astro` | スタート予想図（進入コース順に並べた SVG）。PredictorCard 内に表示。**予想者に依らず** AI 推定 ST 版 (`startPredictionEstimated`) を渡す（racer_st が無い日は全国平均ST の共通図 `startPrediction` にフォールバック）。図は表示専用で買い目・回収率に効かないため予想者ごとに出し分けず、予測区間（帯）を持つ AI 推定 ST 版に統一している。予想者ごとの `useEstimatedST` は 1マーク距離＝買い目の側だけに効く (0.00=実績なしは shared の `effectiveAvgST` により `NO_RECORD_ST_FALLBACK`=0.25 で遅め描画)。凡例は `start.usesEstimatedST` で「AI推定ST」/「全国平均ST」を出し分け。任意 prop `stNote` で ST 説明文を上書き可（既定は「スタートタイミングは選手の全国平均STです。」）。各艇の ST 値ラベルは上段に予想/平均ST、下段に `entry.exhibitionStartTiming`（stt 由来のスタート展示実測ST、`展xx.xx` 青字）を併記。実測が無い艇（stt 未取得 / 展示未計測=0→null）は下段を出さない。`entry.startTimingP25` / `startTimingP75` がある艇（AI 推定 ST 版のみ）は艇の背後に予測区間の帯を艇色 opacity 0.22 で敷き、凡例に「帯は予測のブレ幅（25〜75パーセンタイル）」を追記する。帯は点推定 1 本ではスリット先頭コースを 7 割外すことへの対処（経緯は BoatraceCSV `docs/design/slit_sim_plan.md`） |
| `OneMarkPredictionDiagram.astro` | 1 マーク予想（AI 寄与度ベース）の可視化。`aiEvaluation` は各予想者ごとの評価を採用するため、成分構成 (`componentKeys`) が本命予想と異なる予想者では図も異なり得る。PredictorCard 内に表示 |
| `AiEvaluationChart.astro` | AI 総合評価（枠別 寄与pt を横棒で積み上げ。採用成分は `evaluation.componentKeys` で動的に決まる) |
| `TrendLineChart.astro` | ゼロ JS のインライン SVG 折れ線。複数予想者を重ね描き。共通 x 軸 `labels` に対し各系列 `values` を同じ長さで揃え、`null` は点を描かない。値は割合を `%` 表記。任意 `refValue` で基準線 (回収率 100% = 1.0) を破線描画。`/stats/` の累積推移で利用 |
| `RacerTable.astro` | 出走表（選手名・級別・全国平均ST・全国/当地 勝率/2連/3連・モーター 2連/3連・ボート 2連/3連）。**1 艇 = 1 カード**のリスト（`<table>` ではない。8 項目を狭幅で列に並べると当地・モーター・ボートを隠すしかなくなるため）。カードは左端 4px を艇色のアクセント線にする（1号艇は白で見えないため淡いグレー）。ヘッダに 艇番バッジ / 選手名 + F/L 本数・賞除バッジ / 年齢・支部・出身地（支部と異なる場合のみ）/ 級別 / 平均ST。数値 4 項目はラベル付き `dl` グリッドで、幅 sm 未満は 2 列・sm 以上は 4 列。モーター・ボートは番号をラベル側に出し、値は 2連/3連 のみ。モーターは `motorStats` があれば優勝/優出回数・平均ラップ（期成績）を下に小さく併記。値は `whitespace-nowrap` で iPhone 幅 (375px) でも折り返さない。いずれかの選手に節間成績があるとき、各カード下部に区切り線付きで `SessionResultsGrid` を差し込み、リストの下に今節の読み方の凡例を 1 度だけ出す |
| `SessionResultsGrid.astro` | 節間成績（今節 14 スロット）の可視化。`RaceRacer.sessionResults`（未出走除外）を **日次ごとにグループ化**し、1 走ぶんを縦 4 段で並べる。**左端に行ラベル列**（上から `今節` / `R` / `進` / `ST` / `着`）を置き、行は上から R番号 → 進入コースバッジ → ST → 着順。ラベル列と各走の列は行ごとに同じ固定高 (`h-3` / `h-[18px]` / `h-3` / `h-4`) と同じ `gap-0.5` で揃えているので、高さを変えるときは両方を直すこと。1 走の列幅は 18px・走間 2px・日次グループ間 4px まで詰めてあり、iPhone 幅 (375px) で **6 日制の節（12 走）までが折り返さずに 1 行**に収まる（7 日制の最終日 = 14 走のみ 2 行目に折り返す）。ST だけ `text-[8px]` なのは、フライング表記 `F.03` を 18px 幅に収めるため。**着順には色を付けない**（プレーンなテキスト。F=赤字 / L=橙字 / その他特殊トークン=灰字のみ文字色で区別）。**バッジの背景色は対象レースでの枠番の艇番カラー**（`BOAT_COLORS`: 1=白 / 2=黒 / 3=赤 / 4=青 / 5=黄 / 6=緑、枠番不明=灰）、**バッジ内の数字は進入コース**。ST は先頭の 0 を省いた表記で、負値（フライング）は `F.02` のように出す。ツールチップ（`title`）にも 日次・走・R・進入・枠・ST を残す。`RacerTable` の各カード内で利用し、凡例は `RacerTable` 側に 1 度だけ出す |
| `RacePreviewSection.astro` | 直前情報セクション。`RacePrediction.preview`（tkz + sui + original_exhibition）から、上部に水面気象（天候ラベル・風速・波高・気温・水温・観測時刻）、中部に展示テーブル（展示タイム・体重・体重調整・チルト）、下部にオリジナル展示テーブル（場別の可変計測項目を `labels` で見出し化、各艇の `values`）を表示。展示タイム・オリジナル展示とも各列の最速（最小値）を青字強調。天候コードは 1晴/2曇/3雨/4雪/5霧 でラベル化。`preview` が無い / 中身が空のレースでは詳細ページ側で非表示 |
| `RecentFormSection.astro` | 近況5節セクション。`RacePrediction.recentForm` から艇別に全国・当地の直近5節を表示。1 節 = 1 行で、グレード・場名・期間と着順を**同じ行**に並べる。着順は `tokenizeRankString` のトークンが必ず 1 文字なので `325 3 3142` のように**詰めて**出し、日区切りだけ 4px の空きを挟む。**着順に色は付けない**（F=赤字 / L=橙字 / その他特殊トークン=灰字のみ文字色で区別、優勝戦は赤枠。枠は `ring` = box-shadow なので詰め表示の字送りに影響しない）。このセクションの元データ（recent_national / recent_local）は各走の枠番・進入コースを持たないため、`SessionResultsGrid` / `Waku10Section` のような枠番バッジは出せない。節は古→新（左→右）に並べ替えて表示。`recentForm` が無いレースでは詳細ページ側で非表示 |
| `TokutenHayamiSection.astro` | 得点率早見セクション。`RacePrediction.tokutenHayami` から、艇別の現在の得点率・節内順位と「このレースで k 着を取った場合の得点率」(1着〜6着) を表にする。順位がボーダー以内の艇は得点率・順位を橙字で強調し、着順別セルは上流の状態コード (bit1=ボーダー得点率以上 / bit2=次レース次第 / bit4=当レース終了時点でボーダー以上) で背景を出し分ける。**背景色は `<td>` に付けてセル枠いっぱいを塗る**（内側 span に付けると文字幅ぶんしか塗られない）。iPhone 幅 (375px) で 10 列すべてが横スクロールなしに収まるよう、フォント (表 `text-[11px]` / 選手名・着順別セル `text-[10px]`) とセル padding (`px-0.5`) を絞り、艇番バッジも `w-4` にしている（min-content 285px < 利用可能幅 311px）。`overflow-x-auto` は極端に長い選手名のときのフォールバックとして残す。**選手名の横には級別も「本日 nR も出走」も出さない**（`TokutenHayamiRacer.classGrade` / `otherRaceNumber` は型には残るが未使用）。凡例にこのレースの着順点 (予選 10/8/6/4/2/1) とボーダー順位を添える。`tokutenHayami` が無いレースでは詳細ページ側で非表示 |
| `Waku10Section.astro` | 枠番別過去10走セクション。`RacePrediction.waku10` から艇別に、過去10走（左が前走 = 新しい順）を**左**に、当該枠番での勝率・平均ST・平均ｽﾀｰﾄ順を**右**に置いた 1 行のカードで表示。**艇番バッジと選手名は出さない**（出走表・近況5節と重複するうえ、iPhone 幅で 10 走 + 集計値を 1 行に収める余地を食うため）。どの艇かは行順（枠番昇順）とバッジの背景色（= 枠番の艇色）で判別する。**左端に行ラベル列**（上から `進` / `着`）を置き、1 走ぶんを縦 2 段（上=進入コースバッジ 18px、下=着順）で並べる。`SessionResultsGrid` と同じ規則で、**着順には色を付けず**（F=赤字 / L=橙字 / その他特殊トークン=灰字のみ文字色で区別）、**バッジの背景色は枠番**（このセクションでは当該艇の枠番で固定）・**バッジ内の数字は進入コース**とする。**グレードは文字では出さず、IP 以外（G3 / G2 / G1 / SG）をバッジの太い紫枠 (`2px solid #7e22ce`) で表す**（グレード名はバッジの `title` に残る）。進入が枠なり（CSV 空欄）の走は枠番で補完した値なので**数字だけ**薄くする（バッジ全体を薄くすると枠番の色とグレードの紫枠まで鈍るため）。`waku10` が無いレースでは詳細ページ側で非表示 |
| `PredictorCard.astro` | 1 予想者ぶんの予想カード。表示名・買い目 (BettingPicks) ・回収率 (BetPayoutSummary)・AI 評価チャートを 1 セクションに集約。レース詳細ページは `prediction.predictions[]` をループしてこれを縦並びレンダリングする。任意 prop `startPrediction` / `oneMarkAiEvaluation` が両方渡されたときスタート予想・1マーク予想の 2 図をカード内に 2 カラムグリッドで小さく横並び表示する。レース詳細ページは予想者カードを `PredictorSpec` 駆動で描画し、**`showsAiPanelsFor(predictorId)` が true の予想者にだけ**「AI 評価の内訳」(`showChart`) と 2 図を渡す（false は買い目が CSV 由来の `v9_suji`＝スジ予想 / `v10_kimarite`＝穴予想。これらのカードは買い目と回収率だけになる。現行 active で 3 パネルが出るのは本命予想 `v1_basic` のカードだけ）。`startNote` prop は `StartPredictionDiagram` の `stNote` へ転送。任意 prop `recipeNote` を渡すとカード見出し直下に本命予想からの recipe 差分注記を表示する（現行 active な予想者には注記を用意していないため、過去日の退役予想者カードでのみ表示される）。スタート予想は全予想者共通で AI 推定 ST（帯つき）、1マークは予想者ごとの AI 評価を渡す（recipe が本命予想と異なる予想者では図も異なり得る） |
| `BettingPicks.astro` | 当日買い目・直前買い目の三連単フォーメーションと的中可否 (PredictorCard 内部で利用)。`predictorName` prop が渡されると見出しに「{予想者名}当日買い目」「{予想者名}直前買い目」として予想者名をプレフィクスする。`predictorId` prop で買い目しきい値（`bettingToleranceFor`。距離基準はオーバーライド無しで ±0.10、`strengthOnlyBetting` な予想者は ±5.0pt）と走行距離の予測 ST 種別（`oneMarkDistanceOptionsFor`。`useEstimatedST` な予想者は AI 推定 ST、他は全国平均 ST）と買い目候補の選定基準（`bettingBasisFor`。`strengthOnlyBetting` な予想者のみ走行距離ではなく強さpt）を予想者ごとに切替（`useEstimatedST` / `strengthOnlyBetting` を持つ予想者は現行 active には無く、過去日の退役予想者カードでのみ効く）。どちらもバッチの買い目生成（`prediction-builder.ts`）と同じヘルパーで解決するため、表示される買い目と的中・回収率の集計対象になる買い目が一致する。説明文のしきい値表記・予測 ST 種別も実値に追従する。`bettingStyleFor` が `"formation"` 以外を返す場合は説明文を差し替える（`"suji"`＝スジ予想は「1コース以外で強さptが最大の艇を1着に固定し、スジ表 P(2着, 3着 | 1着) の上位 5 ペアを組み合わせた 5 点」、`"kimarite"`＝穴予想は「決まり手 × 1着コースの確率表から組み立てた上位 5 点」。1 マーク走行距離を使わない予想者にフォーメーションの説明を出さないため） |
| `BetPayoutSummary.astro` | 「もし買ったら」セクション。レース 1 件分の 3連単 フォーメーション × 1点¥100 の払戻 / 回収率を当日・直前別に表示 (PredictorCard 内部で利用)。`predictorName` prop で見出しに予想者名プレフィクス対応。`actualSanrentan` が null（= 3連単 払戻未取得）のレースは「確定前」バッジを出し、払戻・回収率は `—` 表示にして外れと区別する |
| `DailyBetSummary.astro` | トップページの当日サマリー。締切済み全レースを集計した 3連単 戦略の的中率・回収率を予想者別（直前買い目のみ）に表示（本命直前 / スジ直前 / 穴直前 の 3 カード。`activePredictors()` を slot 昇順でループするため active 予想者の増減に自動追従。新スキーマ `prediction.predictions[]` を優先し、無い場合のみ primary 予想者を legacy `prediction.betPayout.realtime` でフォールバック） |
| `StadiumSeriesSummary.astro` | レース詳細ページの 1R-12R リンクバー直下に表示する今節成績。`_meta/series-summary.json` から当該会場の「節初日〜当日」3連単 戦略（直前買い目）の的中率・回収率・期間を表示 |
| `RaceResultSection.astro` | レース結果（着順・ST・決まり手・天候）。`predictions` prop（`PredictorPrediction[]`）が渡されると、**直前買い目**が的中した予想者ぶんの的中バッジ「{予想者短縮名}直前買い目 的中」を slot 昇順で表示（本命 🎯 / スジ 🧩 / 穴 💎。アイコン・配色は `getPredictorBadge()` 経由でレジストリから引く）。当日買い目の的中は `PredictorCard` 内の `BetPayoutSummary` 側にのみ出す |
| `RaceCard.astro` | トップ・会場別ページのレース概要カード（グレードバッジ・締切・確定状態）。3 行目に「今節成績」(直前買い目戦略の的中率 / 回収率) を表示。`seriesAggregate` prop を渡さない / null の場合は「集計データなし」表示 |
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

## 買い目の表示 (フォーメーション / 出目リスト)

`BettingPicks.astro` は 2 形態を描画する(`BettingPicks` は直和型)。

- `kind: "formation"` — 従来どおり 1着 / 2着 / 3着 の候補艇を並べる
- `kind: "combos"` — 出目を 1 行ずつ縦に並べ、右に決まり手注釈を添える
  (穴予想 `v9_suji` / `v10_kimarite`)

`dailyPicks` / `realtimePicks` props が渡された場合は**それを描画し、
内部での再計算はしない**。穴予想 2 案は CSV 由来なので web からは再計算できず、
これが必須になる。渡されない場合は従来どおり強さpt から計算する。

> `v10_kimarite` は 120 通りの確率から上位 5 点を取るので、**1 レースの 5 点に
> 複数の 1着艇が混ざる**(`v9_suji` は 1着艇が 1 つに決まる)。`combos` 表示は
> どちらもそのまま扱える。

## 荒れ度メーター

`UpsetMeter.astro` が `RacePrediction.upsetMeter` を描画する。直前 (realtime) が
あればそれを、無ければ朝 (daily) の値に「(朝時点)」を添えて出す。
**予想者に紐づかない**ので予想者カードの外に 1 回だけ置く。

決まり手の内訳は出さない。レース単位の決まり手予測は当たっていないため
(BoatraceCSV `docs/design/ana_prediction.md` §14.2)。
