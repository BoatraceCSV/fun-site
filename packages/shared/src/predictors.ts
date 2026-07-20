/**
 * 予想者(predictor)レジストリ。
 *
 * boatracecsv 側の `scripts/boatrace/predictors/registry.py` と
 * `predictor_id` を必ず同期させること。fun-site はこの ID を使って
 * CSV パス (`data/estimate/{predictor_id}/...`) を解決し、Pub/Sub
 * メッセージの `csv_type=index:{predictor_id}` を予想者に紐付ける。
 *
 * 新規予想者の追加: 必要なら `COMPONENT_LABELS` に新成分を足し、
 * `PREDICTORS` 配列に `PredictorSpec` を追加する。
 * 退役: 該当エントリの `status` を `"retired"` に変更する
 * (過去データと累計回収率は保持)。
 *
 * ID の命名規則: 退役後も同じ ID は **再利用しない**
 * (累計回収率の同一性のため)。`<バージョン>_<特徴>` 形式を推奨。
 */

/** 各予想者で採用しうる特徴量成分のキー。 */
export type ComponentKey =
  | "waku"
  | "course"
  | "racer"
  | "motor"
  | "motor2rate"
  | "motor4"
  | "exhibit"
  | "weather"
  | "tenkai";

/** Component key → 日本語ラベル (CSV 列名から成分への逆引きにも使う)。 */
export const COMPONENT_LABELS: Readonly<Record<ComponentKey, string>> = {
  waku: "枠番pt",
  // v6_course で採用。場×レース番号×コース別の収縮済み1着率
  // (data/estimate/stadium/course_win_rate.csv) を実進入コース (daily は枠番) で
  // 引いた値。waku の代替成分。列名は N枠_コースpt。boatracecsv 側 registry.py と同期。
  course: "コースpt",
  racer: "選手pt",
  motor: "モーターpt",
  motor2rate: "モーター2連率pt",
  // v4_motor で採用。エキスパート評価 (平和島/唐津/大村/鳴門) でチューニングした
  // モーター能力指数。CSV 列名は motor と同じ「モーターpt」(ファイルは predictor_id
  // ごとに分かれるため衝突しない)。boatracecsv 側 registry.py と同期。
  motor4: "モーターpt",
  exhibit: "展示pt",
  weather: "気象pt",
  tenkai: "展開優位pt",
};

/** Component key → 短縮表示ラベル(UI バー凡例等で使う)。 */
export const COMPONENT_SHORT_LABELS: Readonly<Record<ComponentKey, string>> = {
  waku: "枠番",
  course: "コース",
  racer: "選手",
  motor: "モーター",
  motor2rate: "M2連率",
  motor4: "モーター",
  exhibit: "展示",
  weather: "気象",
  tenkai: "展開",
};

/** Component key → バー / 凡例の色 (UI 描画専用)。 */
export const COMPONENT_COLORS: Readonly<Record<ComponentKey, string>> = {
  waku: "#3b82f6",
  course: "#6366f1",
  racer: "#22c55e",
  motor: "#f97316",
  motor2rate: "#14b8a6",
  motor4: "#ea580c",
  exhibit: "#a855f7",
  weather: "#06b6d4",
  tenkai: "#ec4899",
};

/**
 * daily 状態(朝バッチ)では未取得な preview 由来の成分。
 * UI 側はこれらを daily 評価では非表示にする。
 * `tenkai` (展開優位pt) はスタート展示の進入コースに依存するため preview 由来。
 */
export const PREVIEW_DERIVED_COMPONENTS: readonly ComponentKey[] = ["exhibit", "weather", "tenkai"];

/** `key` が preview 由来成分かを判定。 */
export function isPreviewDerivedComponent(key: ComponentKey): boolean {
  return PREVIEW_DERIVED_COMPONENTS.includes(key);
}

/** Component key → 欠損補完値 (偏差値pt スケール)。boatracecsv 側と同期。 */
export const COMPONENT_MISSING_FALLBACK: Readonly<Partial<Record<ComponentKey, number>>> = {
  racer: 30.0,
};
export const COMPONENT_MISSING_FALLBACK_DEFAULT = 50.0;

/** 予想者の運用状態。 */
export type PredictorStatus = "active" | "retired";

/** 1 予想者の宣言的定義。 */
export type PredictorSpec = {
  /** 予想者の固有 ID。退役後も再利用しない。 */
  readonly id: string;
  /** UI 表示名 (例: "本命予想")。 */
  readonly displayName: string;
  /** active な予想者の中での表示順。低いほど先頭に出る。 */
  readonly slot: number;
  /** "active" か "retired"。 */
  readonly status: PredictorStatus;
  /** この予想者で予想を出し始めた日 (累計回収率の起点、YYYY-MM-DD)。 */
  readonly startedAt: string;
  /** この予想者が使う特徴量キー (順序が CSV 列順)。 */
  readonly componentKeys: readonly ComponentKey[];
  /**
   * 1 マーク走行距離計算・スリット図の予測 ST に AI 推定 ST
   * (estimate/racer_st、実測 ST 履歴ベース) を使うか。未指定 (false) は
   * 従来どおり全国平均 ST。現状 v5_slit のみ true。
   */
  readonly useEstimatedST?: boolean;
};

/**
 * 予想者レジストリ本体。
 *
 * v1_basic = "本命予想" (5 成分、control)。現行 active な control。
 * v2_tenkai = "モーター評価変更予想" (実験スロット)。着順ベースの motor を motor2rate
 * (公式モーター2連率) に置き換えた 5 成分構成。2026-07-19 退役 (control に有意差なし)。
 * v3_tenkai = "展開予想"。control の 5 成分に展開優位pt (tenkai) を加えた 6 成分版。
 * 2026-07-19 退役 (control に有意差なし)。
 * v4_motor = "モーター予想" (実験スロット)。control の motor をエキスパート評価で
 * チューニングした motor4 に差し替えた 5 成分版 (2026-07-20〜)。
 * v5_slit = "スリット予想" (実験スロット)。control と同一の 5 成分で、1 マーク距離
 * 計算・スリット図の予測 ST だけを AI 推定 ST (racer_st) に差し替えた版 (2026-07-21〜)。
 * v6_course = "コース予想" (実験スロット)。control の waku を場×レース番号×コース別の
 * コース強度 (course) に差し替えた 5 成分版 (2026-07-22〜)。
 *
 * v2_tenkai / v3_tenkai は退役後もエントリと過去データ (data/estimate/{id}/…)・
 * 成分定義 (tenkai / motor2rate) を保持する。命名規則どおり退役した ID は再利用しない
 * (累計回収率の同一性のため)。`activePredictors()` から除外されるので fetcher /
 * build-state / 各集計の対象から自動的に外れる。boatracecsv 側 registry.py と同期。
 */
export const PREDICTORS: readonly PredictorSpec[] = [
  {
    id: "v1_basic",
    displayName: "本命予想",
    slot: 1,
    status: "active",
    startedAt: "2026-05-01",
    componentKeys: ["waku", "racer", "motor", "exhibit", "weather"],
  },
  {
    id: "v2_tenkai",
    displayName: "モーター評価変更予想",
    slot: 2,
    // 2026-07-19 退役。control (v1_basic) に対し有意な回収率差が得られなかった。
    // boatracecsv 側 registry.py と同期。エントリと過去データは保持 (ID 再利用なし)。
    status: "retired",
    // 着順ベースの motor を motor2rate (公式モーター2連率) に置き換えた 5 成分構成
    // (2026-06-13〜)。当初 (2026-05-30〜06-13) は展開優位pt (tenkai) を加えた 6 成分版だった。
    startedAt: "2026-06-13",
    componentKeys: ["waku", "racer", "motor2rate", "exhibit", "weather"],
  },
  {
    id: "v3_tenkai",
    displayName: "展開予想",
    slot: 3,
    // 2026-07-19 退役。control (v1_basic) に対し有意な回収率差が得られなかった。
    // boatracecsv 側 registry.py と同期。エントリと過去データは保持 (ID 再利用なし)。
    status: "retired",
    // 本命予想 (control, v1_basic) の 5 成分に展開優位pt (tenkai) を加えた
    // 6 成分版 (2026-06-20〜)。tenkai はスタート展示の進入コース由来 (PREVIEW_DERIVED_COMPONENTS)。
    startedAt: "2026-06-20",
    componentKeys: ["waku", "racer", "motor", "exhibit", "weather", "tenkai"],
  },
  {
    id: "v4_motor",
    displayName: "モーター予想",
    slot: 4,
    status: "active",
    // boatracecsv 側 registry.py と同期。
    // 本命予想 (control, v1_basic) の着順ベース motor を、エキスパート評価
    // (平和島/唐津/大村/鳴門 の 4 場) との順位相関でチューニングした motor4 に
    // 差し替えた 5 成分構成 (成分数は control と同じで motor 指標だけ差し替え)。
    // motor4 = スコア表 v4 (凸カーブ) + ペナルティ -50 + 直近 5 節。preview 非依存で
    // 朝バッチでも取得可。control と回収率を A/B 比較する実験スロット。
    startedAt: "2026-07-20",
    componentKeys: ["waku", "racer", "motor4", "exhibit", "weather"],
  },
  {
    id: "v5_slit",
    displayName: "スリット予想",
    slot: 5,
    status: "active",
    // boatracecsv 側 registry.py と同期。
    // 本命予想 (control, v1_basic) と同一の 5 成分 (index / 強さpt は同値) で、
    // 1 マーク走行距離計算とスリット図の予測 ST だけを全国平均 ST から
    // AI 推定 ST (estimate/racer_st。実測 ST 履歴の EWMA + コース/F 補正) に
    // 差し替えた実験スロット。ST 推定の改善単独の回収率効果を control と
    // A/B 比較する (boatracecsv docs/design/st_estimation.md)。
    startedAt: "2026-07-21",
    componentKeys: ["waku", "racer", "motor", "exhibit", "weather"],
    useEstimatedST: true,
  },
  {
    id: "v6_course",
    displayName: "コース予想",
    slot: 6,
    status: "active",
    // boatracecsv 側 registry.py と同期。
    // 本命予想 (control, v1_basic) の枠番pt (waku、場×季節×コース) を、
    // 場×レース番号×コース別の収縮済み1着率テーブルに基づくコースpt (course) に
    // 差し替えた 5 成分構成。テーブル定義の優劣だけを control と回収率で A/B
    // 比較する実験スロット。course は waku 同様 daily でも値を持つ
    // (PREVIEW_DERIVED_COMPONENTS には含めない)。
    // 設計: boatracecsv docs/design/course_strength_v6.md
    startedAt: "2026-07-22",
    componentKeys: ["course", "racer", "motor", "exhibit", "weather"],
  },
];

/** 登録されている全予想者 (active + retired) を返す。 */
export function allPredictors(): readonly PredictorSpec[] {
  return PREDICTORS;
}

/** `status === "active"` の予想者を slot 昇順で返す。 */
export function activePredictors(): readonly PredictorSpec[] {
  return PREDICTORS.filter((p) => p.status === "active").toSorted((a, b) => a.slot - b.slot);
}

/** ID で 1 件取得。見つからなければ `undefined`。 */
export function predictorById(id: string): PredictorSpec | undefined {
  return PREDICTORS.find((p) => p.id === id);
}

/**
 * `data/estimate/{predictor_id}/YYYY/MM/DD.csv` の **リポジトリ相対** パス
 * (BoatraceCSV リポジトリ内のパス。GCS の object key やフェッチ URL の
 * 末尾部分にもそのまま使える)。
 */
export function predictorCsvPath(
  predictor: PredictorSpec,
  date: { year: number; month: number; day: number },
): string {
  const yyyy = String(date.year).padStart(4, "0");
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `data/estimate/${predictor.id}/${yyyy}/${mm}/${dd}.csv`;
}

/**
 * Pub/Sub メッセージの csv_type (`index:v1_basic` 等) から
 * predictor を逆引きする。
 *
 * `csvType` が `"index:"` プリフィックスを持たない、または未知の ID
 * を含む場合は `undefined`。
 */
export function predictorFromIndexCsvType(csvType: string): PredictorSpec | undefined {
  const prefix = "index:";
  if (!csvType.startsWith(prefix)) return undefined;
  return predictorById(csvType.slice(prefix.length));
}

/** 予想者 `predictor` 用の Pub/Sub csv_type 文字列を組み立てる。 */
export function indexCsvTypeFor(predictor: PredictorSpec): string {
  return `index:${predictor.id}`;
}
