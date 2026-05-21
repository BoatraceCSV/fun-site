import { describe, expect, it } from "vitest";
import type { RacePayoutRow } from "../types/race-payout.js";
import type { RaceResultRow } from "../types/race-result.js";
import {
  type BetPayoutResult,
  aggregateDailyBetPayout,
  computeBetPayout,
} from "../utils/bet-payout.js";
import type { BettingPicks } from "../utils/one-mark-distance.js";
import {
  type DailyBetPayoutSnapshot,
  type SeriesDayInfo,
  aggregateSeriesBetPayout,
  buildDailySnapshot,
  detectSeries,
  toDailySnapshot,
} from "../utils/series.js";

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

const buildPerDay = (entries: readonly SeriesDayInfo[]): Map<string, SeriesDayInfo> => {
  const map = new Map<string, SeriesDayInfo>();
  for (const e of entries) map.set(e.date, e);
  return map;
};

describe("detectSeries", () => {
  it("当日が perDay に無ければ null", () => {
    const perDay = buildPerDay([{ date: "2026-05-20", dayLabel: "初日" }]);
    expect(detectSeries(perDay, "2026-05-21", 7)).toBeNull();
  });

  it("当日のみ存在 → 1 日の節として返す", () => {
    const perDay = buildPerDay([{ date: "2026-05-21", dayLabel: "初日" }]);
    const r = detectSeries(perDay, "2026-05-21", 7);
    expect(r).toEqual({
      startDate: "2026-05-21",
      endDate: "2026-05-21",
      dayCount: 1,
      dates: ["2026-05-21"],
    });
  });

  it("連続した日を遡る (上限内)", () => {
    const perDay = buildPerDay([
      { date: "2026-05-15", dayLabel: "初日" },
      { date: "2026-05-16", dayLabel: "2日目" },
      { date: "2026-05-17", dayLabel: "3日目" },
      { date: "2026-05-18", dayLabel: "4日目" },
      { date: "2026-05-19", dayLabel: "5日目" },
      { date: "2026-05-20", dayLabel: "6日目" },
      { date: "2026-05-21", dayLabel: "最終日" },
    ]);
    const r = detectSeries(perDay, "2026-05-21", 7);
    expect(r?.dayCount).toBe(7);
    expect(r?.startDate).toBe("2026-05-15");
    expect(r?.endDate).toBe("2026-05-21");
    expect(r?.dates).toEqual([
      "2026-05-15",
      "2026-05-16",
      "2026-05-17",
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
    ]);
  });

  it("「初日」マーカーで遡りを止める", () => {
    // 過去日として「初日」より前の日も perDay に入っているが、初日で停止する
    const perDay = buildPerDay([
      { date: "2026-05-10", dayLabel: "最終日" },
      { date: "2026-05-15", dayLabel: "初日" },
      { date: "2026-05-16", dayLabel: "2日目" },
      { date: "2026-05-17", dayLabel: "3日目" },
    ]);
    const r = detectSeries(perDay, "2026-05-17", 30);
    expect(r?.dates).toEqual(["2026-05-15", "2026-05-16", "2026-05-17"]);
  });

  it("中休み (=会場開催なし) で遡りを止める", () => {
    // 5/18 が抜けているので 5/19-5/21 だけが今節
    const perDay = buildPerDay([
      { date: "2026-05-15", dayLabel: "初日" },
      { date: "2026-05-16", dayLabel: "2日目" },
      { date: "2026-05-17", dayLabel: "3日目" },
      { date: "2026-05-19", dayLabel: "初日" },
      { date: "2026-05-20", dayLabel: "2日目" },
      { date: "2026-05-21", dayLabel: "3日目" },
    ]);
    const r = detectSeries(perDay, "2026-05-21", 7);
    expect(r?.dates).toEqual(["2026-05-19", "2026-05-20", "2026-05-21"]);
  });

  it("lookbackDays 上限で強制停止", () => {
    const perDay = buildPerDay([
      { date: "2026-05-15", dayLabel: "1日目" },
      { date: "2026-05-16", dayLabel: "2日目" },
      { date: "2026-05-17", dayLabel: "3日目" },
      { date: "2026-05-18", dayLabel: "4日目" },
      { date: "2026-05-19", dayLabel: "5日目" },
      { date: "2026-05-20", dayLabel: "6日目" },
      { date: "2026-05-21", dayLabel: "7日目" },
    ]);
    // 上限 3 日なら直近 3 日のみ
    const r = detectSeries(perDay, "2026-05-21", 3);
    expect(r?.dates).toEqual(["2026-05-19", "2026-05-20", "2026-05-21"]);
  });

  it("dayLabel が空文字でも開催の有無のみで判定する (古い JSON 互換)", () => {
    const perDay = buildPerDay([
      { date: "2026-05-19", dayLabel: "" },
      { date: "2026-05-20", dayLabel: "" },
      { date: "2026-05-21", dayLabel: "" },
    ]);
    const r = detectSeries(perDay, "2026-05-21", 7);
    expect(r?.dates).toEqual(["2026-05-19", "2026-05-20", "2026-05-21"]);
  });

  it("無効な日付はエラー", () => {
    const perDay = buildPerDay([{ date: "2026-05-21", dayLabel: "" }]);
    expect(() => detectSeries(perDay, "invalid", 7)).toThrow();
  });

  it("lookbackDays < 1 はエラー", () => {
    const perDay = buildPerDay([{ date: "2026-05-21", dayLabel: "" }]);
    expect(() => detectSeries(perDay, "2026-05-21", 0)).toThrow();
  });
});

describe("toDailySnapshot / buildDailySnapshot", () => {
  it("DailyBetPayoutAggregate から合計値のみのスナップショットを作る", () => {
    const r: BetPayoutResult = computeBetPayout(
      picks([1], [4], [2]),
      makeResult([1, 4, 2]),
      makePayout("1-4-2", 2180),
    );
    const agg = aggregateDailyBetPayout([r]);
    const snap = toDailySnapshot("2026-05-21", agg);
    expect(snap).toEqual({
      date: "2026-05-21",
      settledRaceCount: 1,
      hitCount: 1,
      totalBetCostYen: 100,
      totalPayoutYen: 2180,
    });
    // hitRate / recoveryRate がスナップショットには含まれないことを確認
    expect((snap as unknown as { hitRate?: number }).hitRate).toBeUndefined();
  });

  it("buildDailySnapshot は results -> aggregate -> snapshot のショートカット", () => {
    const r = computeBetPayout(
      picks([1], [4], [2]),
      makeResult([1, 4, 2]),
      makePayout("1-4-2", 2180),
    );
    const snap = buildDailySnapshot("2026-05-21", [r]);
    expect(snap.totalPayoutYen).toBe(2180);
  });
});

describe("aggregateSeriesBetPayout", () => {
  const series = {
    startDate: "2026-05-19",
    endDate: "2026-05-21",
    dayCount: 3,
    dates: ["2026-05-19", "2026-05-20", "2026-05-21"] as const,
  };

  it("空スナップショットはゼロ集計", () => {
    const agg = aggregateSeriesBetPayout(series, []);
    expect(agg.settledRaceCount).toBe(0);
    expect(agg.hitCount).toBe(0);
    expect(agg.hitRate).toBe(0);
    expect(agg.recoveryRate).toBe(0);
    expect(agg.dayCount).toBe(3);
  });

  it("series.dates の各日のスナップショットを合算する", () => {
    const snapshots: DailyBetPayoutSnapshot[] = [
      {
        date: "2026-05-19",
        settledRaceCount: 12,
        hitCount: 2,
        totalBetCostYen: 1200,
        totalPayoutYen: 4000,
      },
      {
        date: "2026-05-20",
        settledRaceCount: 12,
        hitCount: 1,
        totalBetCostYen: 1200,
        totalPayoutYen: 1500,
      },
      {
        date: "2026-05-21",
        settledRaceCount: 6,
        hitCount: 1,
        totalBetCostYen: 600,
        totalPayoutYen: 2180,
      },
    ];
    const agg = aggregateSeriesBetPayout(series, snapshots);
    expect(agg.settledRaceCount).toBe(30);
    expect(agg.hitCount).toBe(4);
    expect(agg.totalBetCostYen).toBe(3000);
    expect(agg.totalPayoutYen).toBe(7680);
    expect(agg.hitRate).toBeCloseTo(4 / 30);
    expect(agg.recoveryRate).toBeCloseTo(7680 / 3000);
  });

  it("series.dates に含まれない日は無視", () => {
    const snapshots: DailyBetPayoutSnapshot[] = [
      {
        date: "2026-05-18", // 節外
        settledRaceCount: 12,
        hitCount: 5,
        totalBetCostYen: 1200,
        totalPayoutYen: 99999,
      },
      {
        date: "2026-05-21",
        settledRaceCount: 6,
        hitCount: 1,
        totalBetCostYen: 600,
        totalPayoutYen: 2180,
      },
    ];
    const agg = aggregateSeriesBetPayout(series, snapshots);
    expect(agg.settledRaceCount).toBe(6);
    expect(agg.hitCount).toBe(1);
    expect(agg.totalPayoutYen).toBe(2180);
  });

  it("hitRate / recoveryRate は合算値から再計算 (日次平均ではない)", () => {
    // day A: 1/2 = 50%, day B: 0/8 = 0% → 単純平均だと 25% だが、母数加重で 1/10 = 10%
    const snapshots: DailyBetPayoutSnapshot[] = [
      {
        date: "2026-05-19",
        settledRaceCount: 2,
        hitCount: 1,
        totalBetCostYen: 200,
        totalPayoutYen: 500,
      },
      {
        date: "2026-05-20",
        settledRaceCount: 8,
        hitCount: 0,
        totalBetCostYen: 800,
        totalPayoutYen: 0,
      },
    ];
    const partialSeries = {
      startDate: "2026-05-19",
      endDate: "2026-05-20",
      dayCount: 2,
      dates: ["2026-05-19", "2026-05-20"] as const,
    };
    const agg = aggregateSeriesBetPayout(partialSeries, snapshots);
    expect(agg.hitRate).toBeCloseTo(1 / 10);
    expect(agg.recoveryRate).toBeCloseTo(500 / 1000);
  });
});
