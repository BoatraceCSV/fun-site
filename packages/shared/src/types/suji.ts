import type { BetCombo } from "../utils/one-mark-distance.js";

/**
 * 穴予想 `v9_suji`(スジ予想)の買い目 1 点。
 *
 * boatracecsv の `data/estimate/suji/YYYY/MM/DD.csv` に載っている出目と、
 * その出目に対応する決まり手注釈。注釈は静的テーブル
 * (`data/estimate/suji/tables/kimarite_table.csv`)由来で、
 * 「その出目の並びが実際にはどの決まり手で決まっていることが多いか」を表す
 * (boatracecsv docs/design/ana_prediction.md §14.1)。
 *
 * **レース単位の決まり手予測ではない。** 出目 1 点ごとの説明としてのみ使う。
 */
export type SujiPick = {
  /** 買う出目 (1着艇, 2着艇, 3着艇)。 */
  readonly combo: BetCombo;
  /** その出目の最頻決まり手 (例: "まくり差し")。不明なら空文字。 */
  readonly kimarite: string;
};

/**
 * スジ予想の 1 レース 1 状態ぶん。
 *
 * `state` は index CSV と同じ規約で、`daily` は朝バッチ(枠なり・暫定 強さpt)、
 * `realtime` は直前バッチ(展示進入・確定 強さpt)。回収率の集計母数になるのは
 * `realtime` のみ。
 */
export type SujiRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly state: "daily" | "realtime";
  /** 1着に選んだコース (1-6)。 */
  readonly firstCourse: number;
  /** 1着に選んだ艇番 (1-6)。 */
  readonly firstBoat: number;
  /** 買い目 (通常 5 点)。 */
  readonly picks: readonly SujiPick[];
};
