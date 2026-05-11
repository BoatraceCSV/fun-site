# 直前情報リアルタイム反映アーキテクチャ提案

## 0. サマリー

`boatracecsv.github.io` の `preview-realtime` Cloud Run Job が JST 08:00〜22:59 の 5 分間隔で `previews/stt` / `index (state=realtime)` を更新するようになったため、fun-site も同じ粒度で当日ページを更新する。本書では同一 GCP project (`boatrace-487212`) 内で完結する 5 分以内ラグの再デプロイ構成を提案する。

**推奨案**: Pub/Sub を介した「preview-realtime 完了 → fun-site 再ビルド」のイベント駆動チェーン。データソースは GitHub Pages を経由せず GCS を一次ソースとし、CDN ラグと git 経路のレイテンシを排除する。Astro SSG モデルは維持し、毎回フルリビルドする。**朝バッチ (JST 09:00) は廃止し、当日 08:00 の preview-realtime 初回発火を起点に fun-site の初回ビルドを行う。** Pub/Sub message には変更があったレース単位の `updatedRaces` を載せ、fun-site 側で差分判定と早期 return に活用する。

**スコープ外**: K-file 由来の翌日確定 results CSV (`data/results/daily/...`) を用いる的中実績ページ (`/stats`) は本提案の対象外。
ただし 2026-05 以降、preview-realtime が当日確定直後に bc_rs1_2 をパースして書き出す realtime 結果 CSV (`data/results/realtime/YYYY/MM/DD.csv`) は対象に含める。レース詳細ページの「レース結果」セクション表示にのみ使用し、`/stats` 復活は別途設計とする。

---

## 1. 現状アーキテクチャ

### 1.1 boatracecsv.github.io / preview-realtime 側

| 要素 | 値 |
| --- | --- |
| GCP Project | `boatrace-487212` |
| Region | `asia-northeast1` |
| 起動 | Cloud Scheduler 1 本 (`preview-realtime-daytime`、cron `*/5 8-22 * * *` Asia/Tokyo)、JST 08:00〜22:59 を 5 分間隔 |
| 実体 | Cloud Run Job `preview-realtime` (Python 3.11) |
| 動作 | `git clone --depth 1 --sparse` → `python scripts/preview-realtime.py` → `git commit && git push origin main` |
| アウトプット | GitHub repo `BoatraceCSV/boatracecsv.github.io` の `data/previews/{stt,tkz,sui,...}/...csv` と `data/estimate/index/...csv` (state=realtime 行) を上書き |
| 公開 | GitHub Pages 経由で `https://boatracecsv.github.io/data/...` に配信 |

### 1.2 fun-site 側

| 要素 | 値 |
| --- | --- |
| GCP Project | `boatrace-487212` (同一) |
| Region | `us-central1`（design.md / infra-proposal.md ベース。Vertex AI 不採用となった現在は asia-northeast1 へ統一可能） |
| 起動 | Cloud Scheduler 1 本、JST 09:00 1 回/日 |
| 実体 | Cloud Run Job `fun-site-batch` (Node.js 22, Astro SSG) |
| 入力 | `https://boatracecsv.github.io/data/{title,race_cards,stt,index,results}/YYYY/MM/DD.csv` (HTTPS fetch) |
| 出力 | `gs://fun-site-web-boatrace-487212/` へ全 HTML をアップロード（`@google-cloud/storage` SDK で rsync 相当） |

### 1.3 データの流れ（現状）

```
preview-realtime Job
   │ git push
   ▼
GitHub repo (main) ──▶ GitHub Pages (Jekyll build) ──▶ Fastly CDN
                                                          │
                                                          │ HTTPS GET
                                                          ▼
                                                   fun-site Job (1日1回)
```

---

## 2. 設計上の課題

### 2.1 GitHub Pages 経由の遅延

`preview-realtime` の `git push` から GitHub Pages 上で参照可能になるまでに次のラグが乗る。

| 区間 | 遅延 |
| --- | --- |
| `git push` 完了 → GitHub Pages Jekyll build | 30〜90 秒 |
| GitHub Pages → Fastly CDN purge / propagation | 10〜60 秒 |
| Fastly CDN キャッシュ TTL | 最大 600 秒（`Cache-Control: max-age=600`） |

5 分間隔の更新サイクルに対して **CDN TTL だけで最大 10 分の古さ** を許容することになり、同期点として GitHub Pages を通すのは不適格。

### 2.2 5 分毎フルリビルドのコスト

- 全 24 場 × 12R = 最大 288 ページ + 会場別/トップ/アーカイブで合計 ~330 ページ規模
- Astro SSG の素のビルドで 15〜30 秒、`pnpm install` 込みなら 60〜120 秒
- 1 日あたり最大 180 回 (08:00〜22:59 を 5 分毎) × 平均 90 秒 ≒ 4.5 時間/日 の Cloud Run Job 実行

→ ビルドコストは vCPU 秒換算で月 ~470 vCPU 時間。Cloud Run Jobs 無料枠 (180,000 vCPU 秒/月 ≒ 50 vCPU 時間) を超えるため、軽量化と無駄ビルド抑制が必要。

### 2.3 同期境界

preview-realtime と fun-site は別 Job だが、fun-site が古いデータを掴むことを避ける必要がある。Cloud Scheduler を時間ずらしで並走させる方式は competition 状態でレース条件を生む。

### 2.4 リージョン跨ぎ

fun-site が `us-central1` に残っているとデータソース (asia-northeast1 GCS / GitHub) との往復で 100ms+ × 数十リクエスト分のレイテンシが乗る。Vertex AI を使わない現状では us-central1 に置く理由がない。

---

## 3. 推奨アーキテクチャ

### 3.1 全体図

```
                 ┌────────────────── GCP boatrace-487212 (asia-northeast1) ───────────────────┐
                 │                                                                              │
   Cloud Scheduler                                                                              │
   (JST 08:00-22:59, */5)                                                                       │
        │                                                                                       │
        ▼                                                                                       │
   ┌──────────────────────┐    [改修1] CSV を二重書き込み                                       │
   │ Cloud Run Job        │ ──────────────────────────────────────────▶  ┌────────────────┐    │
   │ preview-realtime     │                                              │ Cloud Storage  │    │
   │ (Python)             │ ──[既存] git push (GitHub Pages 公開維持)    │ gs://boatrace- │    │
   │                      │                                              │  realtime-data │    │
   │  ★改修2: Pub/Sub     │                                              │  /data/...     │    │
   │  publish 完了通知    │ ──────┐                                       └────────────────┘    │
   └──────────────────────┘       │                                              ▲              │
                                  ▼                                              │              │
                         ┌──────────────────────┐                                │              │
                         │ Pub/Sub topic        │                                │              │
                         │ realtime-completed   │                                │              │
                         └──────────┬───────────┘                                │              │
                                    │ Eventarc                                   │              │
                                    ▼                                            │ GCS read     │
                         ┌──────────────────────┐                                │ (同一 region) │
                         │ Cloud Run Job        │ ───────────────────────────────┘              │
                         │ fun-site-batch       │                                                │
                         │  1. GCS から CSV 取得 │                                                │
                         │  2. RacePrediction   │                                                │
                         │  3. astro build      │                                                │
                         │  4. gsutil rsync     │ ──────────────▶ ┌────────────────────┐         │
                         └──────────────────────┘                 │ gs://fun-site-web- │         │
                                                                  │  boatrace-487212   │         │
                                                                  └─────────┬──────────┘         │
                                                                            │ Cloud CDN          │
                                                                            ▼                    │
                 │                                                       end user                │
                 └──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 主要設計判断

#### (1) データソースを GCS に切り替える（GitHub Pages を一次にしない）

`preview-realtime` の最後で `git push` に加えて **同じ CSV を `gs://boatrace-realtime-data/data/...` にも書き込む**。fun-site はこの GCS バケットから読む。

朝バッチを廃止する代わりに、`preview-realtime` は **realtime 系 CSV (`previews/stt`, `index (state=realtime)` など) に加えて、当日朝に必要な `programs/title`, `programs/race_cards`, `index (state=daily)` も毎回 GCS にミラー upload する。** これらはローカル sparse-checkout 内に既に存在するため、追加の HTTPS fetch は不要。08:00 の初回発火で当日の全 CSV が GCS に揃い、fun-site の初回ビルドが走る。

| 比較項目 | GitHub Pages 経由 | GCS 直読み |
| --- | --- | --- |
| 書込→読取ラグ | 30 秒〜10 分 | 1 秒以内（同一 project / region） |
| 認証 | 不要（公開） | サービスアカウント経由（IAM 制御可） |
| 読取コスト | 0 | $0 (同一 region 内 egress 無料) |
| 信頼性 | GitHub の SLA に依存 | Cloud Storage SLA 99.95% |
| 既存パブリック CSV データセットの維持 | 維持 | 維持（git push は残す） |

**git push を残す意義**: 公開データセットとして boatracecsv.github.io を提供している契約を壊さない。GCS は fun-site の内部経路としてのみ使う。

#### (2) トリガー: Pub/Sub による疎結合チェーン

`preview-realtime` が一連の処理 (CSV 生成 → git push → GCS upload) を完了した瞬間に Pub/Sub トピック `realtime-completed` へメッセージを publish する。fun-site 側は Eventarc でこの topic を購読し、Cloud Run Job を起動する。

メッセージ payload 例:

```json
{
  "publishedAt": "2026-05-06T13:35:12+09:00",
  "raceDate": "2026-05-06",
  "trigger": "realtime",
  "updatedRaces": [
    {
      "raceCode": "202605061204",
      "stadiumId": "12",
      "raceNumber": 4,
      "csvTypes": ["stt", "index"],
      "indexState": "realtime"
    }
  ],
  "gcsPrefix": "gs://boatrace-realtime-data/data/2026/05/06/"
}
```

**`updatedRaces` の粒度**: 「当日変更があったレース 1 件 = 配列 1 要素」。preview-realtime の処理ループ内で、ある レースコードについて 1 つでも CSV が新規追加 / 上書きされたらそのレースをエントリ化する。`csvTypes` には変更があった CSV 種別を列挙し、`indexState` で `daily` か `realtime` かを示す。

**朝の初回発火**: 08:00 の最初のサイクルでは `programs/title`, `programs/race_cards`, `index (state=daily)` が全レース分初出となるため、当日開催の全レースが `updatedRaces` に列挙される。fun-site は当日初回ビルドとして全 ~330 ページを生成する。

**メリット**:
- preview-realtime が遅延しても fun-site は古いデータを参照しない（必ず完了後に走る）
- Cloud Scheduler を fun-site 側に追加する必要がない（運用設定 1 つ削減）
- 朝バッチを別建てしなくても、08:00 の初回発火で当日初回ビルドが自動的に走る
- `updatedRaces` 配列が空（= 全レース締切後の空回り）ならビルドをスキップ可能
- 将来「変更があったレース単位での差分ビルド」へ拡張する余地がメッセージ仕様に内包されている

**注**: Eventarc から Cloud Run Jobs の直接トリガーは GA 済み（2024 以降）。代替として Cloud Functions Gen2 から `run.jobs.run` API を叩く構成も同等に動く。

#### (3) 無駄ビルドの抑制

5 分毎に走る前提でも、変更がないなら再ビルドしない。具体的には以下の早期 return を fun-site Job の冒頭に置く。

1. Pub/Sub message の `updatedRaces` が空 → 終了
2. GCS 上の対象 CSV の `etag`/`generation` を前回ビルド時の値と比較し、いずれも未更新 → 終了（Job 内で `gs://fun-site-web-boatrace-487212/_meta/last-build.json` に保存）
3. 当日 (`raceDate`) のレースが既に全 confirmed → 終了

これで深夜帯（preview-realtime が空回りで終わる時間帯）や開催レースが少ない曜日のビルドが大幅に削減される。

**注**: 当面は「`updatedRaces` が 1 件でもあれば全 ~330 ページをフルリビルド」という素直な実装で十分。将来ビルドコストが課題になった時点で `updatedRaces` を活かして「変更があったレース詳細ページ + 関連する会場別ページ + トップ」のみ再生成する差分ビルドへ移行できるよう、メッセージ仕様だけは先行して整える。

#### (4) ビルド & デプロイ高速化

| 項目 | 対策 | 短縮効果（目安） |
| --- | --- | --- |
| `pnpm install` | Docker イメージに `node_modules` を焼き込む（`pnpm fetch` + `pnpm install --offline`） | 60s → 5s |
| Astro ビルド | `astro.config.ts` で `build.format: "directory"` 維持、`vite.build.minify: "esbuild"` (デフォルト) | 30s → 20s |
| 静的アセット差分アップロード | 既存 `deploy.ts` の rsync ロジックを `crc32c` ベースの差分判定に拡張（一致するファイルは upload スキップ） | 全 330 ファイル upload 30s → 差分のみ 5s |
| HTML 圧縮 | Cloud Storage の `Content-Encoding: gzip` 事前圧縮配布 | 帯域削減（運用コスト寄与） |

→ ビルド & デプロイ合計を 90s → ~30s 程度まで短縮可能。Cloud Run Job のタイムアウトを 5 分に保てば次サイクルへ十分間に合う。

#### (5) リージョン統一

fun-site の Cloud Run Job、デプロイ先 GCS バケット、Cloud Build のすべてを `asia-northeast1` に集約する。

| サービス | 現状 | 移行後 |
| --- | --- | --- |
| fun-site Cloud Run Job | us-central1 | asia-northeast1 |
| `fun-site-web-boatrace-487212` バケット | (要確認) | asia-northeast1 |
| `boatrace-realtime-data` バケット | 新規 | asia-northeast1 |
| Artifact Registry | (要確認) | asia-northeast1 |
| preview-realtime | asia-northeast1 | 変更なし |

**メリット**: GCS 読取/書込が同一 region 内 egress 0 円、レイテンシが 100ms+ → 1〜5ms。Vertex AI を使わない現状で us-central1 に置く理由は消えている。

---

## 4. 比較検討した代替案

### 4.1 案 A: Cloud Scheduler 並走（fun-site 側にも独立スケジューラ）

`preview-realtime` の cron を 1〜2 分ずらして fun-site にも `*/5` の Scheduler を追加する案。

- ✅ 実装が最小（preview-realtime に手を入れない）
- ❌ レース条件: preview-realtime が遅延した回は fun-site が古いデータでビルドする
- ❌ preview-realtime が空回り（更新対象なし）の回でも fun-site がフルビルドする → 無駄が大きい
- ❌ GitHub Pages CDN 経由なら CSV 反映ラグも乗る → 「5 分以内」を担保しづらい

→ 採用しない。

### 4.2 案 B: GCS Object Notification → Eventarc

`gs://boatrace-realtime-data/...` への object create イベントを Eventarc で拾い、fun-site Job を起動する。

- ✅ preview-realtime に Pub/Sub publish ロジックを追加せずに済む
- ❌ 1 回の preview-realtime 実行で複数 CSV が書かれる（stt, tkz, sui, index, original_exhibition...）。各 object create で発火するとデバウンスが必要で、Cloud Functions / Workflows を挟む実装が増える
- ❌ 「どのレースが更新されたか」のメタデータをメッセージに載せられない（object name から再構築するしかない）

→ 採用しない（複雑化が大きい）。Pub/Sub で 1 回の publish にまとめた方が綺麗。

### 4.3 案 C: ハイブリッド（静的シェル + クライアントサイド realtime fetch）

HTML は朝 1 回だけビルドし、進入コース・展示・強さpt 寄与の realtime 部分は JSON sidecar として Cloud Storage に置きクライアントサイドで fetch する。

- ✅ HTML フルビルドが 1 日 1 回で済む
- ✅ Lighthouse 性能を維持
- ❌ Astro のゼロ JS 設計を崩す（クライアント JS が必要）
- ❌ OGP 画像・SEO に realtime 値を反映できない
- ❌ ユーザー要件「Astro SSG モデル維持・毎回フルリビルド」と合わない

→ 今回は採用しない（要件外）。将来の Phase 3 でビルドコストが無視できなくなった時に再検討する余地はある。

### 4.4 案 D: Cloud Run Service への移行（SSR / API 化）

静的サイトを止めて Cloud Run Service で SSR or API 配信する。

- ✅ realtime 反映は実質ゼロ秒
- ❌ コスト構造が静的サイト + CDN より明確に高い
- ❌ Hackathon 審査で訴求してきた "完全サーバーレス静的配信" を捨てる
- ❌ 運用負荷増（コールドスタート、スケーリング設定、SLO 設計）

→ 採用しない（要件外）。

---

## 5. 移行ステップ

### Phase 1: 並行運用準備（1〜2 日）

1. `gs://boatrace-realtime-data` バケットを asia-northeast1 に作成
2. `preview-realtime` の `scripts/preview-realtime.py` を改修し、CSV 書き込み完了後に GCS にも upload する処理を追加
   - 対象 CSV: realtime 系 (`previews/stt`, `index (state=realtime)` 等) に加え、当日朝に必要な `programs/title`, `programs/race_cards`, `index (state=daily)` も含めて毎回 upload
   - Cloud Run Job の Runner SA に `roles/storage.objectAdmin` を付与（バケット限定の condition 推奨）
3. fun-site 側の `csv-client.ts` に GCS 経路の fetcher を追加
   - 環境変数 `CSV_SOURCE=gcs|http` で切替できるようにし、当面は `http` (GitHub Pages) のままで動作確認
4. fun-site から results CSV の取得処理と `/stats` ページ関連のビルド処理を削除（的中実績ページは対象外のため）

### Phase 2: トリガーチェーン構築（1 日）

1. Pub/Sub topic `realtime-completed` を作成
2. `preview-realtime` 末尾に Pub/Sub publish を追加（`updatedRaces` を含むメッセージ。粒度はレース単位）
3. fun-site Job 用に Eventarc trigger を作成し、Pub/Sub → Cloud Run Job のチェーンを設定
4. fun-site Job の冒頭に「Pub/Sub envelope パース → 早期 return 判定」を実装

### Phase 3: 切替 & 朝バッチ廃止（1 日）

1. fun-site の `CSV_SOURCE=gcs` に切替
2. **JST 09:00 の Cloud Scheduler を廃止**。当日初回ビルドは preview-realtime の 08:00 発火で自動的に走る
3. リージョンを asia-northeast1 に統一（`gcloud run jobs deploy --region=asia-northeast1` で再作成）
4. デプロイ先 GCS バケットも asia-northeast1 で再作成し、Cloud CDN backend を切替

### Phase 4: ビルド高速化（追加で 1〜2 日）

1. Dockerfile を `pnpm fetch` ベースに変更し `node_modules` 焼き込み（Job のコールドスタート 5〜10 秒に圧縮）
2. `deploy.ts` の差分アップロードを `crc32c` 比較ベースに拡張
3. ビルド前の `etag` チェックによる早期 return を実装

---

## 6. コスト見積もり（月額・JPY 換算）

前提: 営業日 30 日、08:00〜22:59 を 5 分毎 (180 回/日)、平均 30s ビルド + 5s deploy。

| サービス | 想定使用量 | 月額 |
| --- | --- | --- |
| fun-site Cloud Run Job | 180 回/日 × 30 日 × 35s × 2 vCPU × 1 GiB = ~10 vCPU 時間 + ~5 GiB-時間 | ~¥250 |
| preview-realtime Cloud Run Job (既存) | 既存 | 変更なし |
| Pub/Sub (publish + Eventarc) | ~5,400 メッセージ/月 | ~¥0 (10 GB/月まで無料) |
| Cloud Storage (`boatrace-realtime-data`) | ~50 MB × 180 回/日 × 30 日 = ~270 GB-月 (Standard) | ~¥600 |
| Cloud Storage (`fun-site-web-...`) | 既存 + アップロード回数増 (180 × 30 × 330 ファイル ≒ 180 万 op) | ~¥800 |
| Cloud Scheduler | 既存 1 本 (`preview-realtime-daytime`) | ~¥0 (3 ジョブ無料枠) |
| Cloud CDN | 既存 | 変更なし |
| **追加分合計** | | **~¥1,650/月** |

→ 差分アップロードと早期 return を入れると Cloud Storage operation 課金は半分以下に抑制可能。

---

## 7. リスクと対策

| リスク | 影響 | 対策 |
| --- | --- | --- |
| Pub/Sub publish が失敗 → fun-site が走らない | 当該回 (5 分間) のビルドが skip | Pub/Sub の at-least-once 配信 + Eventarc のリトライで通常は自動回復。最終手段として 5 分後の次サイクルで自然回復するため、欠落は最大 1 サイクル分（5 分）に限定される |
| 08:00 の preview-realtime 発火が遅延 → 当日初回ビルドが遅れる | 朝の表示が数分〜十数分遅れる | preview-realtime の `*/5 8-22 * * *` Scheduler が 5 分毎に走るため、最初の発火が失敗しても次の発火で自動回復。深夜帯の手動公開のための `workflow_dispatch` 経路も既存維持 |
| preview-realtime 実行が 5 分超過 → 重複起動 | fun-site も二重起動 | Cloud Run Job の `parallelism=1, max-retries=0` 維持 + `last-build.json` の `generation` チェックで二重ビルドを no-op 化 |
| GCS 書き込み失敗 → fun-site が古い CSV を取得 | 表示データが 1 回分古い | preview-realtime 内で GCS upload を git push より前に実行し、GCS 失敗時は exit 1 で Job を失敗させる（次回 Scheduler が再実行） |
| GCS と GitHub Pages の整合性ズレ | 公開 CSV と内部用 CSV の差異 | 両方とも同一バイト列を書く（Python 内で同じ buffer から書き込む） |
| Astro ビルドが 5 分間隔を超過 | 次サイクルがキューに溜まる | ビルド開始時点で「自身より新しい起動が既にある」場合は早期 exit、Eventarc の ordering を活用 |
| GitHub Pages 公開が遅れて外部利用者が困る | 影響度小 | git push は維持、公開データセットとしての契約は維持 |

---

## 8. 決定事項

オープン課題に対する判断は以下のとおり。

| # | 項目 | 決定 |
| --- | --- | --- |
| 1 | Pub/Sub `updatedRaces` の粒度 | **レース単位**。`{raceCode, stadiumId, raceNumber, csvTypes, indexState}` を要素として配列に列挙。将来の差分ビルド対応への拡張余地を確保する |
| 2 | 朝バッチ (JST 09:00 Scheduler) | **廃止**。preview-realtime の JST 08:00 初回発火で当日 `programs/title` / `race_cards` / `index (state=daily)` を含む全 CSV を GCS にミラーし、Pub/Sub チェーンで fun-site の初回ビルドを駆動する |
| 3 | OGP 画像の更新タイミング | **realtime 反映**。realtime ビルドの度に OGP も最新値で再生成する（現状 SVG インラインのため追加コストなし） |
| 4 | 的中実績ページ (`/stats`) | **対象外**。fun-site から results CSV 取得処理と関連ビルド処理を削除。将来再開する際は別経路で設計する |
| 5 | Cloud Run Job のコールドスタート | **Docker イメージ最適化で対応**。`pnpm fetch` ベースの Dockerfile で `node_modules` を焼き込み、起動を 5〜10 秒に抑制（Phase 4） |

---

## 9. 既存ドキュメントへの反映が必要な箇所

- `docs/infra-proposal.md` セクション 2: Cloud Scheduler を 1 本/日 → Pub/Sub チェーンに更新、JST 09:00 朝バッチの記述削除
- `docs/design.md` セクション 4 「バッチ処理フロー」: トリガー記述と「6.1 BoatraceCSV URL 構造」のデータソース記述、results CSV 関連の記述削除
- `docs/strategy.md` セクション 2.3 / 7.4 / 10「Phase 2 直前情報反映」: 本提案の採用に伴い Phase 2 を Phase 1 に前倒し、ページ構成表 (7.1) から `/stats` を削除
- `packages/web/src/pages/stats.astro` および関連コンポーネント: 対象外化に伴い削除
- `packages/batch/src/fetcher/` 内 results 関連スキーマ・取得処理: 削除
- `infra/` 以下の Terraform / cloudbuild.yaml: Pub/Sub topic, Eventarc trigger, region 変更を追記
