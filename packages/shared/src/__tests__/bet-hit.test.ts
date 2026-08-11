import { describe, expect, it } from "vitest";
import type { RaceResultRow } from "../types/race-result.js";
import { checkBettingHit, isBetHit } from "../utils/bet-hit.js";
import type { BetCombo, BettingPicks } from "../utils/one-mark-distance.js";

const makeResult = (top: readonly number[]): RaceResultRow => ({
  raceCode: "202602131912",
  raceDate: "2026-02-13",
  stadiumId: "19",
  raceNumber: 12,
  votingDeadline: "確定",
  fetchedAt: "2026-02-13T12:00:00.000Z",
  recordedAt: "1234",
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

const picks = (
  first: readonly number[],
  second: readonly number[],
  third: readonly number[],
): BettingPicks => ({ kind: "formation", first, second, third });

const comboPicks = (...combos: BetCombo[]): BettingPicks => ({ kind: "combos", combos });

describe("checkBettingHit", () => {
  it("結果未確定の場合は両方 false", () => {
    const status = checkBettingHit(undefined, picks([1], [2], [3]), picks([1], [2], [3]));
    expect(status).toEqual({ dailyHit: false, realtimeHit: false });
  });

  it("3 着までの結果が揃っていなければ的中扱いしない", () => {
    const result = makeResult([1, 2]); // 3 着欠落
    const status = checkBettingHit(result, picks([1], [2], [3]), undefined);
    expect(status.dailyHit).toBe(false);
  });

  it("各着候補に結果艇が含まれれば daily が的中", () => {
    const result = makeResult([1, 4, 5]);
    const status = checkBettingHit(result, picks([1, 2], [3, 4], [5, 6]), undefined);
    expect(status.dailyHit).toBe(true);
    expect(status.realtimeHit).toBe(false);
  });

  it("daily / realtime が独立して判定される", () => {
    const result = makeResult([2, 3, 4]);
    const status = checkBettingHit(
      result,
      picks([1], [3], [4]), // daily: 1 着外す → 不的中
      picks([2], [3], [4]), // realtime: 全一致 → 的中
    );
    expect(status.dailyHit).toBe(false);
    expect(status.realtimeHit).toBe(true);
  });

  it("候補のいずれにも該当しなければ false", () => {
    const result = makeResult([6, 5, 4]);
    const status = checkBettingHit(result, picks([1], [2], [3]), picks([1], [2], [3]));
    expect(status).toEqual({ dailyHit: false, realtimeHit: false });
  });

  it("買い目が undefined のときは false (買い目データ不在)", () => {
    const result = makeResult([1, 2, 3]);
    const status = checkBettingHit(result, undefined, undefined);
    expect(status).toEqual({ dailyHit: false, realtimeHit: false });
  });
});

describe('isBetHit — kind: "combos" (スジ予想 v9_suji)', () => {
  it("出目がリストに含まれていれば的中", () => {
    const picks = comboPicks([3, 1, 4], [3, 4, 5], [3, 5, 2]);
    expect(isBetHit(picks, [3, 4, 5])).toBe(true);
  });

  it("順序が違う出目は的中扱いしない (3連単なので着順が意味を持つ)", () => {
    const picks = comboPicks([3, 1, 4]);
    expect(isBetHit(picks, [3, 4, 1])).toBe(false);
    expect(isBetHit(picks, [1, 3, 4])).toBe(false);
  });

  it("リストに無い出目は外れ", () => {
    const picks = comboPicks([3, 1, 4], [3, 4, 5]);
    expect(isBetHit(picks, [1, 2, 3])).toBe(false);
  });

  it("空の出目リストは常に外れ", () => {
    expect(isBetHit(comboPicks(), [3, 1, 4])).toBe(false);
  });

  it("同着 (同一艇番の重複) は的中扱いしない", () => {
    const picks = comboPicks([3, 3, 4]);
    expect(isBetHit(picks, [3, 3, 4])).toBe(false);
  });

  it("checkBettingHit 経由でも当日 / 直前を別々に判定する", () => {
    const result = makeResult([3, 1, 4]);
    const status = checkBettingHit(result, comboPicks([1, 2, 3]), comboPicks([3, 1, 4]));
    expect(status).toEqual({ dailyHit: false, realtimeHit: true });
  });
});
