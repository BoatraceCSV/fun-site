/**
 * 得点率早見 (previews/tokuten_hayami) CSV 由来の型定義。
 *
 * 得点率 = 着順点の平均 (得点の合計 ÷ 出走数)。節内順位と、当該レースで
 * 各着順を取った場合の得点率を持つ。予選最終日までしか公開されず、
 * 得点率早見を出さない節もあるため、行が無いレースは「表なし」。
 */

/** 1 艇 × 1 着順ぶんの「この着ならこうなる」セル */
export type TokutenHayamiIfRank = {
  /** 着順 (1-6) */
  readonly rank: number;
  /** その着順を取った場合の得点率。欠損は null */
  readonly scoreRate: number | null;
  /**
   * 上流の色分けコード。bit1 = ボーダー得点率以上 / bit2 = 次レースの結果次第で
   * ボーダー以上の可能性 / bit4 = 当レース終了時点でボーダー以上。欠損は null
   */
  readonly status: number | null;
};

/** 1 艇分の得点率早見 */
export type TokutenHayamiRacer = {
  readonly boatNumber: number;
  readonly classGrade: string;
  readonly registrationNumber: number;
  readonly racerName: string;
  /**
   * 現在の得点率。数値でない場合 (賞除 / 欠場 / 帰郷 / 追配) は null で、
   * 生文字列は `scoreRateLabel` に入る。
   */
  readonly scoreRate: number | null;
  /** 得点率セルの生文字列 (数値のときは数値表記そのまま) */
  readonly scoreRateLabel: string;
  /** 節内順位。欠損は null */
  readonly rank: number | null;
  /** 順位がボーダー順位以内か (上流の `ボーダー状態` 末尾が 1) */
  readonly withinBorder: boolean;
  /** 当日もう1走のレース番号。1走のみなら null */
  readonly otherRaceNumber: number | null;
  /** 1着〜6着ぶん (昇順、6 要素) */
  readonly ifRanks: readonly TokutenHayamiIfRank[];
};

/** 得点率早見 CSV のレース行 */
export type TokutenHayamiRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  /** 準優進出ラインの人数 (例 18 = 上位18名)。欠損は null */
  readonly borderRank: number | null;
  /** このレースの着順点 (index 0 = 1着)。欠損要素は null */
  readonly rankPoints: readonly (number | null)[];
  readonly racers: readonly TokutenHayamiRacer[];
};
