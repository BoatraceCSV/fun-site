/**
 * 枠番別過去10走 (programs/waku10) CSV 由来の型定義。
 * 各選手が **今回と同じ枠番** で出走した直近10走と、その枠番での集計値を持つ。
 */

/** 1 艇 × 1 走分の過去成績 */
export type Waku10Run = {
  /**
   * 着順トークン。"1"〜"6" / "F" / "L" / "欠" / "落" / "沈" / "転" / "不" / "エ" /
   * "失" / "妨"（上流で半角化済み）。出走歴が 10 走に満たないスロットは空文字。
   */
  readonly rank: string;
  /**
   * 実際の進入コース (1-6)。**CSV が空欄なら枠なり進入**なので 0 を入れる
   * （表示側で枠番に読み替える）。
   */
  readonly entryCourse: number;
  /** そのレースのグレード ("IP" / "G3" / "G2" / "G1" / "SG")。空スロットは空文字 */
  readonly grade: string;
};

/** 1 艇分の枠番別過去10走 */
export type Waku10Boat = {
  readonly boatNumber: number;
  /** 選手名（waku10 CSV は登録番号を持たないため、突合は艇番で行う） */
  readonly racerName: string;
  /** この枠番での勝率 */
  readonly winRate: number;
  /** この枠番での平均ST */
  readonly avgST: number;
  /** この枠番での平均スタート順 (1.0〜6.0) */
  readonly avgStartOrder: number;
  /** 過去1走 (前走) → 過去10走 (最も古い) の順。10 スロット固定 */
  readonly runs: readonly Waku10Run[];
};

/** 枠番別過去10走 CSV のレース行 */
export type Waku10Row = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  readonly boats: readonly Waku10Boat[];
};
