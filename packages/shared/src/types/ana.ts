import type { BetCombo } from "../utils/one-mark-distance.js";

/**
 * 穴予想の買い目 1 点。
 *
 * A案 `v9_suji`(`data/estimate/suji/`)と B案 `v10_kimarite`
 * (`data/estimate/kimarite/picks/`)で **同じ形**。どちらも boatracecsv 側が
 * 出目まで確定させて配るので、fun-site は買い目を計算しない
 * (boatracecsv docs/design/ana_prediction.md §13 / §8.1)。
 *
 * 決まり手注釈は静的テーブル
 * (`data/estimate/suji/tables/kimarite_table.csv`)由来で、
 * 「その出目の並びが実際にはどの決まり手で決まっていることが多いか」を表す
 * (同 §14.1)。両案で同じテーブルを引く共通の表示レイヤー。
 *
 * **レース単位の決まり手予測ではない。** 出目 1 点ごとの説明としてのみ使う
 * (同 §14.2: レース単位の argmax はベースレートに負ける)。
 */
export type AnaPick = {
  /** 買う出目 (1着艇, 2着艇, 3着艇)。 */
  readonly combo: BetCombo;
  /** その出目の最頻決まり手 (例: "まくり差し")。不明なら空文字。 */
  readonly kimarite: string;
  /**
   * ブレンド後の 3連単確率 (0〜1)。boatracecsv `build_kimarite_picks.py` が
   * 2026-09-19 から `確率N` 列で配る。列追加前の CSV / 空欄なら undefined。
   * 120 通りの分布の値そのもので、1 コース頭を除いた後の正規化はされていない。
   */
  readonly probability?: number;
};

/**
 * 穴予想の 1 レース 1 状態ぶんの買い目。
 *
 * `state` は index CSV と同じ規約で、`daily` は朝バッチ(枠なり・暫定 強さpt)、
 * `realtime` は直前バッチ(展示進入・確定 強さpt)。回収率の集計母数になるのは
 * `realtime` のみ。
 *
 * A案は 1着艇が 1 つに決まるが、**B案は 120 通りの確率から上位 5 点を取るので
 * 1 レースの買い目に複数の 1着艇が混ざる**。型としてはどちらも出目のリスト。
 */
export type AnaPicksRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly state: "daily" | "realtime";
  /** 買い目 (通常 5 点)。 */
  readonly picks: readonly AnaPick[];
};

/** 1着・2着・3着のコース並び。艇番ではなく**進入コース**。 */
export type CourseTriple = readonly [number, number, number];

/**
 * `data/estimate/suji/tables/kimarite_table.csv` の 1 行。
 * 出目 (コース並び) ごとに、その並びで決まったレースの決まり手の分布と最頻値。
 * 120 行の静的テーブルで、買い目 1 点ごとの決まり手注釈の出どころ
 * (boatracecsv docs/design/ana_prediction.md §14.1)。
 */
export type KimariteTableRow = {
  readonly courses: CourseTriple;
  /** 観測レース数 */
  readonly n: number;
  /** 最頻決まり手 (= 買い目 CSV の `決まり手N` に入る値) */
  readonly mode: string;
  /** 決まり手 → 割合 (合計 ≈ 1)。キーは `KIMARITE_NAMES` */
  readonly shares: Readonly<Record<string, number>>;
};

/**
 * `data/estimate/kimarite/tables/pair_table.csv` の 1 行。
 * Stage2 = 決まり手セル条件付きの 2着・3着コース分布 `P(2着, 3着 | セル)`。
 * 32 セル × 20 ペア = 640 行の静的テーブル (同 §4.2)。
 */
export type PairTableRow = {
  /** `まくり差し_3` 等 (決まり手_1着コース) */
  readonly cell: string;
  readonly second: number;
  readonly third: number;
  /** 観測レース数 */
  readonly n: number;
  /** セル内で合計 1 */
  readonly probability: number;
};

/** 穴予想詳細ページ向け: 買い目 1 点の根拠。 */
export type AnaPickBasis = {
  readonly combo: BetCombo;
  /** `combo` を進入コースに写像した並び (daily は枠なり、realtime は展示進入) */
  readonly courses: CourseTriple;
  /** 決まり手注釈 (買い目 CSV の値) */
  readonly kimarite: string;
  /** ブレンド後の確率。CSV に列が無ければ undefined */
  readonly probability?: number;
  /** その出目の決まり手分布 (`kimarite_table.csv`)。テーブル未取得なら undefined */
  readonly kimariteShares?: {
    readonly n: number;
    readonly shares: Readonly<Record<string, number>>;
  };
};

/** 穴予想詳細ページ向け: 荒れ側の上位セルの Stage2 ペア表 (上位ペアのみ)。 */
export type AnaPairTableView = {
  readonly cell: string;
  /** Stage1 のセル確率 */
  readonly cellProbability: number;
  /** `P(2着, 3着 | セル)` の上位ペア。確率降順 */
  readonly pairs: readonly {
    readonly second: number;
    readonly third: number;
    readonly n: number;
    readonly probability: number;
  }[];
};

/**
 * 穴予想 (`v10_kimarite`) の根拠。1 状態 (daily / realtime) ぶん。
 *
 * 荒れ度メーター (`UpsetMeter`) が配る `1 − P(逃げ_1)` に加えて、Stage1 の
 * 32 セル確率・買い目ごとの根拠・荒れ側上位セルの Stage2 ペア表を持つ。
 * **買い目そのものは `PredictorPrediction.dailyPicks` / `realtimePicks` が正**で、
 * ここにあるのは「なぜその 5 点か」を説明するための材料。
 */
export type AnaBasisState = {
  /** `1 − P(逃げ_1)` (0〜1) */
  readonly upsetRate: number;
  /** 決まり手セル (`まくり_3` 等) → 確率。32 セルで合計 ≈ 1 */
  readonly cellProbabilities: Readonly<Record<string, number>>;
  /** 進入コース → 艇番。index 0 = 1 コース。daily は枠なり [1..6] */
  readonly boatByCourse: readonly number[];
  /** 買い目 5 点の根拠。`dailyPicks` / `realtimePicks` と同順 */
  readonly picks: readonly AnaPickBasis[];
  /** 荒れ側 (1 コース頭以外) で確率上位のセルの Stage2 ペア表。テーブル未取得なら空 */
  readonly pairTables: readonly AnaPairTableView[];
};

/** レース単位の穴予想根拠。`RacePrediction.anaBasis`。 */
export type AnaBasis = {
  readonly daily?: AnaBasisState;
  readonly realtime?: AnaBasisState;
};
