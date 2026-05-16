import { describe, expect, it } from "vitest";
import type { RacePayoutRow } from "../types/race-payout.js";
import type { RaceResultRow } from "../types/race-result.js";
import {
  BET_UNIT_YEN,
  aggregateDailyBetPayout,
  computeBetPayout,
  computeRaceBetPayoutSummary,
  countFormationCombinations,
} from "../utils/bet-payout.js";
import type { BettingPicks } from "../utils/one-mark-distance.js";

const picks = (
  first: readonly number[],
  second: readonly number[],
  third: readonly number[],
): BettingPicks => ({ first, second, third });

const makeResult = (top: readonly number[]): RaceResultRow => ({
  raceCode: "202605162112",
  raceDate: "2026-05-16",
  stadiumId: "21",
  raceNumber: 12,
  votingDeadline: "確定",
  fetchedAt: "2026-05-16T20:55:00.000Z",
  recordedAt: "2055",
  kimarite: "",
  finishes: top.map((boatNumber, i) => ({
    rank: i + 1,
    boatNumber,
    racerName: `R${boatNumber}`,
    raceTime: "",
  })),
  courses: [],
  weather: {
    weather: "1",
    windDirection: "",
    windSpeed: 0,
    waveHeight: 0,
    airTemperature: 0,
    waterTemperature: 0,
  },
});

const makePayout = (sanrentanCombo: string, payout: number): RacePayoutRow => ({
  raceCode: "202605162112",
  raceDate: "2026-05-16",
  stadiumId: "21",
  raceNumber: 12,
  votingDeadline: "確定",
  fetchedAt: "2026-05-16T20:55:00.000Z",
  tansho: { boatNumber: 1, payout: 130 },
  fukusho: [
    { boatNumber: 1, payout: 100 },
    { boatNumber: 4, payout: 210 },
  ],
  nirentan: null,
  nirenpuku: null,
  kakurenfuku: [null, null, null],
  sanrentan: { combination: sanrentanCombo, payout, popularity: 8 },
  sanrenpuku: null,
});

describe("countFormationCombinations", () => {
  it("1x1x1 のフォーメーションは 1 点", () => {
    expect(countFormationCombinations(picks([1], [2], [3]))).toBe(1);
  });

  it("2x2x2 から同一艇の重複を除いた組合せ数を返す", () => {
    // {1,2} × {1,2} × {1,2} = 8 通り, 重複除外で 2 通り (1-2-? は 1 を含む, ? は 1/2 以外 → 0)
    // 実際: a≠b≠c≠a を満たすのは (1,2,?) where ? ∉ {1,2} → 0, (2,1,?) where ? ∉ {1,2} → 0
    // 各 first/second から異なる艇を残すと third 候補が空になるので 0
    expect(countFormationCombinations(picks([1, 2], [1, 2], [1, 2]))).toBe(0);
  });

  it("3 艇とも異なる候補があれば 1 点", () => {
    expect(countFormationCombinations(picks([1], [2], [3]))).toBe(1);
  });

  it("first=2 艇のフォーメーション (1,2)x(3)x(4) は 2 点", () => {
    expect(countFormationCombinations(picks([1, 2], [3], [4]))).toBe(2);
  });

  it("空のフォーメーションは 0 点", () => {
    expect(countFormationCombinations(picks([], [2], [3]))).toBe(0);
    expect(countFormationCombinations(picks([1], [], [3]))).toBe(0);
    expect(countFormationCombinations(picks([1], [2], []))).toBe(0);
  });
});

describe("computeBetPayout", () => {
  it("picks 未指定はゼロ結果", () => {
    const r = computeBetPayout(undefined, makeResult([1, 4, 2]), makePayout("1-4-2", 2180));
    expect(r).toEqual({
      betCount: 0,
      betCostYen: 0,
      payoutYen: 0,
      hit: false,
      actualSanrentan: null,
    });
  });

  it("フォーメーションに含まれる出目が確定したら払戻金が乗る", () => {
    const r = computeBetPayout(
      picks([1], [4], [2]),
      makeResult([1, 4, 2]),
      makePayout("1-4-2", 2180),
    );
    expect(r.betCount).toBe(1);
    expect(r.betCostYen).toBe(100);
    expect(r.hit).toBe(true);
    expect(r.payoutYen).toBe(2180);
    expect(r.actualSanrentan?.combination).toBe("1-4-2");
  });

  it("フォーメーションが外れたら payoutYen=0 / hit=false。actualSanrentan は参考表示用に残す", () => {
    const r = computeBetPayout(
      picks([1], [2], [3]),
      makeResult([1, 4, 2]),
      makePayout("1-4-2", 2180),
    );
    expect(r.hit).toBe(false);
    expect(r.payoutYen).toBe(0);
    expect(r.actualSanrentan?.combination).toBe("1-4-2");
  });

  it("結果未確定なら betCount は計上するが payoutYen=0 / hit=false", () => {
    const r = computeBetPayout(picks([1, 2], [3], [4]), undefined, undefined);
    expect(r.betCount).toBe(2);
    expect(r.betCostYen).toBe(2 * BET_UNIT_YEN);
    expect(r.hit).toBe(false);
    expect(r.payoutYen).toBe(0);
    expect(r.actualSanrentan).toBeNull();
  });

  it("payout が無いと hit でも payoutYen=0", () => {
    const r = computeBetPayout(picks([1], [4], [2]), makeResult([1, 4, 2]), undefined);
    expect(r.hit).toBe(true);
    expect(r.payoutYen).toBe(0);
    expect(r.actualSanrentan).toBeNull();
  });
});

describe("computeRaceBetPayoutSummary", () => {
  it("daily / realtime それぞれを独立に計算する", () => {
    const summary = computeRaceBetPayoutSummary(
      picks([1], [4], [2]), // daily 的中
      picks([1], [2], [3]), // realtime 外れ
      makeResult([1, 4, 2]),
      makePayout("1-4-2", 2180),
    );
    expect(summary.daily.hit).toBe(true);
    expect(summary.daily.payoutYen).toBe(2180);
    expect(summary.realtime.hit).toBe(false);
    expect(summary.realtime.payoutYen).toBe(0);
  });
});

describe("aggregateDailyBetPayout", () => {
  it("空配列はゼロ集計", () => {
    expect(aggregateDailyBetPayout([])).toEqual({
      settledRaceCount: 0,
      hitCount: 0,
      totalBetCostYen: 0,
      totalPayoutYen: 0,
      hitRate: 0,
      recoveryRate: 0,
    });
  });

  it("betCount=0 のレースは母数から除外", () => {
    const r1 = computeBetPayout(undefined, undefined, undefined);
    const r2 = computeBetPayout(
      picks([1], [4], [2]),
      makeResult([1, 4, 2]),
      makePayout("1-4-2", 2180),
    );
    const agg = aggregateDailyBetPayout([r1, r2]);
    expect(agg.settledRaceCount).toBe(1);
    expect(agg.hitCount).toBe(1);
    expect(agg.hitRate).toBeCloseTo(1.0);
    expect(agg.totalBetCostYen).toBe(100);
    expect(agg.totalPayoutYen).toBe(2180);
    expect(agg.recoveryRate).toBeCloseTo(21.8);
  });

  it("複数レースの平均的中率・回収率を計算する", () => {
    // 3 レース: 的中 1 回 (¥2,180), 外れ 2 回。各 1 点ベット ¥100 = 合計 ¥300。
    const hit = computeBetPayout(
      picks([1], [4], [2]),
      makeResult([1, 4, 2]),
      makePayout("1-4-2", 2180),
    );
    const miss1 = computeBetPayout(
      picks([1], [2], [3]),
      makeResult([4, 5, 6]),
      makePayout("4-5-6", 5000),
    );
    const miss2 = computeBetPayout(
      picks([2], [3], [4]),
      makeResult([1, 2, 3]),
      makePayout("1-2-3", 1000),
    );
    const agg = aggregateDailyBetPayout([hit, miss1, miss2]);
    expect(agg.settledRaceCount).toBe(3);
    expect(agg.hitCount).toBe(1);
    expect(agg.hitRate).toBeCloseTo(1 / 3);
    expect(agg.totalBetCostYen).toBe(300);
    expect(agg.totalPayoutYen).toBe(2180);
    expect(agg.recoveryRate).toBeCloseTo(2180 / 300);
  });
});
