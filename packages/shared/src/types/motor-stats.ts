/**
 * モーター期成績 (programs/motor_stats) CSV 由来の型定義。
 * `(記録日, 場コード, モーター番号)` を主キーとする 1 モーター 1 行のスナップショット。
 * 当日開催のある場のみ収録（24 場中 ~14-16 場）。
 */
export type MotorStatsRow = {
  /** スナップショット取得日 (YYYY-MM-DD) */
  readonly recordDate: string;
  /** モーター期起算日 (YYYY-MM-DD) */
  readonly periodStartDate: string;
  /** 場コード ("01"-"24") */
  readonly stadiumCode: string;
  /** 物理モーター番号 */
  readonly motorNumber: number;
  /** 勝率 */
  readonly winRate: number;
  /** 2連対率 (%) */
  readonly top2Rate: number;
  /** 3連対率 (%) */
  readonly top3Rate: number;
  /** 3連対率順位（1 位が最高） */
  readonly top3Rank: number;
  /** 1着回数 */
  readonly firstCount: number;
  /** 当該モーター期の総出走回数 */
  readonly starts: number;
  /** 優勝回数 */
  readonly championCount: number;
  /** 優出回数（優勝戦出場） */
  readonly finalAppearances: number;
  /** 平均ラップ秒。連対実績ゼロのモーターは空 → null */
  readonly avgLapSec: number | null;
  /** 平均ラップ順位（値が小さい=ラップが短いほど上位）。空 → null */
  readonly avgLapRank: number | null;
};
