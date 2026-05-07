import type { AiEvaluation, RaceRacer } from "../types/prediction.js";

/** 1艇分の走行距離計算結果 */
export type OneMarkDistanceEntry = {
  readonly boatNumber: number;
  readonly avgST: number;
  readonly strengthPt: number;
  /** 走行距離 = (1 - 平均ST) + 強さpt / 50 - 1.6 */
  readonly distance: number;
};

/**
 * 1マーク予想の走行距離を全艇分計算する。
 * distance = (1 - 全国平均ST) + 強さpt / 50 - 1.6
 */
export const computeOneMarkDistances = (
  racers: readonly RaceRacer[],
  aiEvaluation: AiEvaluation,
): readonly OneMarkDistanceEntry[] => {
  const aiByBoat = new Map(aiEvaluation.entries.map((e) => [e.boatNumber, e]));
  return racers.map((racer) => {
    const ai = aiByBoat.get(racer.boatNumber);
    const avgST = racer.nationalAvgST ?? 0;
    const strengthPt = ai?.strengthPt ?? 0;
    const distance = 1 - avgST + strengthPt / 50 - 1.6;
    return { boatNumber: racer.boatNumber, avgST, strengthPt, distance };
  });
};

/** 買い目（フォーメーション） - 各着順の候補艇番リスト */
export type BettingPicks = {
  /** 1着候補: 距離が最大の艇の距離 ±0.1 以内（艇番昇順） */
  readonly first: readonly number[];
  /** 2着候補: 距離降順で2位の艇の距離 ±0.1 以内（艇番昇順） */
  readonly second: readonly number[];
  /** 3着候補: 距離降順で3位の艇の距離 ±0.1 以内（艇番昇順） */
  readonly third: readonly number[];
};

const TOLERANCE = 0.1;

/**
 * 走行距離から買い目（三連単フォーメーションの候補）を導出する。
 * - 1着候補: 距離が最大の艇の距離 ±0.1 以内
 * - 2着候補: 距離降順で2番目の艇の距離 ±0.1 以内
 * - 3着候補: 距離降順で3番目の艇の距離 ±0.1 以内
 * 各候補リストは艇番昇順。
 */
export const computeBettingPicks = (entries: readonly OneMarkDistanceEntry[]): BettingPicks => {
  const sortedDesc = [...entries].sort((a, b) => b.distance - a.distance);

  const pickWithin = (reference: number | undefined): readonly number[] => {
    if (reference === undefined) return [];
    return entries
      .filter((e) => Math.abs(e.distance - reference) <= TOLERANCE + 1e-9)
      .map((e) => e.boatNumber)
      .sort((a, b) => a - b);
  };

  return {
    first: pickWithin(sortedDesc[0]?.distance),
    second: pickWithin(sortedDesc[1]?.distance),
    third: pickWithin(sortedDesc[2]?.distance),
  };
};
