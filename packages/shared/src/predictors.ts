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
export type ComponentKey = "waku" | "racer" | "motor" | "exhibit" | "weather" | "tenkai";

/** Component key → 日本語ラベル (CSV 列名から成分への逆引きにも使う)。 */
export const COMPONENT_LABELS: Readonly<Record<ComponentKey, string>> = {
  waku: "枠番pt",
  racer: "選手pt",
  motor: "モーターpt",
  exhibit: "展示pt",
  weather: "気象pt",
  tenkai: "展開優位pt",
};

/** Component key → 短縮表示ラベル(UI バー凡例等で使う)。 */
export const COMPONENT_SHORT_LABELS: Readonly<Record<ComponentKey, string>> = {
  waku: "枠番",
  racer: "選手",
  motor: "モーター",
  exhibit: "展示",
  weather: "気象",
  tenkai: "展開",
};

/** Component key → バー / 凡例の色 (UI 描画専用)。 */
export const COMPONENT_COLORS: Readonly<Record<ComponentKey, string>> = {
  waku: "#3b82f6",
  racer: "#22c55e",
  motor: "#f97316",
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
  /** UI 表示名 (例: "A君予想")。 */
  readonly displayName: string;
  /** active な予想者の中での表示順。低いほど先頭に出る。 */
  readonly slot: number;
  /** "active" か "retired"。 */
  readonly status: PredictorStatus;
  /** この予想者で予想を出し始めた日 (累計回収率の起点、YYYY-MM-DD)。 */
  readonly startedAt: string;
  /** この予想者が使う特徴量キー (順序が CSV 列順)。 */
  readonly componentKeys: readonly ComponentKey[];
};

/**
 * 予想者レジストリ本体。
 *
 * v1_basic = "A君予想" (5 成分、control)。
 * v2_tenkai = "B君予想"。展開優位pt (tenkai) を加えた 6 成分版を試したが
 * control を回収率で下回ったため、2026-06-13 に A君予想と同一 recipe へ戻した。
 * 別の特徴量を試す実験スロットとして引き続き利用する。
 */
export const PREDICTORS: readonly PredictorSpec[] = [
  {
    id: "v1_basic",
    displayName: "A君予想",
    slot: 1,
    status: "active",
    startedAt: "2026-05-01",
    componentKeys: ["waku", "racer", "motor", "exhibit", "weather"],
  },
  {
    id: "v2_tenkai",
    displayName: "B君予想",
    slot: 2,
    status: "active",
    // boatracecsv 側 registry.py と同期。
    // 展開優位pt (tenkai) を加えた版は A君予想 (control) を回収率で下回ったため
    // 2026-06-13 に撤去し、A君予想と同一 recipe (5 成分) の baseline に戻した。
    // recipe が変わったので started_at をこの日にリセットし、累計回収率を
    // 当日から再計測する (展開予想時代 5/30〜6/12 の成績は累計に含めない)。
    // 別の特徴量を探る実験スロットとして id は v2_tenkai のまま据え置く。
    startedAt: "2026-06-13",
    componentKeys: ["waku", "racer", "motor", "exhibit", "weather"],
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
