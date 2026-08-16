# フロントエンド

`packages/web` の構成。Astro 5 + Tailwind CSS 4 による静的サイト生成（SSG）。

## ページ

実装は [`packages/web/src/pages/`](../packages/web/src/pages/)。

| ファイル | URL | 役割 |
|---|---|---|
| `index.astro` | `/` | トップ。当日開催中 24 場の次レースを一覧表示。下部から `/archive/` へ導線 |
| `stadium/[stadiumId]/index.astro` | `/stadium/{01-24}/` | 会場別。当日 1〜12R |
| `race/[date]/[stadiumId]/[raceNumber].astro` | `/race/{YYYY-MM-DD}/{01-24}/{1-12}/` | レース詳細。セクション順は レース結果 → 出走表 → 荒れ度メーター → 予想者カード → 直前情報 → 得点率早見 → 枠番別過去10走 → 今節成績 → 近況5節。今節成績セクションは、いずれかの選手に出走済みの節間スロットがある場合のみ出す（初日は全員未出走なのでセクションごと消える）。`prediction.predictions[]` をループして各予想者ぶんの `PredictorCard` を縦並び描画。直前情報セクションの見出し右には展示詳細ページへの「展示ptの詳細 ▸」と気象詳細ページへの「気象ptの詳細 ▸」リンクを置く（どちらも preview 由来成分で、daily 評価では AI 評価バーに展示・気象セグメントが出ず凡例からの導線が無いため）。上部の 1R-12R リンクバーは確定済みタイルに「確定」バッジと、**直前買い目が的中した予想者ぶんのアイコン**（`PredictorSpec.icon`。本命 🎯 / スジ 🧩 / 穴 💎）を slot 昇順で並べる |
| `race/[date]/[stadiumId]/[raceNumber]/racers.astro` | `/race/{YYYY-MM-DD}/{01-24}/{1-12}/racers/` | 選手詳細。対象レースの 6 選手ぶんを 1 ページに集約し、**選手pt がなぜその数字なのか**を開示する。上部に 6 艇の 素点 / 選手pt / 寄与 / 強さpt の比較表、その下に選手ごとのカード（基本情報 → 選手pt サマリー → 素点の計算根拠テーブル）、末尾に計算ロジックの折りたたみ解説。素点は `computeRacerPtBreakdown` で `recentForm` から**再計算**し、偏差値と寄与は index CSV 由来の値をそのまま出す。導線はレース詳細ページの「AI 評価の内訳」凡例の**選手**から（現行 active では `showsAiPanels` が true の本命予想 `v1_basic` のカードにのみ出る） |
| `race/[date]/[stadiumId]/[raceNumber]/motors.astro` | `/race/{YYYY-MM-DD}/{01-24}/{1-12}/motors/` | モーター詳細。対象レースの 6 モーターぶんを 1 ページに集約し、**モーターpt が何を測っている数字なのか**を開示する。上部に 6 艇の モーターpt / 寄与 / 強さpt / 期3連率 / 今節平均 の比較表、その下にモーターごとのカード（`MotorPtCard`）、末尾に計算ロジックの折りたたみ解説（スコア表・トークンの扱い・時間減衰/コース補正/ベイズ収縮）。選手詳細ページと違い**素点は再計算しない**（当場の過去6節ぶんの race_cards と全24場横断のベースラインが要り、fun-site は当日ぶんの CSV しか取得していないため）。モーターpt / 寄与は index CSV 由来の値をそのまま出し、`components.motor` が無い過去日の JSON 向けに `motor4`（退役した v4_motor 系）へフォールバックする。導線はレース詳細ページの「AI 評価の内訳」凡例の**モーター**から |
| `race/[date]/[stadiumId]/[raceNumber]/lanes.astro` | `/race/{YYYY-MM-DD}/{01-24}/{1-12}/lanes/` | 枠番詳細。対象レースの 6 枠ぶんを 1 ページに集約し、**枠番pt が何を測っている数字なのか**を開示する。上部に 6 艇の 進入コース / 枠番pt / 寄与 / 強さpt / 枠1着率 の比較表、その下に枠ごとのカード（`WakuPtCard`）、末尾に計算ロジックの折りたたみ解説（テーブルの軸・選手pt/モーターptとの違い・枠番と進入コースのずれ・コースptとの違い）。モーター詳細ページと同じく**テーブル値は再計算しない**（場×季節×コースのコース強度テーブルはその場の過去数年ぶんの着順実績由来で、fun-site は当日ぶんの CSV しか取得していないため）。枠番pt / 寄与は index CSV 由来 (`components.waku` / `contribution.waku`)、進入コースは `startPrediction`（stt 未取得なら枠なり仮値）、枠1着率は `computeWaku10Aggregate` で `waku10` から集計した**参考値**。導線はレース詳細ページの「AI 評価の内訳」凡例の**枠番**と、枠番別過去10走セクション見出し右の「枠番ptの詳細 ▸」から |
| `race/[date]/[stadiumId]/[raceNumber]/exhibition.astro` | `/race/{YYYY-MM-DD}/{01-24}/{1-12}/exhibition/` | 展示詳細。対象レースの 6 艇ぶんを 1 ページに集約し、**展示pt が何を測っている数字なのか**を開示する。上部に 6 艇の 展示pt / 寄与 / 強さpt / 展示タイム / 展示ST の比較表（展示タイム列・展示ST列は 1 艇でも実測がある場合のみ）、その下に艇ごとのカード（`ExhibitPtCard`）、末尾に読み方の折りたたみ解説（daily と realtime の違い・展示タイムとの一致度・計測値の読み方）。モーター詳細 / 枠番詳細と同じく**素点は再計算しない**（展示走行のどの計測値をどう重み付けするかは BoatraceCSV 側の実装で、fun-site は重みを取り込んでいないため）。展示pt / 寄与は index CSV 由来 (`components.exhibit` / `contribution.exhibit`)、展示タイム・体重・チルト・オリジナル展示は `preview`、展示ST は `startPrediction.entries[].exhibitionStartTiming`、順位と**展示ptと展示タイムの順位相関**は `computeExhibitPtAggregate` の**参考値**。**評価が daily（展示前）のときはページ冒頭に琥珀のバナー**を出し、全艇が中立値 50 / 寄与 0 であることを断る。導線はレース詳細ページの「AI 評価の内訳」凡例の**展示**（preview 由来成分なので daily 評価では凡例自体が出ない）と、直前情報セクション見出し右の「展示ptの詳細 ▸」から |
| `race/[date]/[stadiumId]/[raceNumber]/weather.astro` | `/race/{YYYY-MM-DD}/{01-24}/{1-12}/weather/` | 気象詳細。対象レースの 6 艇ぶんを 1 ページに集約し、**気象pt が何を測っている数字なのか**を開示する。上部にこのレースの水面気象（天候 / 風速 + 追い風・向かい風・横風の別 / 波高 / 気温 / 水温 / 観測時刻）と**回帰が見る 6 特徴量**（波高・気温−水温・追い風 m/s・向かい風 m/s・曇り・雨）の表、その下に 6 艇の 進入コース / 気象pt / 寄与 / 強さpt の比較表、艇ごとのカード（`WeatherPtCard`）、末尾に読み方の折りたたみ解説（3 段階の計算・コースに付く値であること・daily と realtime の違い・風向の正規化）。モーター詳細 / 枠番詳細 / 展示詳細と同じく**素点は再計算しない**（場別の回帰係数 `estimate/stadium/sui_params.csv` を fun-site は取り込んでいないため、出せるのは係数を掛ける前の特徴量まで）。気象pt / 寄与は index CSV 由来 (`components.weather` / `contribution.weather`)、水面気象は `preview.weather`、進入コースは `startPrediction`（stt 未取得なら枠なり仮値）、順位と**進入コースと気象ptの順位相関**（`innerBias`。+1 = 内コース有利に振れている）は `computeWeatherPtAggregate` の**参考値**。**評価が daily（直前情報前）のときはページ冒頭に琥珀のバナー**を出し、全艇が中立値 50 / 寄与 0 であることを断る。導線はレース詳細ページの「AI 評価の内訳」凡例の**気象**（preview 由来成分なので daily 評価では凡例自体が出ない）と、直前情報セクション見出し右の「気象ptの詳細 ▸」から |
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
| `lib/start-diagram.ts` | スタート予想図・スタート結果図が**共有する座標系と艇の描画**。表示レンジ (`ST_MIN`=-0.10 / `ST_MAX`=0.90)・viewBox・レーン高・艇のサイズ・輪郭パス (`boatHullPath`) をここ 1 箇所で定義する。2 図は同じ目盛りで見比べられることが目的なので、片方だけ変えないこと。**艇は 1 艇身 = `BOAT_LENGTH_SEC` 0.135 秒ぶんの長さ**で描く（スリット付近の艇速 80km/h = 22.22m/s で艇長 3m を通過する時間）。ST は舳先がスタートラインを通過した時刻なので、円の中心ではなく**舳先**を ST の位置に置き、船尾が左へ 1 艇身伸びる。レンジ span は 1.0 秒で、出遅れ (L) 判定の 1 秒手前まで入るためフライングから大出遅れまでクランプされずに収まり、1 艇身は水面幅の約 13.5% になる。参考にした BOAT RACE 公式のスタート情報図は艇画像 54px・目盛り約 178px/秒（≒0.30 秒/艇身）で実寸の 2 倍以上あるが、こちらは物理どおりに合わせている。艇長の換算 `boatLengthPx(span, trackW)` と輪郭パス・キャノピーは軸レンジと水面幅を引数に取るので、**1マーク予想図からも同じ形の艇を描ける**（横軸 `(1 - 予測ST) + 強さpt/50 - 1.6` も ST と同じ秒の次元なので、0.135 秒 = 1 艇身がそのまま使える）。輪郭パスは**進行方向ごとに 2 種**あり、右へ進む図（スタート予想図・スタート結果図）は `boatHullPath` / `boatCanopyX` / `clampBowX(In)`、左へ進む図（1マーク予想図）はその鏡像の `boatHullPathLeft` / `boatCanopyXLeft` / `clampBowXInLeft` を使う（内部は共通の `hullPath(bowX, cy, len, dir)` を `dir` = ±1 で呼び分けるだけなので形は完全に同一。クランプは船尾がはみ出す側を逆にする） |
| `StartPredictionDiagram.astro` | スタート予想図（進入コース順に並べた SVG）。PredictorCard 内に表示。座標系と艇の形は `lib/start-diagram.ts` 共有。**艇番は艇体ではなく左カラムのバッジに出す**（ST が遅い艇ほど船尾が水面左端をはみ出すため、艇体に乗せるとその艇の番号だけ読めなくなる。公式のスタート情報図も艇番は水面の外）。はみ出しは `clipPath` ではなく、艇を描いた後に地色の矩形（カーテン）を左右に被せて隠す（同一ページに複数インスタンスが並ぶので id 重複を避けるため）。スタートラインは艇に隠れないよう艇の後に描く。**予想者に依らず** AI 推定 ST 版 (`startPredictionEstimated`) を渡す（racer_st が無い日は全国平均ST の共通図 `startPrediction` にフォールバック）。図は表示専用で買い目・回収率に効かないため予想者ごとに出し分けず、予測区間（帯）を持つ AI 推定 ST 版に統一している。予想者ごとの `useEstimatedST` は 1マーク距離＝買い目の側だけに効く (0.00=実績なしは shared の `effectiveAvgST` により `NO_RECORD_ST_FALLBACK`=0.25 で遅め描画)。凡例は `start.usesEstimatedST` で「AI推定ST」/「全国平均ST」を出し分け。任意 prop `stNote` で ST 説明文を上書き可（既定は「スタートタイミングは選手の全国平均STです。」）。各艇の ST 値ラベルは上段に予想/平均ST、下段に `entry.exhibitionStartTiming`（stt 由来のスタート展示実測ST、`展xx.xx` 青字）を併記。実測が無い艇（stt 未取得 / 展示未計測=0→null）は下段を出さない。`entry.startTimingP25` / `startTimingP75` がある艇（AI 推定 ST 版のみ）は**艇体の下に細いバー**で舳先位置の予測区間を出し、凡例に「艇体下のバーは舳先位置の予測のブレ幅（25〜75パーセンタイル）」を追記する（艇が 1 艇身ぶんの長さを持つようになったので、背後に帯を敷くと艇に隠れて見えない）。帯は点推定 1 本ではスリット先頭コースを 7 割外すことへの対処（経緯は BoatraceCSV `docs/design/slit_sim_plan.md`） |
| `StartResultDiagram.astro` | スタート結果図（確定結果の進入コース順に並べた SVG）。`RaceResultSection` の「スタート（進入順）」で使う。座標系と艇の形は `lib/start-diagram.ts` 共有で、スタート予想と同じ目盛りで見比べられることがこの図の目的。実測値に合わせてレンジを可変にはしない（変えると予想図と比較できなくなる）。舳先は水面内にクランプするので、レンジ外の艇は端で止まる。正確な値は右の数値ラベルに必ず出し、クランプが起きた回だけ凡例に断りを追記する。フライングは艇を赤縁 (stroke 2.5) + ST ラベルを赤太字の `F.03` 表記（`SessionResultsTable` と同じ書き方で負号は出さない）。ST が 0（欠場・エンスト等で CSV 空欄）の艇は位置が決まらないので**水面には艇を出さない**（左の艇番バッジと右の `—` でその艇の存在は分かる） |
| `OneMarkPredictionDiagram.astro` | 1 マーク予想（AI 寄与度ベース）の可視化。`aiEvaluation` は各予想者ごとの評価を採用するため、成分構成 (`componentKeys`) が本命予想と異なる予想者では図も異なり得る。PredictorCard 内に表示。艇はスタート図と**同じ輪郭・同じ 1 艇身 = 0.135 の換算**で描く（`lib/start-diagram.ts` の `boatLengthPx` / `boatHullPathLeft` を自前の軸レンジ `DIST_MIN`=-0.10 / `DIST_MAX`=0.90 と水面幅で呼ぶ。横軸も ST と同じ秒の次元なので換算がそのまま通る）。ただし**この図は進行距離が大きいほど左**＝艇が左へ進むので、艇はスタート図の**鏡像（舳先が左向き）**で描く（`boatHullPathLeft` / `boatCanopyXLeft` / `clampBowXInLeft`）。舳先を値の位置に置く点、はみ出しを地色のカーテン矩形で隠す点、基準線を艇の後に描く点はスタート図と共通で、船尾が伸びる向きとクランプ側だけが逆（船尾は右へ伸び、距離が小さい艇ほど水面右端の外へ出る）。艇番は左の `N号艇` ラベルにあるので艇体には乗せない。**軸 span 1.0 はスタート図と同じ理屈**で、1 艇身が水面幅の 13.5% に収まり実データの進行距離が船尾までクランプされない値（span 0.5 だと 1 艇身が 27% を占め、進行距離 0.365 超＝上位艇ほど船尾が水面外に出ていた）。**下限は -0.10**（span は 1.0 のまま）で、1マーク基準線 (distance=0) を水面の右端ではなく右から 10% の位置に置く。下限 0 だと基準線が水面右端そのもので、進行距離が 0 付近／負の最下位艇はそこへクランプされて舳先しか見えなかった。レンジはスタート図 (`ST_MIN`=-0.10 / `ST_MAX`=0.90) とも揃う。下限を下回る艇は従来どおり右端にクランプされ、実値は右の数値ラベルに出る |
| `AiEvaluationChart.astro` | AI 総合評価（枠別 寄与pt を横棒で積み上げ。採用成分は `evaluation.componentKeys` で動的に決まる)。任意 prop `racerPtHref` / `motorPtHref` / `wakuPtHref` / `exhibitPtHref` / `weatherPtHref` を渡すと**凡例の「選手」「モーター」「枠番」「展示」「気象」がリンク**になり、それぞれ選手詳細ページ（選手pt の計算根拠）/ モーター詳細ページ（モーターpt の読み方）/ 枠番詳細ページ（枠番pt の読み方）/ 展示詳細ページ（展示pt の読み方）/ 気象詳細ページ（気象pt の読み方）へ飛ぶ。`motorPtHref` は `motor` と `motor4`（退役した v4_motor 系の同名成分）の両方に効くが、`wakuPtHref` は `waku` のみ（`course` はテーブルの軸が 場×レース番号×コース で枠番pt と違うため解説を共有しない）。`exhibitPtHref` / `weatherPtHref` は preview 由来成分なので**daily 評価では凡例自体が出ず**、リンクも現れない（その場合の導線は直前情報セクション見出し右の「展示ptの詳細 ▸」「気象ptの詳細 ▸」） |
| `MotorPtCard.astro` | モーター詳細ページの 1 モーターぶんのカード。モーターpt サマリー（`素点(再現不可) → モーターpt → 寄与` のフローと、寄与が強さptに占める割合）→ モーター成績（出走表の2連率/3連率と `motorStats` の期成績を 1 表に並べ、**どちらもモーターptの入力ではない**旨を添える）→ 今節の走り（`computeMotorSessionBreakdown` の参考値。着順チップの下に適用スコアを併記し、転落沈エは赤 + `-100`、F/L/失/妨/欠/不は灰 + `除外`）の順。今節ぶんは**モーターptには未算入**（当日を含む節が対象外）であることを、チップ下の注記と末尾の「再現できない理由」バナーで明示する。場別重み w は weights CSV を取り込んでいないため `寄与 ÷ モーターpt` で逆算して表示する |
| `WakuPtCard.astro` | 枠番詳細ページの 1 枠ぶんのカード。枠番pt サマリー（`コース強度(テーブル引き) → 枠番pt → 寄与` のフローと、寄与が強さptに占める割合。枠番と進入コースがずれている艇はヘッダ右に琥珀のバッジを出す）→ 枠番別過去10走（`waku10` の走を「進入コース / 着順」のチップ列で並べ、着順分布バー + 1着率・2連対率・3連対率・勝率・平均ST・ST順の表）の順。**枠番pt は選手個人を見ていない**こと・過去10走は**枠番pt の入力ではない参考値**であることを、サマリー下の注記と末尾の「再現できない理由」バナーで明示する。枠番と違うコースからの進入だった走は進入コースの数字を琥珀の太字にして数え、その本数も注記に出す。場別重み w は weights CSV を取り込んでいないため `寄与 ÷ 枠番pt` で逆算して表示する |
| `ExhibitPtCard.astro` | 展示詳細ページの 1 艇ぶんのカード。展示pt サマリー（`展示走行の評価(再現不可) → 展示pt → 寄与` のフローと、寄与が強さptに占める割合。展示タイム最速など順位が付く艇はヘッダ右に青のバッジ）→ この艇の直前情報（展示タイム + 6艇内順位 + 最速艇との差 / 展示ST / 体重 / チルト、およびオリジナル展示を別表）の順。**これらは展示ptの内訳ではない**ことを、サマリー下の注記と末尾の「再現できない理由」バナーで明示する。展示pt と展示タイムの順位がずれている艇には、どちらに寄っているかの注記を出す。daily 評価では中立値 50 / 寄与 0 である旨に文言を差し替える。場別重み w は weights CSV を取り込んでいないため `寄与 ÷ 展示pt` で逆算して表示する（daily では逆算値に意味が無いので出さない） |
| `WeatherPtCard.astro` | 気象詳細ページの 1 艇ぶんのカード。気象pt サマリー（`{進入コース}コースの有利pt変動(再現不可) → 気象pt → 寄与` のフローと、寄与が強さptに占める割合。ヘッダ右に進入コースのバッジを出し、枠番とずれた艇は琥珀色にする）→ **気象ptは選手ではなく進入コースに付く値**であることの注記（前付けで枠番とコースがずれた艇にはその旨を追記）→ 最上位艇との pt 差 の順。daily 評価では中立値 50 / 寄与 0 である旨に文言を差し替える。場別重み w は weights CSV を取り込んでいないため `寄与 ÷ 気象pt` で逆算して表示する（daily では出さない）。末尾の「再現できない理由」バナーで、係数ファイル `sui_params.csv` を取り込んでいないことを明示する |
| `RacerPtCard.astro` | 選手詳細ページの 1 選手ぶんのカード。基本情報（全国 / 当地 / モーター / ボートの勝率・連対率・平均ST）→ 選手pt サマリー（`素点 → 選手pt → 寄与` のフローと、寄与が強さptに占める割合）→ 素点の計算根拠（全国5節・当地5節を 1 節 = 1 行の表にし、**着順チップの下に適用スコアを併記**）の順。F/L/失/妨 は赤 + `0`、欠/転/落/沈/エ/不 は灰 + `除外` で区別する。全国・当地の両方に現れる節には**二重計上**バッジを出す（素点で 2 回数えられる BoatraceCSV 側の挙動をそのまま見せる）。素点が計算できない選手は琥珀色のバナーで「30 で補完される」旨を出す。場別重み w は weights CSV を取り込んでいないため `寄与 ÷ 選手pt` で逆算して表示する |
| `TrendLineChart.astro` | ゼロ JS のインライン SVG 折れ線。複数予想者を重ね描き。共通 x 軸 `labels` に対し各系列 `values` を同じ長さで揃え、`null` は点を描かない。値は割合を `%` 表記。任意 `refValue` で基準線 (回収率 100% = 1.0) を破線描画。`/stats/` の累積推移で利用 |
| `RacerTable.astro` | 出走表の**基本情報表**（枠 / 選手 + 級別・年齢・支部 / 平均ST / 全国勝率 / 当地勝率 / モーター3連対率）。**比較しやすさを最優先した `<table>`**で、比較したい 4 指標が枠をまたいで同じ列に落ちる（1 艇 = 1 カードのリストだと項目が縦に散って艇どうしを見比べられなかった）。今節成績は同じコンポーネントに載せず `SessionResultsTable` の別セクションに分ける。列を 6 本に絞ることで iPhone 幅 (375px) に横スクロールなしで収まる（`overflow-x-auto` は長い選手名のフォールバック）。**4 指標は 1 位を `bg-amber-200` + 太字、2 位を `bg-amber-100` で塗る**（背景色は `<td>` 側に付けてセル枠いっぱいを塗る。得点率早見・直前情報と同じ流儀）。順位は**重複を潰した値**の昇順/降順で取るので、1 位タイが 2 艇いれば両方が濃い橙になり 2 位は次の値になる。平均STのみ小さいほど上位で、0（未計測）は順位付けの対象外かつ `—` 表示。**支部が開催場と同じ（地元）の選手は支部名を緑の太字**にする（会場マスタの `prefecture` から `都/府/県` を落として `RaceRacer.branch` と突き合わせる。北海道は例外扱い）。選手名の右に F/L 本数・賞除バッジ、その下に 級別（A1=赤 / A2=橙 / B1=濃灰 / B2=灰）・年齢・支部。モーター列は値の下にモーター番号 (`#42`) を小さく添える。**2連対率・3連対率の細目（全国/当地の 2連・3連、ボート、`motorStats` の優勝/優出・平均ラップ、出身地）は載せない**（列を増やすと比較のための一覧性が落ちるため） |
| `SessionResultsTable.astro` | 出走表の**今節成績表**。`RaceRacer.sessionResults`（未出走スロット除外）を **1 艇 = 1 行 / 1 走 = 1 列**の `<table>` に並べ、同じ走が必ず同じ列に落ちるようにする（艇ごとに左詰めで折り返すと縦に比較できない）。列は全選手の出走済みスロットの**和集合**を 日次 → 走 の順に並べたもので、その走に出ていない艇のセルは `—`。ヘッダは 2 段（1 段目が `n日目` の `colspan` グループ、2 段目が `1走` / `2走`）。1 セルは縦 4 段で、上から R番号 → 進入コースバッジ (18px) → ST → 着順。ST だけ `text-[8px]` なのはフライング表記 `F.03` を 20px 幅に収めるため。7 日制（14 走）は iPhone 幅で収まらないので `overflow-x-auto` で横スクロールし、**左端の 枠 + 選手 列は `sticky left-0` で残す**。sticky 列の右影は `border-collapse` だと描画されないため、テーブルは `border-separate` + `border-spacing-0` にし、**行の区切り線は `tr` ではなく各セルの `border-b`** で引いている（`tr` の border は separate では出ない）。**着順には色を付けない**（F=赤字 / L=橙字 / その他特殊トークン=灰字のみ文字色で区別）。**バッジの背景色は対象レースでの枠番の艇番カラー**（`BOAT_COLORS`: 1=白 / 2=黒 / 3=赤 / 4=青 / 5=黄 / 6=緑、枠番不明=灰）、**バッジ内の数字は進入コース**。ST は先頭の 0 を省いた表記で、負値（フライング）は `F.02` のように出す。ツールチップ（`title`）に 日次・走・R・進入・枠・ST を残す |
| `RacePreviewSection.astro` | 直前情報セクション。`RacePrediction.preview`（tkz + sui + original_exhibition）から、上部に水面気象（天候ラベル・風速・波高・気温・水温・観測時刻）、その下に**展示とオリジナル展示を 1 つにまとめた表**を表示する。どちらも「艇番 × 計測値」で同じ形なので、2 表に分けると同じ艇の行を目で往復することになり艇番列も 2 回出ていた。行は両者の艇番の**和集合**（片方にしか無い艇も落とさない）。ヘッダは 2 段で、1 段目がグループ（`展示` / `オリジナル展示`）、2 段目が項目（`体重kg` / `調整` / `チルト` / `タイム`、およびオリジナル展示の `labels`）。**展示タイムは展示 4 項目の右端**に置き、同じ「小さいほど速いタイム」であるオリジナル展示の各項目と隣り合わせる。タイム系の列は**得点率早見表と同じくセル枠いっぱいを塗る背景色**で、列ごとに 1 番速い艇を濃い青 (`bg-blue-100`)、2 番目を薄い青 (`bg-blue-50`) にする（速さの色は従来から青）。順位は**重複を潰した値**の昇順で取るので、1 位タイが 2 艇いる場合は両方が濃い青になり 2 位は次に小さい値になる。列幅は `px-1` + 単位をヘッダ側へ逃がす形まで詰めてあり、計測項目 3 本（`一周` / `まわり足` / `直線`）の一般的な場なら 9 列が iPhone 幅 (375px) に横スクロールなしで収まる（min-content 295px < 311px。従来は展示テーブル単体でも `体重調整` を sm 未満で隠していた）。項目数の多い場は `overflow-x-auto` のスクロールにフォールバックする。凡例の主語は存在する列に応じて切り替える（展示のみ / オリジナル展示のみ / 両方）。天候コードは shared の `weatherCodeLabel()`（1晴/2曇/3雨/4雪/5霧）でラベル化し、気象詳細ページと共有する。`preview` が無い / 中身が空のレースでは詳細ページ側で非表示。セクション見出しの右に**展示詳細ページ**（同じ直前情報を展示pt と並べて出す）への「展示ptの詳細 ▸」と**気象詳細ページ**（同じ水面気象を気象pt と並べて出す）への「気象ptの詳細 ▸」リンクをレース詳細ページ側で添える |
| `RecentFormSection.astro` | 近況5節セクション。`RacePrediction.recentForm` から艇別に全国・当地の直近5節を表示。1 節 = 1 行で、グレード・場名・期間と着順を**同じ行**に並べる。着順は `tokenizeRankString` のトークンが必ず 1 文字なので `325 3 3142` のように**詰めて**出し、日区切りだけ 4px の空きを挟む。**着順に色は付けない**（F=赤字 / L=橙字 / その他特殊トークン=灰字のみ文字色で区別、優勝戦は赤枠。枠は `ring` = box-shadow なので詰め表示の字送りに影響しない）。このセクションの元データ（recent_national / recent_local）は各走の枠番・進入コースを持たないため、`SessionResultsTable` / `Waku10Section` のような枠番バッジは出せない。節は古→新（左→右）に並べ替えて表示。`recentForm` が無いレースでは詳細ページ側で非表示 |
| `TokutenHayamiSection.astro` | 得点率早見セクション。`RacePrediction.tokutenHayami` から、艇別の現在の得点率・節内順位と「このレースで k 着を取った場合の得点率」(1着〜6着) を表にする。順位がボーダー以内の艇は得点率・順位を橙字で強調し、着順別セルは上流の状態コード (bit1=ボーダー得点率以上 / bit2=次レース次第 / bit4=当レース終了時点でボーダー以上) で背景を出し分ける。**背景色は `<td>` に付けてセル枠いっぱいを塗る**（内側 span に付けると文字幅ぶんしか塗られない）。iPhone 幅 (375px) で 10 列すべてが横スクロールなしに収まるよう、フォント (表 `text-[11px]` / 選手名・着順別セル `text-[10px]`) とセル padding (`px-0.5`) を絞り、艇番バッジも `w-4` にしている（min-content 285px < 利用可能幅 311px）。`overflow-x-auto` は極端に長い選手名のときのフォールバックとして残す。**選手名の横には級別も「本日 nR も出走」も出さない**（`TokutenHayamiRacer.classGrade` / `otherRaceNumber` は型には残るが未使用）。凡例にこのレースの着順点 (予選 10/8/6/4/2/1) とボーダー順位を添える。`tokutenHayami` が無いレースでは詳細ページ側で非表示 |
| `Waku10Section.astro` | 枠番別過去10走セクション。`RacePrediction.waku10` の 6 枠を**単一の CSS グリッド** (`grid-cols-[auto_auto_auto_auto_1fr]`) に並べ、過去10走（左が前走 = 新しい順）を左に、当該枠番での勝率・平均ST・ST順（平均スタート順）を右に置く。集計値は**枠をまたいで同じ列**に落ちるので上下に比較でき、ラベルは先頭のヘッダ行に 1 度だけ出す（列幅はグリッドの auto 任せ。手で幅を決めるとラベルか値がはみ出す）。余りは末尾の spacer 列 (`1fr`) に寄せ、広い画面でも集計値がバッジのすぐ右に留まるようにする。列間は `gap` ではなく各セルの `pl-2` / `pl-3` で空ける（`gap` だと行の区切り線が途切れる）。カードの枠線・角丸・余白は持たせず、行間は `py-0.5` + 1px の `border-t` だけ（1 行 39px。枠ごとにカード化していた頃の 50px + 6px マージンから約 24% 圧縮）。**艇番バッジと選手名は出さない**（出走表・近況5節と重複するうえ、iPhone 幅で 10 走 + 集計値を 1 行に収める余地を食うため）。どの艇かは行順（枠番昇順）とバッジの背景色（= 枠番の艇色）で判別する。**左端に行ラベル列**（上から `進` / `着`）を置き、1 走ぶんを縦 2 段（上=進入コースバッジ 16px、下=着順）で並べる。`SessionResultsTable` と同じ規則で、**着順には色を付けず**（F=赤字 / L=橙字 / その他特殊トークン=灰字のみ文字色で区別）、**バッジの背景色は枠番**（このセクションでは当該艇の枠番で固定）・**バッジ内の数字は進入コース**とする。**グレードは文字では出さず、IP 以外（G3 / G2 / G1 / SG）をバッジの太い紫枠 (`2px solid #7e22ce`) で表す**（グレード名はバッジの `title` に残る）。進入が枠なり（CSV 空欄）の走は枠番で補完した値なので**数字だけ**薄くする（バッジ全体を薄くすると枠番の色とグレードの紫枠まで鈍るため）。`waku10` が無いレースでは詳細ページ側で非表示 |
| `PredictorCard.astro` | 1 予想者ぶんの予想カード。表示名・買い目 (BettingPicks) ・回収率 (BetPayoutSummary)・AI 評価チャートを 1 セクションに集約。レース詳細ページは `prediction.predictions[]` をループしてこれを縦並びレンダリングする。任意 prop `startPrediction` / `oneMarkAiEvaluation` が両方渡されたときスタート予想・1マーク予想の 2 図をカード内に**縦積み**（各図がカード幅いっぱい）で表示する。2 カラムに並べると iPhone 幅で図がカード幅の半分まで縮み、艇バッジと ST 数字が読めなくなるため。図の SVG は `viewBox` + `w-full h-auto` なので幅なりに拡大される。レース詳細ページは予想者カードを `PredictorSpec` 駆動で描画し、**`showsAiPanelsFor(predictorId)` が true の予想者にだけ**「AI 評価の内訳」(`showChart`) と 2 図を渡す（false は買い目が CSV 由来の `v9_suji`＝スジ予想 / `v10_kimarite`＝穴予想。これらのカードは買い目と回収率だけになる。現行 active で 3 パネルが出るのは本命予想 `v1_basic` のカードだけ）。`racerPtHref` / `motorPtHref` / `wakuPtHref` / `exhibitPtHref` は `AiEvaluationChart` へ転送し、AI 評価内訳の凡例をそれぞれの詳細ページへのリンクにする。`startNote` prop は `StartPredictionDiagram` の `stNote` へ転送。任意 prop `recipeNote` を渡すとカード見出し直下に本命予想からの recipe 差分注記を表示する（現行 active な予想者には注記を用意していないため、過去日の退役予想者カードでのみ表示される）。スタート予想は全予想者共通で AI 推定 ST（帯つき）、1マークは予想者ごとの AI 評価を渡す（recipe が本命予想と異なる予想者では図も異なり得る） |
| `BettingPicks.astro` | 当日買い目・直前買い目の三連単フォーメーションと的中可否 (PredictorCard 内部で利用)。`predictorName` prop が渡されると見出しに「{予想者名}当日買い目」「{予想者名}直前買い目」として予想者名をプレフィクスする。`predictorId` prop で買い目しきい値（`bettingToleranceFor`。距離基準はオーバーライド無しで ±0.10、`strengthOnlyBetting` な予想者は ±5.0pt）と走行距離の予測 ST 種別（`oneMarkDistanceOptionsFor`。`useEstimatedST` な予想者は AI 推定 ST、他は全国平均 ST）と買い目候補の選定基準（`bettingBasisFor`。`strengthOnlyBetting` な予想者のみ走行距離ではなく強さpt）を予想者ごとに切替（`useEstimatedST` / `strengthOnlyBetting` を持つ予想者は現行 active には無く、過去日の退役予想者カードでのみ効く）。どちらもバッチの買い目生成（`prediction-builder.ts`）と同じヘルパーで解決するため、表示される買い目と的中・回収率の集計対象になる買い目が一致する。説明文のしきい値表記・予測 ST 種別も実値に追従する。`bettingStyleFor` が `"formation"` 以外を返す場合は説明文を差し替える（`"suji"`＝スジ予想は「1コース以外で強さptが最大の艇を1着に固定し、スジ表 P(2着, 3着 | 1着) の上位 5 ペアを組み合わせた 5 点」、`"kimarite"`＝穴予想は「決まり手 × 1着コースの確率表から組み立てた上位 5 点」。1 マーク走行距離を使わない予想者にフォーメーションの説明を出さないため） |
| `BetPayoutSummary.astro` | 「もし買ったら」セクション。レース 1 件分の 3連単 フォーメーション × 1点¥100 の払戻 / 回収率を当日・直前別に表示 (PredictorCard 内部で利用)。`predictorName` prop で見出しに予想者名プレフィクス対応。`actualSanrentan` が null（= 3連単 払戻未取得）のレースは「確定前」バッジを出し、払戻・回収率は `—` 表示にして外れと区別する |
| `DailyBetSummary.astro` | トップページの当日サマリー。締切済み全レースを集計した 3連単 戦略の的中率・回収率を予想者別（直前買い目のみ）に表示（本命直前 / スジ直前 / 穴直前 の 3 カード。`activePredictors()` を slot 昇順でループするため active 予想者の増減に自動追従。新スキーマ `prediction.predictions[]` を優先し、無い場合のみ primary 予想者を legacy `prediction.betPayout.realtime` でフォールバック） |
| `StadiumSeriesSummary.astro` | レース詳細ページの 1R-12R リンクバー直下に表示する今節成績。`_meta/series-summary.json` から当該会場の「節初日〜当日」3連単 戦略（直前買い目）の的中率・回収率・期間を表示 |
| `RaceResultSection.astro` | レース結果（着順・スタート・決まり手・天候）。「スタート（進入順）」は表ではなく `StartResultDiagram` の図で出す（コース / 艇 / ST / F は図に全部載る）。`predictions` prop（`PredictorPrediction[]`）が渡されると、**直前買い目**が的中した予想者ぶんの的中バッジ「{予想者短縮名}直前買い目 的中」を slot 昇順で表示（本命 🎯 / スジ 🧩 / 穴 💎。アイコン・配色は `getPredictorBadge()` 経由でレジストリから引く）。当日買い目の的中は `PredictorCard` 内の `BetPayoutSummary` 側にのみ出す |
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
