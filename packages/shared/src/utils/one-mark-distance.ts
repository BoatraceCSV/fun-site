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

/**
 * 買い目の着順別しきい値（±許容幅）。
 * 各着候補は「基準艇の距離 ± 当該しきい値」以内の艇で構成する。
 */
export type BettingTolerance = {
  /** 1着候補のしきい値 */
  readonly first: number;
  /** 2着候補のしきい値 */
  readonly second: number;
  /** 3着候補のしきい値 */
  readonly third: number;
};

/** 既定のしきい値（経験則の ±0.10。全着順共通）。 */
export const DEFAULT_BETTING_TOLERANCE: BettingTolerance = {
  first: 0.1,
  second: 0.1,
  third: 0.1,
};

/**
 * 予想者 ID ごとのしきい値オーバーライド。未登録の予想者は
 * `DEFAULT_BETTING_TOLERANCE`（±0.10）を使う。
 *
 * - `v2_tenkai`（B君予想）: 2026-05 の A君(v1_basic)実績を用いた回収率最適化の
 *   ロバスト解 `1着0.02 / 2着0.10 / 3着0.20`。「1着は絞り 3着は広げる」方向。
 *   B君固有データが十分溜まったら再探索すること
 *   （`notebooks/threshold_optimization.ipynb`）。
 */
export const BETTING_TOLERANCE_BY_PREDICTOR: Readonly<Record<string, BettingTolerance>> = {
  v2_tenkai: { first: 0.02, second: 0.1, third: 0.2 },
};

/** 予想者 ID に対応するしきい値を返す。未登録／未指定なら既定値。 */
export const bettingToleranceFor = (predictorId?: string): BettingTolerance =>
  (predictorId && BETTING_TOLERANCE_BY_PREDICTOR[predictorId]) || DEFAULT_BETTING_TOLERANCE;

/**
 * 走行距離から買い目（三連単フォーメーションの候補）を導出する。
 * - 1着候補: 距離が最大の艇の距離 ± `tolerance.first` 以内
 * - 2着候補: 距離降順で2番目の艇の距離 ± `tolerance.second` 以内
 * - 3着候補: 距離降順で3番目の艇の距離 ± `tolerance.third` 以内
 * 各候補リストは艇番昇順。
 *
 * `tolerance` 省略時は `DEFAULT_BETTING_TOLERANCE`（±0.10）。予想者ごとに
 * 変える場合は `bettingToleranceFor(predictorId)` を渡す。
 */
export const computeBettingPicks = (
  entries: readonly OneMarkDistanceEntry[],
  tolerance: BettingTolerance = DEFAULT_BETTING_TOLERANCE,
): BettingPicks => {
  const sortedDesc = [...entries].sort((a, b) => b.distance - a.distance);

  const pickWithin = (reference: number | undefined, tol: number): readonly number[] => {
    if (reference === undefined) return [];
    return entries
      .filter((e) => Math.abs(e.distance - reference) <= tol + 1e-9)
      .map((e) => e.boatNumber)
      .sort((a, b) => a - b);
  };

  return {
    first: pickWithin(sortedDesc[0]?.distance, tolerance.first),
    second: pickWithin(sortedDesc[1]?.distance, tolerance.second),
    third: pickWithin(sortedDesc[2]?.distance, tolerance.third),
  };
};
