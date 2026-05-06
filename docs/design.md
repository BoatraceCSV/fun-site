# ボートレースファンサイト - アプリケーション設計

## 1. 推奨技術スタック

| カテゴリ | 技術 | 選定理由 |
|---|---|---|
| ランタイム | Node.js 22 LTS | GCP Cloud Run 互換、エコシステム成熟 |
| パッケージマネージャ | pnpm | workspace対応モノレポ、厳格な依存管理 |
| 静的サイト | Astro 5.x | ゼロJSデフォルト、ビルド高速、コンテンツサイトに最適 |
| スタイリング | Tailwind CSS 4 | ユーティリティファースト、ビルドサイズ最小化 |
| データソース | BoatraceCSV | CSV形式、ML予測込み、GitHub Pages配信 |
| 予想分析 | Gemini 3 Pro | 高い推論能力、展開シナリオの深い分析 |
| 画像生成 | Gemini 3 Pro Image | Thinkingモード、ダイアグラム明示サポート |
| バッチ実行 | Cloud Run Jobs + Cloud Scheduler | サーバーレス、最大24h実行 |
| ホスティング | Cloud Storage + Cloud CDN | 静的サイトに最適、低コスト |
| CI/CD | Cloud Build | GCPネイティブ統合 |
| テスト | Vitest | TypeScriptネイティブ、高速 |
| Linter/Formatter | Biome | ESLint+Prettier統合代替、高速 |
| バリデーション | Zod | TypeScript型推論との統合 |
| CSVパース | csv-parse | ストリーミング対応、型安全にZodと組み合わせ |

### Astro を選定した理由（vs Next.js SSG）

- **ゼロJSデフォルト**: コンテンツ表示が主目的、Reactランタイム不要
- **ビルド速度**: 1000ページ規模でNext.jsの約3倍高速（18秒 vs 52秒）
- **Lighthouse**: 0-5KB の JS バンドルで Lighthouse 100 を達成可能
- **ホスティング**: 純粋な静的HTML出力のためCloud Storage直接配信が可能

---

## 2. アプリケーションアーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloud Scheduler                                │
│                  (毎日 AM 9:00 JST)                               │
└──────────────────────┬────────────────────────────────────────────┘
                       │ トリガー
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Cloud Run Job                                    │
│                                                                   │
│  ┌───────────┐  ┌───────────────┐  ┌──────────────────┐         │
│  │ 1. Fetch  │→ │ 2. Predict    │→ │ 3. Generate      │         │
│  │   CSV     │  │   (Gemini 3   │  │   Images         │         │
│  │   Data    │  │    Pro)       │  │   (Gemini 3 Pro  │         │
│  │           │  │               │  │    Image)        │         │
│  └───────────┘  └───────────────┘  └────────┬─────────┘         │
│        │              │                      │                    │
│        │              │               ┌──────┴───────┐           │
│        │              │               │ 4. Quality   │           │
│        │              │               │    Check     │           │
│        │              │               │   (Gemini 3  │           │
│        │              │               │    Pro)      │           │
│        │              │               └──────┬───────┘           │
│        ▼              ▼                      ▼                    │
│  ┌──────────────────────────────────────────────────┐            │
│  │          5. Build Static Site (Astro SSG)         │            │
│  └──────────────┬───────────────────────────────────┘            │
└─────────────────┼────────────────────────────────────────────────┘
                  │ gsutil rsync
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│              Cloud Storage + Cloud CDN                            │
└─────────────────────────────────────────────────────────────────┘
```

### レイヤー構成

1. **データ取得レイヤー** (`packages/batch/src/fetcher/`)
   - BoatraceCSV (GitHub Pages) からCSVデータを取得
   - CSVパース + Zodバリデーション
   - 取得対象: `programs/title`, `programs/race_cards`, `previews/stt`, `index`, `results`（前日分）
   - リトライ・エラーハンドリング

   > **注**: 旧 proposal で挙げていた `prediction-preview` / `estimate` / `confirm` CSV は BoatraceCSV 上流での生成停止に伴い廃止済み。

2. **予想分析レイヤー** (`packages/batch/src/predictor/`) ※未実装
   - Gemini 3 Pro による展開予想テキスト生成（旧 proposal）
   - Estimates CSV 廃止により ML 予測の入力が無くなったため、現実装ではこのレイヤーは作らず、`index` の強さpt をそのまま AI 総合評価として表示する

3. **画像生成レイヤー** (`packages/batch/src/image-generator/`)
   - Gemini 3 Pro Image による展開予想画像生成
   - Gemini 3 Pro による SVG フォールバック生成
   - 生成画像の Cloud Storage アップロード

4. **品質チェックレイヤー** (`packages/batch/src/quality-checker/`)
   - Gemini 3 Pro マルチモーダルによる画像検証
   - 合否判定 → 不合格ならリトライ or SVGフォールバック採用
   - Agentic AI フィードバックループの核

5. **サイト生成レイヤー** (`packages/batch/src/site-builder/`)
   - 予想データをAstro用JSONとして書き出し
   - `astro build` 実行
   - Cloud Storage へデプロイ

---

## 3. ディレクトリ構成

```
fun-site/
├── packages/
│   ├── batch/                    # バッチ処理パッケージ
│   │   ├── src/
│   │   │   ├── fetcher/          # BoatraceCSV データ取得
│   │   │   │   ├── csv-client.ts         # HTTP取得 + CSVパース
│   │   │   │   ├── schemas.ts            # Zod スキーマ (CSV行 → 型)
│   │   │   │   └── index.ts
│   │   │   ├── predictor/        # Gemini 3 Pro 予想分析
│   │   │   │   ├── analyze.ts            # データ統合・前処理
│   │   │   │   ├── gemini-client.ts      # Vertex AI Gemini API
│   │   │   │   ├── prompt-builder.ts     # 分析プロンプト構築
│   │   │   │   └── index.ts
│   │   │   ├── image-generator/  # Gemini 3 Pro Image 画像生成
│   │   │   │   ├── gemini-image.ts       # Gemini 3 Pro Image API
│   │   │   │   ├── svg-generator.ts      # SVGフォールバック生成
│   │   │   │   ├── prompt-builder.ts     # 画像プロンプト構築
│   │   │   │   ├── storage.ts            # Cloud Storage アップロード
│   │   │   │   └── index.ts
│   │   │   ├── quality-checker/  # 品質チェックAgent
│   │   │   │   ├── checker.ts            # マルチモーダル品質検証
│   │   │   │   ├── criteria.ts           # 品質判定基準
│   │   │   │   └── index.ts
│   │   │   ├── site-builder/     # サイトビルド + デプロイ
│   │   │   │   ├── data-writer.ts        # JSON書き出し
│   │   │   │   ├── build.ts              # Astro ビルド実行
│   │   │   │   ├── deploy.ts             # gsutil rsync
│   │   │   │   └── index.ts
│   │   │   ├── pipeline.ts       # パイプライン全体制御
│   │   │   └── main.ts           # エントリーポイント
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── web/                      # Astro 静的サイト
│   │   ├── src/
│   │   │   ├── components/       # UI コンポーネント
│   │   │   │   ├── RaceCard.astro          # レース予想カード
│   │   │   │   ├── StadiumList.astro       # 会場一覧
│   │   │   │   ├── PredictionImage.astro   # 予想画像表示（OGP 用、現状は SVG）
│   │   │   │   ├── RacerTable.astro        # 出走表テーブル
│   │   │   │   ├── StartPredictionDiagram.astro # スタート予想 SVG（俰瞰図）
│   │   │   │   ├── ConfidenceStars.astro   # 信頼度表示
│   │   │   │   ├── ShareButton.astro       # SNS共有
│   │   │   │   ├── Header.astro
│   │   │   │   └── Footer.astro
│   │   │   ├── layouts/
│   │   │   │   └── BaseLayout.astro
│   │   │   ├── pages/
│   │   │   │   ├── index.astro             # トップ（当日の全場一覧）
│   │   │   │   ├── stadium/
│   │   │   │   │   └── [stadiumId]/
│   │   │   │   │       └── index.astro     # 会場別ページ
│   │   │   │   ├── race/
│   │   │   │   │   └── [date]/
│   │   │   │   │       └── [stadiumId]/
│   │   │   │   │           └── [raceNumber].astro  # 個別レース
│   │   │   │   ├── archive/
│   │   │   │   │   └── [date].astro        # 過去日付アーカイブ
│   │   │   │   └── stats.astro             # 的中実績
│   │   │   ├── styles/
│   │   │   │   └── global.css
│   │   │   └── content/          # バッチが書き出すデータ
│   │   │       └── races/        # JSON + 画像
│   │   ├── public/
│   │   │   ├── images/           # 静的アセット
│   │   │   └── favicon.svg
│   │   ├── astro.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── shared/                   # 共有型定義・ユーティリティ
│       ├── src/
│       │   ├── types/
│       │   │   ├── csv.ts                  # BoatraceCSV 由来の型
│       │   │   ├── prediction.ts           # AI展開予想の型
│       │   │   ├── stadium.ts              # 会場データ型
│       │   │   └── index.ts
│       │   ├── constants/
│       │   │   ├── stadiums.ts             # 会場マスタ（24場）
│       │   │   ├── race-grades.ts          # グレード定義
│       │   │   ├── boat-colors.ts          # 艇色定義 (1白,2黒,3赤,4青,5黄,6緑)
│       │   │   ├── winning-techniques.ts   # 決まり手定義
│       │   │   └── index.ts
│       │   └── utils/
│       │       ├── date.ts
│       │       ├── race-code.ts            # レースコードのパース・生成
│       │       └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── biome.json
├── package.json                  # ルート（workspace定義）
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── cloudbuild.yaml
```

---

## 4. バッチ処理フロー

### パイプライン全体

```
AM 9:00 (JST) - Cloud Scheduler トリガー  (BoatraceCSV daily-sync 完了後)
    │
    ▼
Step 1: データ取得 (fetchCsvData)
    ├── GET boatracecsv.github.io/data/programs/title/YYYY/MM/DD.csv
    │   → 当日レースメタ情報 (レース名・タイトル・締切時刻)
    ├── GET boatracecsv.github.io/data/programs/race_cards/YYYY/MM/DD.csv
    │   → 当日出走表 (選手・モーター・成績)
    ├── GET boatracecsv.github.io/data/previews/stt/YYYY/MM/DD.csv
    │   → 直前情報 (進入コース・スタート展示)
    ├── GET boatracecsv.github.io/data/index/YYYY/MM/DD.csv
    │   → 強さpt 寄与 (枠番/選手/モーター/展示/気象)
    ├── GET boatracecsv.github.io/data/results/YYYY/MM/(DD-1).csv
    │   → 前日レース結果
    ├── CSVパース (csv-parse)
    └── Zodバリデーション
    │
    ▼
Step 2: 予想分析 Agent (Gemini 3 Pro)
    ├── programs/title + programs/race_cards + previews/stt + index を統合（Estimates / Prediction Previews は廃止済み）
    ├── レース毎にGemini 3 Proへ分析リクエスト
    │   - ML予測結果を踏まえた展開シナリオ
    │   - スタート隊形・1マーク攻防・決まり手の予想
    │   - 買い目候補・信頼度スコア
    └── 構造化された展開予想 (JSON) を出力
    │
    ▼
Step 3: 画像生成 Agent (Gemini 3 Pro Image)
    ├── 展開予想テキスト → 画像プロンプト生成
    ├── Gemini 3 Pro Image で展開図を画像生成 (並列処理)
    └── 同時に Gemini 3 Pro で SVGフォールバック版を生成
    │
    ▼
Step 4: 品質チェック Agent (Gemini 3 Pro マルチモーダル)
    ├── 生成画像 + 展開予想テキストを入力
    ├── 検証項目:
    │   - 6艇すべて描画されているか
    │   - 艇番の色が正しいか (1白,2黒,3赤,4青,5黄,6緑)
    │   - テキストが読み取り可能か
    │   - レイアウトが破綻していないか
    ├── 合格 → 画像版を採用
    └── 不合格 → リトライ (最大2回) or SVGフォールバック採用
    │
    ▼
Step 5: 静的サイト生成 (buildSite)
    ├── 予想データを web/src/content/races/ に JSON 書き出し
    ├── 画像を web/public/images/races/ に配置
    ├── 前日 results から的中・配当の集計を stats として書き出し（旧 Confirmations CSV は廃止のため自前計算が必要）
    ├── `astro build` 実行
    └── 生成物を Cloud Storage へ gsutil rsync でデプロイ
```

### 並列処理戦略

```typescript
// 場単位で並列処理、場内のレースは順次処理（APIレート制限考慮）
const stadiumGroups = groupByStadium(races);
const concurrencyLimit = 5; // 同時に処理する場の数

const results = await pMap(
  stadiumGroups,
  (group) => processStadiumRaces(group),
  { concurrency: concurrencyLimit }
);
```

### エラーハンドリング方針

| 失敗箇所 | リトライ | フォールバック |
|---|---|---|
| CSV取得失敗 | 3回 (指数バックオフ) | その会場をスキップ、他会場は継続 |
| Gemini 3 Pro 分析失敗（再導入時） | 2回 | `index` の強さpt のみで簡易表示 |
| 画像生成失敗 | 2回 | SVGフォールバック画像を使用 |
| 品質チェック不合格 | 画像再生成2回 | SVGフォールバックを採用 |
| Astroビルド失敗 | 1回 | 前回成功時のビルド成果物を維持 |

---

## 5. データモデル

### 5.1 BoatraceCSV 由来の型（CSVパース結果）

```typescript
// === 出走表 Programs CSV ===
// 基本情報（CSVの1行が1レース、6艇分のカラムがフラット展開）
type ProgramRow = {
  raceCode: string;            // レースコード（全CSV共通キー）
  title: string;               // タイトル
  dayNumber: number;           // 日次
  raceDate: string;            // レース日 "YYYY-MM-DD"
  stadium: string;             // レース場
  raceNumber: number;          // レース回 (1-12)
  raceName: string;            // レース名（グレード）
  distance: number;            // 距離 (m)
  votingDeadline: string;      // 電話投票締切予定
  boats: ProgramBoat[];        // 6艇分（パース後に構造化）
};

type ProgramBoat = {
  boatNumber: number;          // 艇番 (1-6)
  registrationNumber: number;  // 登録番号
  racerName: string;           // 選手名
  age: number;                 // 年齢
  branch: string;              // 支部
  weight: number;              // 体重
  rank: string;                // 級別 (A1/A2/B1/B2)
  nationalWinRate: number;     // 全国勝率
  nationalTop2Rate: number;    // 全国2連対率
  localWinRate: number;        // 当地勝率
  localTop2Rate: number;       // 当地2連対率
  motorNumber: number;         // モーター番号
  motorTop2Rate: number;       // モーター2連対率
  boatBodyNumber: number;      // ボート番号
  boatTop2Rate: number;        // ボート2連対率
  currentResults: string[];    // 今節成績 (6レース分)
};

// === 直前情報 previews/stt CSV (現行) ===
type SttRow = {
  raceCode: string;
  raceDate: string;
  stadiumId: string;
  raceNumber: number;
  votingDeadline: string;      // 締切時刻
  fetchedAt: string;           // 取得日時
  boats: SttBoat[];
};

type SttBoat = {
  boatNumber: number;          // 艇番 (1-6)
  courseNumber: number;        // 進入コース
  exhibitionStartTiming: number; // スタート展示
};

// === 強さpt index CSV (現行) ===
type IndexRow = {
  raceCode: string;
  raceDate: string;
  stadiumId: string;
  raceNumber: number;
  state: "daily" | "realtime"; // 朝バッチ時点 / 直前情報反映後
  entries: IndexEntry[];
};

type IndexEntry = {
  boatNumber: number;          // 艇番 (1-6)
  framePt: number;             // 枠番pt
  framePtContribution: number; // 寄与_枠番pt
  racerPt: number;             // 選手pt
  racerPtContribution: number;
  motorPt: number;             // モーターpt
  motorPtContribution: number;
  exhibitionPt: number;        // 展示pt
  exhibitionPtContribution: number;
  weatherPt: number;           // 気象pt
  weatherPtContribution: number;
  strengthPt: number;          // 強さpt（5要素の合計）
};

// === 旧 ML展示会予測 / ML着順予想 CSV は廃止済み ===
// PredictionPreviewRow / EstimateRow / ConfirmationRow は
// BoatraceCSV 上流での生成停止により利用不可。

// === レース結果 Results CSV ===
type ResultRow = {
  raceCode: string;
  title: string;
  dayNumber: number;
  raceDate: string;
  stadium: string;
  raceNumber: number;
  raceName: string;
  distance: number;
  weather: string;             // 天候
  windDirection: string;       // 風向
  windSpeed: number;           // 風速 (m)
  waveHeight: number;          // 波の高さ (cm)
  technique: string;           // 決まり手
  payouts: ResultPayouts;
  positions: ResultPosition[]; // 1着〜6着
};

type ResultPayouts = {
  win: PayoutEntry;            // 単勝
  place: PayoutEntry[];        // 複勝 (3着まで)
  exacta: PayoutEntry;         // 2連単
  quinella: PayoutEntry;       // 2連複
  quinellaPlace: PayoutEntry[];// 拡連複
  trifecta: PayoutEntry;       // 3連単
  trio: PayoutEntry;           // 3連複
};

type PayoutEntry = {
  combination: string;         // 組番
  payout: number;              // 払戻金
};

type ResultPosition = {
  position: number;            // 着順 (1-6)
  boatNumber: number;          // 艇番
  registrationNumber: number;  // 登録番号
  racerName: string;           // 選手名
  motorNumber: number;         // モーター番号
  boatBodyNumber: number;      // ボート番号
  exhibitionTime: number;      // 展示タイム
  courseNumber: number;         // 進入コース
  startTiming: number;         // スタートタイミング
  raceTime: number;            // レースタイム
};

// === 旧 的中確認 Confirmations CSV は廃止済み ===
// ML予測 vs 実績の対比データは BoatraceCSV から取得不可。
// 的中実績ページを実装する場合は、自前で過去予想 vs `results` を突合する必要がある。
```

### 5.2 アプリケーション独自型（現行: BoatraceCSV CSV を結合した RacePrediction）

```typescript
// === レース 1 件分の統合データ（現行実装） ===
// 全 CSV は raceCode をキーに結合する。
type RacePrediction = {
  raceCode: string;
  raceDate: string;
  stadiumId: string;
  stadiumName: string;
  raceNumber: number;
  raceName: string;             // programs/title 由来
  raceTitle: string;            // programs/title 由来
  votingDeadline: string;       // programs/title or previews/stt 由来
  racers: RaceRacer[];          // programs/race_cards 由来
  startPrediction: StartPrediction; // previews/stt + race_cards
  aiEvaluation: AiEvaluation;   // index 由来（強さpt 寄与）
  generatedAt: string;
};

type StartPrediction = {
  fromExhibition: boolean;     // true: previews/stt 由来 / false: 枠番フォールバック
  entries: StartPredictionEntry[];
};

type StartPredictionEntry = {
  boatNumber: number;
  courseNumber: number;        // 進入コース（stt が無いと枠番）
  startTiming: number;         // 全国平均ST（race_cards 由来）
};

type AiEvaluation = {
  state: "daily" | "realtime"; // index CSV の状態
  entries: AiEvaluationEntry[];
};

type AiEvaluationEntry = {
  boatNumber: number;
  contribution: {
    frame: number;             // 枠番pt 寄与
    racer: number;             // 選手pt 寄与
    motor: number;             // モーターpt 寄与
    exhibition: number;        // 展示pt 寄与（state=daily の時は 0）
    weather: number;           // 気象pt 寄与（state=daily の時は 0）
  };
  strengthPt: number;          // 5要素の合計
};
```

> **注**: 旧 proposal の「Gemini 3 Pro 分析結果」「ML予測 (Estimates由来)」「画像URL」「的中実績統計 (AccuracyStats)」は、Vertex AI 不採用と Confirmations CSV 廃止に伴い現実装には存在しない。

---

## 6. データ取得の詳細設計

### 6.1 BoatraceCSV URL構造

```
https://boatracecsv.github.io/data/{type}/YYYY/MM/DD.csv
```

| type | 例 | 取得タイミング |
|---|---|---|
| programs/title | `data/programs/title/2026/02/12.csv` | AM 9:00 JST（当日分） |
| programs/race_cards | `data/programs/race_cards/2026/02/12.csv` | AM 9:00 JST（当日分） |
| previews/stt | `data/previews/stt/2026/02/12.csv` | 締切 5 分前以降に順次公開 |
| index | `data/index/2026/02/12.csv` | AM 9:00 JST（当日分・state=daily） |
| results | `data/results/2026/02/11.csv` | AM 9:00 JST（前日分） |

> **注**: 旧 `prediction-preview` / `estimate` / `confirm` および旧 `programs/YYYY/MM/DD.csv`（サブディレクトリなし）は BoatraceCSV 上流での生成停止に伴い廃止済み。

### 6.2 CSVパース方針

```typescript
// csv-parse でストリーミングパース → Zod でバリデーション
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

// CSVの1行はフラット（6艇分のカラムが横に展開）
// パース時に構造化オブジェクトに変換する
const rawRows = parse(csvText, {
  columns: true,     // ヘッダー行をキーとして使用
  skip_empty_lines: true,
});

// Zodスキーマでバリデーション + 型変換
const validated = rawRows.map((row) => programRowSchema.parse(row));
```

### 6.3 レースコードによるデータ結合

全CSVは `レースコード` をキーとして結合する。

```typescript
// レースコードをキーに race_cards を起点として title / stt / index を結合
const sttByCode = new Map(stt.map((s) => [s.raceCode, s]));
const indexByCode = new Map(indexes.map((i) => [i.raceCode, i]));
const titleByCode = new Map(titles.map((t) => [t.raceCode, t]));

const mergedData = raceCards.map((cards) => ({
  cards,
  title: titleByCode.get(cards.raceCode),
  stt: sttByCode.get(cards.raceCode),     // 未公開なら undefined → 枠番フォールバック
  index: indexByCode.get(cards.raceCode), // 未公開なら undefined → 中立評価
}));
```

---

## 7. SEO・OGP 対応

### ページ別メタデータ

| ページ | title | description | OGP画像 |
|---|---|---|---|
| トップ | `ボートレース展開予想 - {日付}` | 当日の全会場予想一覧 | サイト共通OGP |
| 会場別 | `{会場名} {日付} - 展開予想` | 会場の全12R予想 | 会場アイキャッチ |
| レース別 | `{会場名} {R}R {レース名} - 展開予想` | 個別レース予想詳細 | スタート予想 SVG（将来は PNG 化） |
| アーカイブ | `{日付}のレース一覧` | 過去日付のレース一覧 | サイト共通OGP |
| 的中実績 | `的中実績 - ボートレース展開予想` | （未実装。Confirmations CSV 廃止により再設計が必要） | 統計グラフ画像 |

### URL設計

```
/                                    # 当日トップ
/stadium/{stadiumId}/                # 会場別
/race/{date}/{stadiumId}/{raceNum}   # 個別レース
/archive/{date}                      # 過去日付
/stats                               # 的中実績
```

### 構造化データ (JSON-LD)

各レースページに `Article` スキーマを埋め込み、Google検索結果での表示を最適化。

---

## 8. 過去データの蓄積戦略

### Cloud Storage バケット設計

```
gs://fun-site-data/
├── csv-cache/                         # BoatraceCSV キャッシュ
│   └── {type}/{YYYY}/{MM}/{DD}.csv
├── predictions/                       # AI予想データ
│   └── {YYYY}/{MM}/{DD}/
│       └── {raceCode}.json
├── images/                            # 生成画像
│   └── {YYYY}/{MM}/{DD}/
│       └── {raceCode}/
│           ├── prediction.webp        # メイン画像
│           ├── prediction-og.webp     # OGP画像
│           └── prediction.svg         # SVGフォールバック
└── stats/
    └── accuracy.json                  # 累計的中率サマリ
```

### 蓄積フロー

1. 毎日 AM 9:00 JST: CSVデータをキャッシュ、`RacePrediction` JSON を保存
2. （将来）前日 `results` と過去 `RacePrediction` を突合し、的中実績を自前集計
3. `stats/accuracy.json` を累計更新
4. アーカイブページを生成（直近N日分）

> **注**: 旧 proposal にあった「Confirmations CSV からの ML的中実績集計」は CSV 廃止により不可。AI 予想画像も Vertex AI 不採用により現状なし。

---

## 9. ハッカソン向け考慮事項

### MVP スコープ（現実装）

1. BoatraceCSV から全 24 会場の `programs/title` / `programs/race_cards` / `previews/stt` / `index` / `results`（前日分）を取得 + Zod バリデーション
2. レースコード結合による `RacePrediction` JSON 生成
3. スタート予想 SVG（俰瞰図）と AI 総合評価（強さpt 寄与）SVG を Astro コンポーネントで描画
4. Cloud Storage での配信
5. Cloud Scheduler + Cloud Run Jobs で AM 9:00 JST バッチ

### 拡張スコープ（将来）

- `previews/stt` / `index` (`state=realtime`) の後追い差分更新バッチ
- 的中率ダッシュボード（過去 `RacePrediction` × `results` の自前突合）
- OGP 画像（SVG → PNG 化）
- （検討）Vertex AI Gemini による日本語の展開解説テキスト追加
