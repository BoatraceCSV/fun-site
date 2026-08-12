/**
 * 荒れ度メーター(決まり手セルモデル)の 1 レース 1 状態ぶん。
 *
 * BoatraceCSV `data/estimate/kimarite/YYYY/MM/DD.csv` 由来
 * (`scripts/build_kimarite_probs.py` 出力)。予想者に紐づかない**レース単位**の
 * 指標なので、どの予想者のカードにも共通で表示できる。
 */
export type KimariteRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly state: "daily" | "realtime";
  /**
   * 荒れ度 = `1 − P(逃げ_1)`。0〜1。
   *
   * **これが唯一そのまま見せてよい値。** 校正が取れている
   * (予測平均と実測のズレ 0.3pt)。
   */
  readonly upsetRate: number;
  /** 決まり手セル (決まり手 × 1着コース) ごとの確率。キーは "まくり_3" 等。 */
  readonly cellProbabilities: Readonly<Record<string, number>>;
};
