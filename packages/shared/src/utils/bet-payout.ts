import type { CombinationPayout, RacePayoutRow } from "../types/race-payout.js";
import type { RaceResultRow } from "../types/race-result.js";
import type { BettingPicks } from "./one-mark-distance.js";

/** 1 点あたりの賭け金 (円)。回収率算出の母数に使う。 */
export const BET_UNIT_YEN = 100 as const;

/**
 * 三連単フォーメーション内の「実際に賭ける組合せ数」を数える。
 *
 * `first × second × third` の積から、同一艇番を 2 度以上使う組合せ
 * （1着 = 2着 / 2着 = 3着 / 1着 = 3着）を除外する。これは
 * `bet-hit.ts` の `isFormationHit` と同じ「実出目として有り得ない」
 * 制約に揃えるためで、1 点 ¥100 賭けの総コストを過大評価しない。
 */
export const countFormationCombinations = (picks: BettingPicks): number => {
  const { first, second, third } = picks;
  if (first.length === 0 || second.length === 0 || third.length === 0) return 0;
  let total = 0;
  for (const a of first) {
    for (const b of second) {
      if (a === b) continue;
      for (const c of third) {
        if (c === a || c === b) continue;
        total += 1;
      }
    }
  }
  return total;
};

/**
 * 3連単 1 レース分の集計。
 *
 * - `betCount` = フォーメーションに含まれる組合せ数（1 点 ¥100 で買う前提）
 * - `betCostYen` = `betCount * BET_UNIT_YEN`
 * - `payoutYen` = 的中時のみ 3連単_払戻金、外れ / 未確定なら 0
 * - `hit` = フォーメーション内に actual 1-2-3 着の出目が含まれるか
 * - `actualSanrentan` = 実際の 3連単 払戻情報（参考表示用）。未確定なら null
 */
export type BetPayoutResult = {
  readonly betCount: number;
  readonly betCostYen: number;
  readonly payoutYen: number;
  readonly hit: boolean;
  readonly actualSanrentan: CombinationPayout | null;
};

const ZERO_RESULT: BetPayoutResult = {
  betCount: 0,
  betCostYen: 0,
  payoutYen: 0,
  hit: false,
  actualSanrentan: null,
};

/** 1〜3 着が揃っていれば `[1着, 2着, 3着]` を返す（ヘルパ） */
const extractTopThree = (result: RaceResultRow): readonly [number, number, number] | undefined => {
  const byRank = new Map<number, number>(
    result.finishes.map((f) => [f.rank, f.boatNumber] as const),
  );
  const first = byRank.get(1);
  const second = byRank.get(2);
  const third = byRank.get(3);
  if (first === undefined || second === undefined || third === undefined) return undefined;
  return [first, second, third] as const;
};

/** フォーメーション内に `[1着, 2着, 3着]` が含まれるか（同着除外） */
const formationContains = (
  picks: BettingPicks,
  topThree: readonly [number, number, number],
): boolean => {
  const [a, b, c] = topThree;
  if (a === b || b === c || a === c) return false;
  return picks.first.includes(a) && picks.second.includes(b) && picks.third.includes(c);
};

/**
 * 1 レース × 1 フォーメーションの 3連単 ベット結果を計算する。
 *
 * 払戻金は `payout?.sanrentan?.payout` を採用する。`payout` が無い、または
 * `sanrentan` が空のレースは未確定とみなし `payoutYen = 0` / `hit = false`。
 * `result` が無い場合も同様（着順未着）。
 *
 * `picks` が未指定の場合は全フィールド 0 のゼロ結果を返す（買い目を計算
 * できない state=daily 未到来などのケース）。
 */
export const computeBetPayout = (
  picks: BettingPicks | undefined,
  result: RaceResultRow | undefined,
  payout: RacePayoutRow | undefined,
): BetPayoutResult => {
  if (!picks) return ZERO_RESULT;
  const betCount = countFormationCombinations(picks);
  const betCostYen = betCount * BET_UNIT_YEN;
  if (betCount === 0) {
    return {
      betCount,
      betCostYen,
      payoutYen: 0,
      hit: false,
      actualSanrentan: payout?.sanrentan ?? null,
    };
  }
  if (!result) {
    return {
      betCount,
      betCostYen,
      payoutYen: 0,
      hit: false,
      actualSanrentan: payout?.sanrentan ?? null,
    };
  }
  const topThree = extractTopThree(result);
  const hit = topThree ? formationContains(picks, topThree) : false;
  const sanrentan = payout?.sanrentan ?? null;
  const payoutYen = hit && sanrentan ? sanrentan.payout : 0;
  return {
    betCount,
    betCostYen,
    payoutYen,
    hit,
    actualSanrentan: sanrentan,
  };
};

/** レース単位の「当日 / 直前」両方の 3連単 ベット結果。 */
export type RaceBetPayoutSummary = {
  readonly daily: BetPayoutResult;
  readonly realtime: BetPayoutResult;
};

const ZERO_SUMMARY: RaceBetPayoutSummary = {
  daily: ZERO_RESULT,
  realtime: ZERO_RESULT,
};

/**
 * A君直前買い目 / B君直前買い目それぞれの 3連単 ベット結果を一括計算する。
 */
export const computeRaceBetPayoutSummary = (
  dailyPicks: BettingPicks | undefined,
  realtimePicks: BettingPicks | undefined,
  result: RaceResultRow | undefined,
  payout: RacePayoutRow | undefined,
): RaceBetPayoutSummary => {
  if (!(dailyPicks || realtimePicks)) return ZERO_SUMMARY;
  return {
    daily: computeBetPayout(dailyPicks, result, payout),
    realtime: computeBetPayout(realtimePicks, result, payout),
  };
};

/** 当日 1 日分の 3連単 戦略集計。`daily` / `realtime` 別に持つ。 */
export type DailyBetPayoutAggregate = {
  /** 結果が確定したレース数（母数）。 */
  readonly settledRaceCount: number;
  /** 的中したレース数。 */
  readonly hitCount: number;
  /** 賭け金合計 (円)。 */
  readonly totalBetCostYen: number;
  /** 払戻合計 (円)。 */
  readonly totalPayoutYen: number;
  /**
   * 的中率 = `hitCount / settledRaceCount` (0-1)。母数 0 のときは 0。
   * UI 側で 100 倍してパーセント表示する。
   */
  readonly hitRate: number;
  /**
   * 回収率 = `totalPayoutYen / totalBetCostYen` (0 ~ ∞)。母数 0 のときは 0。
   * UI 側で 100 倍してパーセント表示する。
   */
  readonly recoveryRate: number;
};

const ZERO_AGGREGATE: DailyBetPayoutAggregate = {
  settledRaceCount: 0,
  hitCount: 0,
  totalBetCostYen: 0,
  totalPayoutYen: 0,
  hitRate: 0,
  recoveryRate: 0,
};

/**
 * 1 日分 (= 締切済み 全レース) の `BetPayoutResult` 配列から集計を生成する。
 *
 * `betCount === 0` のレース（フォーメーションが計算できない / 結果未確定）は
 * 母数 (`settledRaceCount`) にも分子 (`hitCount` / `totalPayoutYen`) にも
 * 含めない。これにより「A君直前買い目しか出ていないが B君直前は未取得」のケースで
 * B君直前側の母数が水増しされない。
 */
export const aggregateDailyBetPayout = (
  results: readonly BetPayoutResult[],
): DailyBetPayoutAggregate => {
  const settled = results.filter((r) => r.betCount > 0);
  if (settled.length === 0) return ZERO_AGGREGATE;
  let hits = 0;
  let cost = 0;
  let payout = 0;
  for (const r of settled) {
    if (r.hit) hits += 1;
    cost += r.betCostYen;
    payout += r.payoutYen;
  }
  return {
    settledRaceCount: settled.length,
    hitCount: hits,
    totalBetCostYen: cost,
    totalPayoutYen: payout,
    hitRate: hits / settled.length,
    recoveryRate: cost > 0 ? payout / cost : 0,
  };
};
