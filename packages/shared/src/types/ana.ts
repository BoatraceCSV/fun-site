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
