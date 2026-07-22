import type { RaceResultRow } from "../types/race-result.js";
import type { BettingPicks } from "./one-mark-distance.js";
import { extractTopThree } from "./race-result.js";

/**
 * 買い目の的中状態。
 * - dailyHit: 当日買い目（朝バッチ・直前情報反映前）の三連単フォーメーションが的中
 * - realtimeHit: 直前買い目（直前情報反映後）の三連単フォーメーションが的中
 *
 * 結果が未確定 / 1〜3 着が揃っていない場合はいずれも false。
 */
export type BetHitStatus = {
  readonly dailyHit: boolean;
  readonly realtimeHit: boolean;
};

const BET_HIT_STATUS_NONE: BetHitStatus = { dailyHit: false, realtimeHit: false };

/**
 * 三連単フォーメーション（買い目の `first` × `second` × `third`）が
 * 結果の 1-2-3 着と一致しているかを判定する。
 * - 各着の候補リストに該当艇番が含まれていれば的中
 * - ただし 1-2-3 着で同一艇番を重複して使うのは（実際の出目として有り得ないので）的中扱いにしない
 */
const isFormationHit = (
  picks: BettingPicks,
  topThree: readonly [number, number, number],
): boolean => {
  const [a, b, c] = topThree;
  if (a === b || b === c || a === c) return false;
  return picks.first.includes(a) && picks.second.includes(b) && picks.third.includes(c);
};

/**
 * 当日買い目 / 直前買い目それぞれの的中状況を判定する。
 *
 * @param result      レース結果。undefined のとき（未確定）は両方 false。
 * @param dailyPicks  当日買い目（朝バッチ時点の AI 評価から導出した買い目）
 * @param realtimePicks 直前買い目（直前情報反映後の AI 評価から導出した買い目）
 */
export const checkBettingHit = (
  result: RaceResultRow | undefined,
  dailyPicks: BettingPicks | undefined,
  realtimePicks: BettingPicks | undefined,
): BetHitStatus => {
  if (!result) return BET_HIT_STATUS_NONE;
  const topThree = extractTopThree(result);
  if (!topThree) return BET_HIT_STATUS_NONE;
  return {
    dailyHit: dailyPicks ? isFormationHit(dailyPicks, topThree) : false,
    realtimeHit: realtimePicks ? isFormationHit(realtimePicks, topThree) : false,
  };
};
