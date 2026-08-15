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
| `estimate/{predictor_id}` | 各 active 予想者の AI 総合評価 (componentKeys ぶんの寄与pt) |
| `results/realtime` | 当日確定直後のレース結果（着順・決まり手・ST） |

予想者 (predictor) は固有 ID を持ち、レジストリ [`packages/shared/src/predictors.ts`](../packages/shared/src/predictors.ts) で宣言する。現行 active は `v1_basic` = 本命予想、`v9_suji` = スジ予想、`v10_kimarite` = 穴予想 の 3 者(slot 順)。退役済みは `v2_tenkai` = モーター評価変更予想、`v3_tenkai` = 展開予想、`v4_motor` = モーター予想、`v5_slit` = スリット予想、`v6_course` = コース予想、`v7_aggregate` = 統合予想、`v8_aionly` = AI予想（エントリと過去データは保持、ID 再利用なし）。active 予想者は表示名のほかに的中アイコン `icon` と的中バッジ配色 `badgeTailwindClass` を持ち、レース詳細ページの的中表示 (1R-12R リンクバー / レース結果バッジ) はこのレジストリだけを情報源にする。boatracecsv 側のレジストリ ID と同期させること。

レース 1 件あたり `RacePrediction` JSON を 1 ファイル生成し、`packages/web/src/data/races/{YYYY-MM-DD}/{raceCode}.json` に配置する。`RacePrediction.predictions[]` に active 予想者ぶんの `PredictorPrediction` (AI 評価・買い目・回収率) が slot 昇順で並ぶ。Astro はこれを `getStaticPaths()` 内で読み込んで静的ページを生成する。

## ページ構成

| URL | 役割 |
|---|---|
| `/` | 当日トップ。開催中 24 場の次レースを一覧表示 |
| `/stadium/{stadiumId}/` | 会場別。当日 1〜12R |
| `/race/{date}/{stadiumId}/{raceNumber}/` | レース詳細（スタート予想・予想者ごとのカード・出走表・結果） |
| `/predictors/` | 予想者比較。active 予想者の通算回収率・月次推移・採用成分の一覧 |
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
- 2026-05: 単一予想者前提から **複数予想者並行運用** へ移行。boatracecsv 側で `data/estimate/{predictor_id}/` 配下に予想者別 CSV を出力し、fun-site 側はレジストリ ([`packages/shared/src/predictors.ts`](../packages/shared/src/predictors.ts)) の active 予想者を `RacePrediction.predictions[]` にまとめて UI でカード表示する構成へ。回収率の悪い予想者は退役 (`status: "retired"`) し、新規予想者は固有 ID で追加する (ID 再利用なし)。比較ページ `/predictors/` を追加。
- 2026-06: 第 2 予想者 `v2_tenkai` (B君予想) を投入。v1_basic の 5 成分に **展開優位pt (`tenkai`)** を加えた 6 成分構成。展開優位pt はスタート展示の進入コースと枠番デフォルトコースの長期勝率差を場別標準化したもので、preview 由来成分のため朝バッチ (`state=daily`) では 50 (中立) に固定される。
- 2026-06-13: 展開優位pt を加えた `v2_tenkai` (B君予想) が control である A君予想 (`v1_basic`) を回収率で下回ったため、展開予想を撤去。B君予想を A君予想と同一 recipe（5 成分 + 買い目しきい値 既定 ±0.10）に揃え、`startedAt` を当日へリセットして累計回収率を再計測。`v2_tenkai` は別の特徴量を探る実験スロットとして ID を据え置く。`BETTING_TOLERANCE_BY_PREDICTOR` の v2_tenkai 専用しきい値も削除。
- 2026-06-13: 次の実験として `v2_tenkai` (B君予想) の着順ベース `motor` を **`motor2rate`(公式モーター2連率)** に**置き換え**(A君予想の 5 成分のうち motor 指標だけを差し替えた 5 成分。成分数は control と同じ)。`motor2rate` は `race_cards` の `艇N_モーター2連対率` を場別偏差値化したもので、おかぺん評価(平和島の公開モーター評価)との順位相関検証(boatracecsv `notebooks/motor_pt_okapen_validation.ipynb`)で、着順ベースの `motor`(相関ほぼ 0)に対し公式 2連対率が ρ≈0.6 と有望だったことを受けた差し替え。preview 非依存で朝バッチでも取得可。control の A君予想と回収率で比較する。
- 2026-06-13: UI 表示名を変更。`v1_basic` を **本命予想**(旧 A君予想)、`v2_tenkai` を **モーター評価変更予想**(旧 B君予想)に改称。レース詳細ページのモーター評価変更予想カードには本命予想からの recipe 差分(motor を motor2rate に置き換えた旨)を説明する注記を `PredictorCard` の `recipeNote` prop で表示する。
- 2026-06-20: 第 3 予想者 `v3_tenkai`(**展開予想**)を独立スロット (slot=3) として投入。本命予想 (`v1_basic`) の 5 成分に **展開優位pt (`tenkai`)** を加えた 6 成分構成(モーター指標は control と同じ着順ベース `motor`。`tenkai` の有無だけが control との差分)。展開優位pt は 2026-05〜06-13 に `v2_tenkai` で試行した成分だが、独立スロットで累計回収率を計測するため新 ID で再投入した。`tenkai` は preview 由来成分のため朝バッチ (`state=daily`) では 50 (中立) に固定される。買い目しきい値は既定 ±0.10。レース詳細カードは `recipeNote` で本命予想からの差分(展開優位pt 追加)を表示し、スタート予想・1マーク予想図も slot=3 で表示する。
- 2026-07-19: `v2_tenkai` (モーター評価変更予想) / `v3_tenkai` (展開予想) をいずれも退役 (`status: "retired"`)。control (`v1_basic`) に対し有意な回収率差が得られなかったため。退役後もエントリと過去データ (`data/estimate/{id}/…`)・成分定義 (`tenkai` / `motor2rate`) は保持し、命名規則どおり ID は再利用しない。`activePredictors()` から除外されるため fetcher / build-state / 各集計の対象から自動的に外れる。boatracecsv 側 registry.py と同期。
- 2026-07-20: 第 4 予想者 `v4_motor`(**モーター予想**)を slot=4 で投入。本命予想 (`v1_basic`) の着順ベース `motor` を、エキスパート評価 4 場(平和島/唐津/大村/鳴門)との順位相関でチューニングしたモーター能力指数 **`motor4`** に差し替えた 5 成分構成(成分数は control と同じで motor 指標だけ差し替え)。`motor4` はスコア表 v4(凸カーブ)+ ペナルティ -50 + 直近 5 節で算出し、CSV 列名は `motor` と同じ「モーターpt」(ファイルは predictor_id ごとに分離)。preview 非依存で朝バッチでも取得可。買い目しきい値は既定 ±0.10。レース詳細カードは `recipeNote` で本命予想からの差分(motor4 差し替え)を表示し、スタート予想・1マーク予想図も slot=4 で表示する。トップページの 1R-12R リンクバーの副予想者 🔥 アイコンは slot=4 を参照する(過去日は退役済み slot=2 にフォールバック)。
- 2026-07-21: 第 5 予想者 `v5_slit`(**スリット予想**)を slot=5 で投入。本命予想 (`v1_basic`) と同一の 5 成分(index / 強さpt は同値)で、スタート予想図と 1 マーク走行距離計算の**予測 ST だけ**を全国平均 ST から AI 推定 ST(`estimate/racer_st`。実測 ST 履歴の EWMA + コース/F 補正)に差し替えた実験スロット。`PredictorSpec.useEstimatedST` を新設し、`computeOneMarkDistances` の opt-in 引数・`buildStartPrediction` の推定 ST 版(`startPredictionEstimated`)で分離する。ST 推定の改善単独の回収率効果を control と A/B 比較する(boatracecsv `docs/design/st_estimation.md`)。
- 2026-07-22: 第 6 予想者 `v6_course`(**コース予想**)を slot=6 で投入。本命予想 (`v1_basic`) の枠番pt (`waku`、場×季節×コース) を、場×レース番号×コース別の収縮済み1着率テーブルに基づくコースpt (`course`) に差し替えた 5 成分構成。`course` は `waku` 同様 daily でも値を持つ(preview 由来成分ではない)。テーブル定義の優劣だけを control と回収率で A/B 比較する(boatracecsv `docs/design/course_strength_v6.md`)。
- 2026-07-23: 第 7 予想者 `v7_aggregate`(**統合予想**)を slot=7 で投入。`v4_motor`(motor→`motor4`)・`v6_course`(waku→`course`)・`v5_slit`(予測 ST を AI 推定 ST に差し替え、`useEstimatedST`)の 3 仮説を全て適用した総合スロット。`componentKeys` は `course` と `motor4` を両取りした 5 成分で、予測 ST 差し替えは index には現れず `useEstimatedST: true` でのみ効く(boatracecsv `docs/design/aggregate_v7.md`)。あわせてレース詳細ページ (`race/[date]/[stadiumId]/[raceNumber].astro`) の予想者カード描画を、slot / ID のハードコード列挙から `predictorById()` の `PredictorSpec` 駆動へ一般化(スタート予想・1マーク予想の表示可否と `useEstimatedST` を spec から解決)。これに伴い、それまで描画分岐に未追加だった `v6_course` のスタート予想図・1マーク予想図・recipeNote も表示されるようになった。
- 2026-07-28: 第 8 予想者 `v8_aionly`(**AI予想**)を slot=8 で投入。`v7_aggregate` と同一の 5 成分(index / 強さpt は同値)で、買い目候補の選定だけを 1 マーク走行距離(予測 ST + 強さpt/50)基準の ±0.10 窓から **強さpt のみの ±5.0pt 窓**(等価スケール。距離式の ST 項を外した形)に差し替えた実験スロット。`PredictorSpec.strengthOnlyBetting` を新設し、`computeBettingPicks` の `basis` 引数(`bettingBasisFor(predictorId)` で解決)で分離する。予測 ST が買い目に与える影響単独の回収率効果を `v7_aggregate` と A/B 比較する。`useEstimatedST: true` はスタート予想図・1マーク予想図の表示にのみ効き、買い目には影響しない。
- 2026-08-09: `v6_course`(コース予想)/ `v7_aggregate`(統合予想)/ `v8_aionly`(AI予想)の 3 つを退役(`status: "retired"`)。control (`v1_basic`) と**同一レースで突き合わせたペア比較**(直前買い目・確定レースのみ)で回収率が有意に低かったため。`v6_course` -6.91pt(95%CI [-13.1, -0.5], p=0.0047, n=3002)/ `v7_aggregate` -7.76pt(95%CI [-13.9, -1.7], p=0.0040, n=2717)/ `v8_aionly` -10.62pt(95%CI [-18.5, -2.9], p=0.0001, n=1892)。いずれも Holm 補正後も 5% 有意で、差分上位 20 レースを除外しても差は不変。3 者に共通する差分は `waku` → `course` の差し替えで、`course` を持たない `v4_motor`(+0.30pt, p=0.884)/ `v5_slit`(-2.72pt, p=0.377)は control 同水準だったため `course` 成分が主因と判断した。的中率だけは 3 者とも control より高く(46.8〜48.9% vs 46.1〜46.6%)、堅い決着は当てるが安いオッズを厚く買って EV を落とす負け方に見える。退役後もエントリと過去データ・成分定義(`course`)・`useEstimatedST` / `strengthOnlyBetting` の実装は保持し、ID は再利用しない。現行 active は `v1_basic` / `v4_motor` / `v5_slit` の 3 つ。検定の詳細は boatracecsv 側 `docs/data/estimate.md` の「現行レジストリ」退役ノート参照。
- 2026-08-12: レース詳細ページの的中表示を「当日 / 直前」の 2 軸から **予想者軸**へ変更。レース結果の的中バッジは active 予想者の**直前買い目**が的中したぶんだけを slot 昇順で並べ(当日買い目の的中は予想者カード内の回収率サマリーにのみ残す)、1R-12R リンクバーの的中アイコンも同じ集合を描画する。従来はどちらも slot=1 と副予想者 (slot=4 → slot=2 フォールバック) の 2 者ハードコードで、`v4_motor` / `v5_slit` 退役後は副予想者ぶんが常に非表示になっていた。`PredictorSpec` に `icon` / `badgeTailwindClass` を新設し(本命 🎯 / スジ 🧩 / 穴 💎)、`getPredictorBadge()` 経由で解決することで予想者の増減に自動追従させる。
- 2026-08-15: 予想者カードの「AI 評価の内訳」「スタート予想」「1マーク予想」の 3 パネルを、予想者ごとに出し分けるようにした。`PredictorSpec.showsAiPanels`(未指定 = true)を新設し、レース詳細ページは `showsAiPanelsFor(predictorId)` で解決する。`false` は買い目が CSV 由来 (`bettingStyle` が `"formation"` 以外) の `v9_suji`(スジ予想)/ `v10_kimarite`(穴予想) — 1 マーク走行距離を使わないので出したままだと「この図から買い目が出ている」と誤読させ、かつ 3 者は index / 強さpt が同値なので本命予想 (`v1_basic`) のカードに出ているぶんと重複する。結果、現行 active で 3 パネルが出るのは本命予想のカードだけになる。あわせて `BettingPicks.astro` の説明文も `bettingStyleFor` が `"formation"` 以外を返す場合に差し替える(従来は 1 マーク走行距離基準のフォーメーション説明が出ていた)。`showsAiPanels` は**表示専用**で買い目・回収率・集計には一切影響しないため、boatracecsv 側 registry.py に対応フィールドは持たない。
