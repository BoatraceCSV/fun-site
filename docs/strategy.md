# ボートレースファンサイト 総合方針書

> **⚡ 2026-05 アーキテクチャ更新**:
> 直前情報のリアルタイム反映に伴い、JST 09:00 の朝バッチは廃止され、
> preview-realtime → Pub/Sub → Eventarc → fun-site batch のチェーンに移行した。
> 詳細は [`realtime-architecture-proposal.md`](./realtime-architecture-proposal.md) を参照。
> 本書中の「AM 9:00 JST 朝バッチ」「`data/index/...` パス」「`results` CSV 取得」
> 「`/stats` 的中実績ページ」等の記述は legacy 設計の名残であり、現状は新方針が優先する。
> 取得対象 CSV は `programs/title` / `programs/race_cards` / `previews/stt` /
> `estimate/index` の 4 種類のみ（results は対象外化済）。

## 1. プロジェクト概要

**プロジェクト名**: ボートレース展開予想ファンサイト (fun-site)

**コンセプト**: BoatraceCSV が公開する 4 種類の CSV (programs/title, programs/race_cards, previews/stt, estimate/index) を組み合わせ、スタート予想と AI 総合評価（強さpt）を当日全レース分の静的ページとして配信するファンサイト。preview-realtime の 5 分間隔バッチ (JST 08:30〜22:59) で更新された CSV を Pub/Sub 経由で受け取り、変更があり次第 fun-site の Cloud Run Job が当日全ページを再ビルドし、GCP 上で配信する。

> **本書の位置づけ**: 当初提案 (proposal) として Vertex AI Gemini を中心とした agentic AI パイプラインを記述していたが、現実装は Vertex AI を使わず、BoatraceCSV の `estimate/index` CSV が提供する強さpt をそのまま AI 総合評価として可視化するシンプルな構成に統合された。本書には旧構想と現状の双方を残すが、実態は [README.md](../README.md) と [realtime-architecture-proposal.md](./realtime-architecture-proposal.md) を参照。

**ターゲット**: ボートレースを楽しむファン（初中級者がメインターゲット）。テキストの買い目羅列ではなく、展開の流れを画像で直感的に理解できることが差別化ポイント。

**応募先**: 第4回 Agentic AI Hackathon with Google Cloud

---

## 2. システムアーキテクチャ

### 2.1 全体構成図

```
                      ┌──────────────────────────────────────────────────────────────┐
                      │                       GCP (us-central1)                       │
                      │                                                              │
  ┌────────────┐      │  ┌──────────────┐   ┌──────────────────────────────────────┐ │
  │ Cloud       │──────│─▶│ Cloud Run    │   │    Agentic AI Pipeline               │ │
  │ Scheduler   │      │  │ Jobs         │   │                                      │ │
  │ AM 9:00 JST │      │  │ (バッチ処理)  │──▶│  ┌────────────┐  ┌──────────────┐  │ │
  └────────────┘      │  └──────────────┘   │  │ 予想分析    │  │ 画像生成      │  │ │
                      │                      │  │ Agent      │─▶│ Agent        │  │ │
  ┌────────────┐      │  ┌──────────────┐   │  │ Gemini 3   │  │ Gemini 3     │  │ │
  │ BoatraceCSV│◀─────│──│ Data Fetcher │   │  │ Pro        │  │ Pro Image    │  │ │
  │ (GitHub    │      │  └──────────────┘   │  └────────────┘  └──────┬───────┘  │ │
  │  Pages)    │      │                      │                         │          │ │
  └────────────┘      │                      │                         ▼          │ │
                      │                      │                  ┌──────────────┐  │ │
                      │                      │                  │ 品質チェック   │  │ │
                      │                      │                  │ Agent        │  │ │
                      │                      │                  │ NG→リトライ   │  │ │
                      │                      │                  └──────┬───────┘  │ │
                      │                      └─────────────────────────┼──────────┘ │
                      │                                                │            │
                      │  ┌──────────────┐   ┌──────────────┐          │            │
                      │  │ Astro SSG    │◀──│ 予想データ    │◀─────────┘            │
                      │  │ ビルド        │   │ (JSON+画像)  │                        │
                      │  └──────┬───────┘   └──────────────┘                        │
                      │         │                                                    │
                      │         ▼                                                    │
                      │  ┌──────────────┐   ┌──────────────┐                        │
                      │  │ Cloud        │──▶│ Cloud CDN    │──▶ ユーザー             │
                      │  │ Storage      │   │              │   (ブラウザ)            │
                      │  └──────────────┘   └──────────────┘                        │
                      │                                                              │
                      │  ┌──────────────┐   ┌──────────────┐                        │
                      │  │ Cloud Build  │   │ Artifact     │                        │
                      │  │ (CI/CD)      │──▶│ Registry     │                        │
                      │  └──────────────┘   └──────────────┘                        │
                      └──────────────────────────────────────────────────────────────┘
```

### 2.2 データソース: BoatraceCSV

GitHub Pages で配信される CSV データを利用する。

**URL パターン**: `https://boatracecsv.github.io/data/{type}/YYYY/MM/DD.csv`

| CSV種別 | パス | 内容 | 取得タイミング |
|---|---|---|---|
| Programs (Title) | `data/programs/title/YYYY/MM/DD.csv` | レース名・グレード・締切時刻などのメタ情報 | 当日 GitHub Actions daily-sync で生成 → preview-realtime が 08:30 以降に GCS ミラー |
| Programs (Race Cards) | `data/programs/race_cards/YYYY/MM/DD.csv` | 出走表（選手・モーター・成績） | 同上 |
| Previews (STT) | `data/previews/stt/YYYY/MM/DD.csv` | 直前情報（進入コース・スタート展示） | preview-realtime が締切 5 分前から 5 分間隔で追記 |
| Index | `data/estimate/index/YYYY/MM/DD.csv` | 強さpt（5要素の寄与pt: 枠番/選手/モーター/展示/気象） | daily-sync で `state=daily` 生成 → preview-realtime が `state=realtime` に上書き |

> **注 1**: 旧 `prediction-preview` / `estimate` / `confirm` は BoatraceCSV 上流での生成停止に伴い廃止。
> **注 2**: `results` CSV は的中実績ページ廃止に伴い fun-site の取得対象から除外済（旧 strategy.md の 5 種類記述は legacy）。
> **注 3**: 旧 strategy.md に `data/index/...` と記載していたが実体は `data/estimate/index/...` であり、旧 fetcher は 404 で空配列に潰れていた既存バグ。本移行で修正済み。

**BoatraceCSV の `index` (強さpt) の特徴**:
- **強さpt**: 枠番 / 選手 / モーター / 展示 / 気象 の 5 要素ごとに寄与pt を算出し、合計を強さptとする AI 総合評価スコア
- **state**: `daily`（朝バッチ時点・展示と気象は暫定値）/ `realtime`（直前情報反映後）の 2 状態がある
- 着順予測 (LambdaRank + Random Forest) や決まり手予測 (LightGBM) を提供する旧 Estimates / Prediction Previews CSV は廃止されたため、本サイトでは強さpt のみを AI 総合評価として表示する

### 2.3 バッチ処理フロー

```
AM 9:00 (JST) Cloud Scheduler トリガー  (BoatraceCSV の daily-sync 完了後)
    │
    ▼
Step 1: データ取得 (BoatraceCSV)
    ├── programs/title CSV → レースメタ情報
    ├── programs/race_cards CSV → 当日出走表（選手・モーター・成績）
    ├── previews/stt CSV → 直前情報（進入コース・スタート展示）※未公開時はスキップ
    ├── index CSV → 強さpt（5要素の寄与pt）
    ├── 前日 results CSV → 前日レース結果
    └── csv-parse でパース
    │
    ▼
Step 2: RacePrediction 統合
    ├── レースコードをキーに 4 種類の当日 CSV を結合
    ├── stt があれば進入コースを反映、無ければ枠番をフォールバック
    ├── index の state=daily は展示・気象を 0 に揃える
    └── レース 1 件ごとに RacePrediction JSON を書き出し
    │
    ▼
Step 3: 静的サイト生成 (Astro SSG)
    ├── RacePrediction JSON を読み込んで全レースのページを生成
    ├── astro build → HTML/CSS/SVG 生成
    └── Cloud Storage へ gsutil rsync でデプロイ
```

> **注**: 旧 proposal では Vertex AI Gemini による展開分析・画像生成・品質チェックの 3 エージェント構成を想定していたが、Estimates / Prediction Previews CSV の廃止と方針変更により、現実装は BoatraceCSV の既存スコア (強さpt) を可視化する純粋な静的ダッシュボードに統合された。Gemini パイプラインの再導入は将来検討事項とする。

### 2.4 Agentic AI構成（ハッカソンの核心）

本プロジェクトの「Agentic AI」としてのアピールポイント:

1. **自律的判断**: 品質チェックAgentが画像の合否を自律判定し、リトライを決定するフィードバックループ
2. **マルチエージェント協調**: 分析→生成→検証の3エージェントがパイプラインで連携
3. **Tool Use**: 各AgentがVertex AI API、Cloud Storage API、BoatraceCSV等のツールを使用
4. **冗長性**: AI画像が品質不足の場合、SVGフォールバックで確実にコンテンツ提供

**Vertex AI Agent Builder は不採用**。理由: 対話型エージェント向けであり、バッチ処理には不適。Cloud Run Jobs + Vertex AI SDK での直接API呼び出しの方がシンプルで安価。

---

## 3. 技術スタック

| カテゴリ | 技術 | 選定理由 |
|---|---|---|
| ランタイム | Node.js 22 LTS | GCP Cloud Run 互換、エコシステム成熟 |
| パッケージマネージャ | pnpm | workspace対応モノレポ、厳格な依存管理 |
| 静的サイト | Astro 5.x | ゼロJSデフォルト、ビルド高速、コンテンツサイトに最適 |
| スタイリング | Tailwind CSS 4 | ユーティリティファースト、ビルドサイズ最小 |
| テスト | Vitest | TypeScriptネイティブ、高速 |
| Linter/Formatter | Biome | ESLint+Prettier統合代替、高速 |
| バリデーション | Zod | TypeScript型推論との統合 |
| データソース | BoatraceCSV | CSV形式、ML予測込み、GitHub Pages配信 |
| 予想分析 | Gemini 3 Pro | 高い推論能力、展開シナリオの深い分析 |
| 画像生成 | Gemini 3 Pro Image | Thinkingモード対応、ダイアグラム明示サポート、高品質 |
| フォールバック | Gemini 3 Pro → SVG生成 | 確実な配置図 |
| バッチ実行 | Cloud Run Jobs | 最大24h実行、Dockerコンテナ自由度 |
| スケジューリング | Cloud Scheduler | 無料枠3ジョブ |
| ホスティング | Cloud Storage + Cloud CDN | GCPネイティブ、低コスト |
| CI/CD | Cloud Build | GCPエコシステム、120分/日無料 |
| コンテナレジストリ | Artifact Registry | GCPネイティブ |

### Imagen を採用しない理由

Imagen 3/4 はフォトリアリスティック画像に特化しており、レース展開図（ダイアグラム）生成には不向き。テキスト描画精度が低く、空間配置の正確な制御ができない。Gemini 3 Pro Image はThinkingモードによる論理的配置とダイアグラム明示サポートがあり、展開図生成に最適。

### Astro を選定した理由（vs Next.js SSG）

- ゼロJSデフォルト: コンテンツ表示主体のサイトにReactランタイム不要
- ビルド速度: 1000ページ規模でNext.jsの約3倍高速
- ホスティング: 純粋な静的HTML出力のためCloud Storage直接配信可能

---

## 4. 画像生成アプローチ

### 4.1 ハイブリッド戦略

```
Phase 1: Gemini 3 Pro で展開予想テキスト生成
    ↓
Phase 2a: Gemini 3 Pro Image で展開図画像を生成（メイン）
Phase 2b: Gemini 3 Pro でSVGコードを生成（フォールバック）
    ↓
Phase 3: 品質チェックAgent (Gemini 3 Pro マルチモーダル)
    - 画像品質OK → 画像版を採用
    - 画像品質NG → SVGフォールバック採用
    ↓
Phase 4: HTMLページに画像 + SVG図 + テキスト解説の3点を配置
```

### 4.2 画像で表現する内容

**メイン: 1マーク展開図**（ボートレースの勝敗は1マーク旋回でほぼ決まる）

- 6艇の位置関係（スタート隊形 → 1マーク旋回）
- 各艇の色（1白, 2黒, 3赤, 4青, 5黄, 6緑）
- 予想決まり手の動線（矢印・軌跡）
- レースタイトル・信頼度

**決まり手パターン（6種）**: イン逃げ / 差し / まくり / まくり差し / 抜き / 恵まれ
**スリット隊形パターン（3種）**: 横一線 / 内凹み / 外凹み

### 4.3 日本語テキストの扱い

AI画像内の日本語テキスト描画は品質リスクがあるため、テキスト情報はHTML側で表示し、画像は図解（位置関係・動線・色分け）に専念する。

---

## 5. ディレクトリ構成

```
fun-site/
├── packages/
│   ├── batch/                  # バッチ処理パッケージ
│   │   ├── src/
│   │   │   ├── fetcher/        # BoatraceCSV データ取得・CSVパース
│   │   │   ├── predictor/      # 展開予想ロジック + Gemini 3 Pro 分析
│   │   │   ├── image-generator/ # Gemini 3 Pro Image + SVGフォールバック
│   │   │   ├── quality-checker/ # 品質チェックAgent
│   │   │   ├── site-builder/   # Astroビルド + デプロイ
│   │   │   ├── pipeline.ts     # パイプライン全体制御
│   │   │   └── main.ts         # エントリーポイント
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── web/                    # Astro 静的サイト
│   │   ├── src/
│   │   │   ├── components/     # RaceCard, StadiumList, PredictionImage 等
│   │   │   ├── layouts/        # BaseLayout
│   │   │   ├── pages/          # トップ, 場別, レース別, アーカイブ
│   │   │   ├── styles/         # Tailwind CSS
│   │   │   └── content/        # バッチが書き出すJSON + 画像
│   │   ├── astro.config.ts
│   │   └── package.json
│   └── shared/                 # 共有型定義・定数・ユーティリティ
│       ├── src/
│       │   ├── types/          # race.ts, prediction.ts, stadium.ts
│       │   ├── constants/      # stadiums.ts (24場), race-grades.ts
│       │   └── utils/          # date.ts, csv-parser.ts 等
│       └── package.json
├── biome.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── cloudbuild.yaml
└── README.md
```

---

## 6. データモデル

### 6.1 BoatraceCSV から取得するデータ

#### programs/title CSV（レースメタ情報）

基本カラム: レースコード, タイトル, 日次, レース日, レース場, レース回, レース名, 距離, 電話投票締切予定

#### programs/race_cards CSV（出走表）

基本カラム: レースコード, レース日, レース場コード, レース回

艇別カラム（x6）: 艇N_登録番号, 艇N_選手名, 艇N_年齢, 艇N_支部, 艇N_出身地, 艇N_級別, 艇N_全国平均ST, 艇N_全国勝率, 艇N_全国2連対率, 艇N_全国3連対率, 艇N_当地勝率, 艇N_当地2連対率, 艇N_当地3連対率, 艇N_モーター番号, 艇N_モーター2連対率, 艇N_モーター3連対率, 艇N_ボート番号, 艇N_ボート2連対率, 艇N_ボート3連対率

#### previews/stt CSV（直前情報）

基本カラム: レースコード, レース日, レース場, レース回, 締切時刻, 取得日時

艇別（x6）: 艇N_コース, 艇N_スタート展示

#### index CSV（強さpt 寄与）

基本カラム: レースコード, レース日, レース場コード, レース回, 状態（daily / realtime）

艇別（x6, "1枠_..." 形式）: 枠番pt, 寄与_枠番pt, 選手pt, 寄与_選手pt, モーターpt, 寄与_モーターpt, 展示pt, 寄与_展示pt, 気象pt, 寄与_気象pt, 強さpt

#### results CSV（レース結果）

基本カラム: レースコード, タイトル, 日次, レース日, レース場, レース回, レース名, 距離, 天候, 風向, 風速, 波の高さ, 決まり手
配当: 単勝, 複勝, 2連単, 2連複, 拡連複, 3連単, 3連複
着順別（1着〜6着）: 着順, 艇番, 登録番号, 選手名, モーター番号, ボート番号, 展示タイム, 進入コース, スタートタイミング, レースタイム

> **注**: 旧 Prediction Previews / Estimates / Confirmations CSV は廃止。MLによる着順・決まり手予測や的中判定機能を再導入するには、独自に推論パイプラインを構築するか、別データソースを開拓する必要がある。

### 6.2 レースコードによる結合

全CSVは `レースコード` をキーに結合可能。レースコードは会場・日付・レース番号を一意に識別する。

---

## 7. コンテンツ方針

### 7.1 ページ構成

| ページ | URL | 内容 |
|---|---|---|
| トップ | `/` | 当日の全場開催一覧 + 注目レースピックアップ |
| 場別 | `/stadium/{stadiumId}/` | 会場の全レース予想一覧 |
| レース別 | `/race/{date}/{stadiumId}/{raceNum}` | 展開予想画像 + 出走表 + 解説 |
| アーカイブ | `/archive/{date}` | 過去日付の予想と結果対比 |

> **注**: 旧 `/stats` 的中実績ページは 2026-05 移行で対象外化。results CSV 取得処理とともに削除済み。

### 7.2 1レースページの構成

```
┌─────────────────────────────────────┐
│ レースヘッダー                        │
│ [場名] [レースNo] [グレード] [時刻]     │
├─────────────────────────────────────┤
│ 展開予想画像 (AI生成 or SVG)           │
│ 決まり手: イン逃げ  信頼度: ★★★★☆    │
├─────────────────────────────────────┤
│ 出走表 (6艇の主要データ)               │
│ 艇番 | 選手名 | 級別 | 勝率 | ST | モーター │
├─────────────────────────────────────┤
│ AI 総合評価 (index 強さpt)             │
│ 枠ごとに 5 要素の寄与pt を横棒で可視化    │
├─────────────────────────────────────┤
│ SNS共有ボタン                         │
└─────────────────────────────────────┘
```

> **注**: 旧 proposal の「ML予測 (Estimates)」「AI展開解説テキスト (Gemini 3 Pro)」セクションは、CSV 廃止と Gemini 不採用に伴い削除済み。現実装は AI 総合評価セクションで `index` の強さpt 寄与を可視化する。

### 7.3 対象レースの段階的拡大

| フェーズ | 対象 | レース数/日 |
|---|---|---|
| Phase 1 (MVP) | 各場12R + SG/GIメイン | 最大24レース |
| Phase 2 | 各場10R〜12R + SG/GI全レース | 最大72レース |
| Phase 3 | 全場全レース | 最大288レース |

### 7.4 AM 9:00 JSTバッチの制約と対策

AM 9:00 JST時点では `previews/stt`（直前情報）はまだ多くのレースで未公開（実際には締切 5 分前にしか出ない）。

**データ利用戦略**:
- AM 9:00 JST: `programs/title` + `programs/race_cards` + `index` + 当日朝までに公開済みの `previews/stt` で予想ページ生成
- `previews/stt` 未取得レースは **進入コース = 枠番**、ST = 全国平均ST で仮表示
- `index` の `state=daily` レースは展示・気象の寄与pt が暫定値のため、当該セグメントは非表示
- 将来拡張: 当日中に `previews/stt` / `index` が `state=realtime` で更新された時点で差分更新バッチを走らせて精度向上

---

## 8. UX方針

### 8.1 設計原則

- **モバイルファースト**: ファンは通勤中や競艇場でスマホから閲覧
- **3タップルール**: トップページから目的のレースまで最大3タップで到達
- **高速表示**: 静的サイトの強みを活かし体感0.5秒以内のページ遷移
- **画像最適化**: WebP形式 + lazy loading、重い画像でもファーストビューはテキストで情報提供

### 8.2 SNS・バイラル戦略

- 各レースの展開予想画像をOGP画像に設定 → Xでシェア時にサムネイルで予想が見える
- 画像にサイト名・レース情報のウォーターマーク
- 的中時に「的中!」バッジ付き画像を自動生成し、共有を促進

### 8.3 ポジショニング

**「レースを楽しむための材料」としてのエンターテインメント**。ギャンブル予想サービスではなく、AIが描くレース展開図を楽しむファンサイト。免責事項は明記する。

| 観点 | 既存予想サイト | 本サイト |
|---|---|---|
| 予想形式 | テキスト (買い目の数字列) | AI画像で展開を可視化 |
| 料金 | 有料プラン多い / 広告過多 | 完全無料・広告控えめ |
| 速度 | 動的生成で重い | 静的サイトで高速 |
| 情報量 | 大量で迷う | 1レース1画像でシンプル |
| SNS映え | テキストでは映えない | OGP画像で映える |

---

## 9. GCPサービス構成とコスト

### 9.1 使用GCPサービス一覧

| カテゴリ | サービス | 用途 |
|---|---|---|
| AI/ML | Vertex AI (Gemini 3 Pro / Gemini 3 Pro Image) | テキスト分析・画像生成・品質チェック |
| コンピュート | Cloud Run Jobs | バッチ処理実行 |
| ストレージ | Cloud Storage | 静的サイトホスティング + データ保存 |
| ネットワーク | Cloud CDN + Load Balancer | グローバル配信 + SSL |
| ドメイン | Cloud Domains + Certificate Manager | ドメイン取得・SSL証明書管理 |
| スケジューリング | Cloud Scheduler | AM 9:00 JSTバッチトリガー |
| CI/CD | Cloud Build | 自動ビルド・デプロイ |
| コンテナ | Artifact Registry | Dockerイメージ管理 |
| セキュリティ | IAM + Service Account | 最小権限原則 |
| 監視 | Cloud Logging + Monitoring | 運用可視化 |

### 9.2 コスト概算

Gemini 3 Pro Image の画像生成コストは ~$0.134/枚。

| 構成 | Vertex AI 月額 | インフラ月額 | 合計 |
|---|---|---|---|
| 最小 (各場1R、~12レース/日) | ~$60 | ~$11 | **~$71** |
| 注目レースのみ (~36レース/日) | ~$180 | ~$20 | **~$200** |
| 全場全レース (~288レース/日) | ~$1,400 | ~$40 | **~$1,440** |

**ハッカソン期間のみ**: CDN/LBなしでCloud Storage直接公開URLを使用すればインフラコストを大幅削減。

**注**: Gemini 3 Pro は Gemini 2.5 Flash と比較してコストが高い。品質を優先した選定だが、コスト圧縮が必要な場合は対象レース数の絞り込みで調整する。

### 9.3 リージョン

全サービス **us-central1** 統一。Vertex AI Gemini対応リージョンかつ最安。Cloud CDNがキャッシュするため日本ユーザーへのレイテンシ影響は軽微。

---

## 10. 開発フェーズ

### Phase 1: MVP（現実装）

**ゴール**: 全 24 場 × 全 12 レース分のスタート予想と AI 総合評価を静的サイトで配信

- pnpmモノレポ + Astro + Tailwind CSS のプロジェクト初期構築
- BoatraceCSV データ取得（`programs/title` + `programs/race_cards` + `previews/stt` + `index` + 前日 `results`）+ Zodバリデーション
- レースコード結合による `RacePrediction` 統合ロジック
- スタート予想 SVG（俰瞰図）生成
- AI 総合評価（強さpt 寄与pt 横棒グラフ）SVG 生成
- Astro SSG でのページ生成
- Cloud Storage へのデプロイ
- Cloud Scheduler + Cloud Run Jobs でAM 9:00 JSTバッチ

### Phase 2: 直前情報反映（将来）

**ゴール**: `previews/stt` 後追い反映と Vertex AI 解説の検討

- `previews/stt` / `index` (`state=realtime`) を当日中に再取得して差分更新
- レース 1 件の OGP 画像生成（SVG → PNG）
- （検討）Vertex AI Gemini による日本語の展開解説テキスト追加

### Phase 3: 本格運用

**ゴール**: 全場全レース対応、直前更新バッチ

- 全場全レース対応（最大288レース/日）
- 直前情報反映バッチ（`previews/stt` / `index` (state=realtime) 公開後に差分更新）
- PWA対応（オフライン閲覧）
- 過去データ分析ダッシュボード

---

## 11. ハッカソン審査アピールポイント

### 11.1 Agentic AI としてのアピール

1. **マルチエージェント構成**: 予想分析Agent → 画像生成Agent → 品質チェックAgent の自律連携
2. **自律的フィードバックループ**: 品質チェックAgentが画像の合否を自律判定し、不合格ならリトライを指示
3. **Tool Use**: 各AgentがVertex AI API、Cloud Storage API、BoatraceCSV等のツールを自律的に使用
4. **冗長性設計**: AI画像 + SVGフォールバックの2系統で確実にコンテンツ提供

### 11.2 GCP活用の幅広さ

10のGCPサービスを適切に組み合わせた完全サーバーレス構成。Vertex AI Gemini 3 Pro / Gemini 3 Pro Image の画像生成能力を実用的なユースケースで活用。

### 11.3 実用性

実際のボートレースデータ（BoatraceCSV）に基づく日次更新サイト。BoatraceCSV が提供する `index` (強さpt) を AI 総合評価として可視化し、出走表とスタート予想を 1 ページにまとめた構成。

> **注**: 旧 proposal で記述していた ML予測 (Estimates) + LLM分析 (Gemini 3 Pro) の組み合わせは、CSV 廃止と方針変更により現実装には含まれない。

---

## 12. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| AI画像の品質が不安定 | ユーザー体験低下 | SVGフォールバック + 品質チェックAgent |
| 6艇の色表現が不正確 | 誤情報 | プロンプトで色を明示指定 + 品質チェック |
| 日本語テキストの画像内描画不良 | 可読性低下 | テキストはHTML側で表示、画像は図解のみ |
| AM 9:00 JST時点で直前情報 (`previews/stt`) なし | 進入コース・スタート展示が未取得 | 枠番をフォールバックとして仮表示し、後追いの差分更新バッチで補完 |
| Gemini 3 Pro Image のコスト | 月額高騰 | 対象レース数の絞り込みで調整 |
| BoatraceCSV の更新遅延 | データ未取得 | リトライ + 前日データでのフォールバック |
| API レート制限 | バッチ処理停止 | 指数バックオフリトライ + 並行度制限 |
| AI予想への過度な期待 | ユーザー不満 | エンターテインメントとしての位置づけ + 免責事項 |

---

## 13. 各エージェント提案の詳細参照先

| エージェント | ドキュメント |
|---|---|
| インフラエンジニア | `docs/infra-proposal.md` |
| ソフトウェアエンジニア | `docs/design.md` |
| AIエンジニア | `docs/vertex-ai-proposal.md` |
| ドメインスペシャリスト | `docs/domain_knowledge.md` |
