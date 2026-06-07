/**
 * 近況5節 (programs/recent_national, programs/recent_local) CSV 由来の型定義。
 * 両 CSV はスキーマが完全一致するため同一の型を共用する。
 */

/** 1 艇 × 1 節分の近況成績 */
export type RecentFormSession = {
  /** 節開始日 (YYYY-MM-DD)。データが無い場合は空文字 */
  readonly startDate: string;
  /** 節終了日 (YYYY-MM-DD) */
  readonly endDate: string;
  /** 場コード ("01"-"24") */
  readonly stadiumCode: string;
  /** 場名（全角スペース除去済、例 "鳴門"） */
  readonly stadiumName: string;
  /** グレード（"一般" / "ＧⅢ" / "ＧⅡ" / "ＧⅠ" / "ＳＧ" / "ＰＧ１" など） */
  readonly grade: string;
  /** 着順時系列の生文字列（全角数字・F/L・特殊トークン・全角スペース日区切り） */
  readonly ranks: string;
};

/** 1 艇分の近況5節 */
export type RecentFormBoat = {
  readonly boatNumber: number;
  readonly registrationNumber: number;
  readonly racerName: string;
  /** 前1節〜前5節（index 0 = 前1節 = 最新）。新人で5節未満の場合は末尾が空セッション */
  readonly sessions: readonly RecentFormSession[];
};

/** 近況5節 CSV のレース行 */
export type RecentFormRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  readonly boats: readonly RecentFormBoat[];
};
