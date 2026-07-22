import type { RacePrediction } from "@fun-site/shared";
import { describe, expect, it } from "vitest";
import { SERIES_LOOKBACK_DAYS, computeSeriesSummary } from "../site-builder/series-aggregator.js";
import type { SeriesState } from "../site-builder/series-state-store.js";

const makePrediction = (args: {
  raceCode: string;
  stadiumId: string;
  raceNumber: number;
  dayLabel?: string;
  betPayoutRealtime?: {
    betCount: number;
    betCostYen: number;
    payoutYen: number;
    hit: boolean;
  };
}): RacePrediction => ({
  raceCode: args.raceCode,
  raceDate: `${args.raceCode.slice(0, 4)}-${args.raceCode.slice(4, 6)}-${args.raceCode.slice(6, 8)}`,
  stadiumId: args.stadiumId,
  stadiumName: "test",
  raceNumber: args.raceNumber,
  raceName: "general",
  raceTitle: "title",
  dayLabel: args.dayLabel ?? "",
  grade: "",
  votingDeadline: "",
  racers: [],
  startPrediction: { fromExhibition: false, entries: [] },
  aiEvaluation: {
    state: "daily",
    componentKeys: ["waku", "racer", "motor", "exhibit", "weather"],
    entries: [],
  },
  // 集計対象は確定済みレースのみ。1〜3 着が揃う結果を付与する (isSettledResult=true)。
  raceResult: {
    raceCode: args.raceCode,
    raceDate: `${args.raceCode.slice(0, 4)}-${args.raceCode.slice(4, 6)}-${args.raceCode.slice(6, 8)}`,
    stadiumId: args.stadiumId,
    raceNumber: args.raceNumber,
    votingDeadline: "",
    fetchedAt: "",
    recordedAt: "",
    kimarite: "",
    finishes: [
      { rank: 1, boatNumber: 1, racerName: "", raceTime: "" },
      { rank: 2, boatNumber: 2, racerName: "", raceTime: "" },
      { rank: 3, boatNumber: 3, racerName: "", raceTime: "" },
    ],
    courses: [],
    weather: {
      weather: "1",
      windDirection: "北",
      windSpeed: 3,
      waveHeight: 2,
      airTemperature: 20,
      waterTemperature: 20,
    },
  },
  betPayout: args.betPayoutRealtime
    ? {
        daily: {
          betCount: 0,
          betCostYen: 0,
          payoutYen: 0,
          hit: false,
          actualSanrentan: null,
        },
        realtime: {
          ...args.betPayoutRealtime,
          actualSanrentan: null,
        },
      }
    : undefined,
  generatedAt: "2026-05-21T00:00:00.000Z",
});

const emptyState: SeriesState = {
  updatedAt: "2026-05-21T00:00:00.000Z",
  byStadium: {},
};

describe("computeSeriesSummary", () => {
  it("当日のみの予想から 1 日節として集計", () => {
    const predictions = [
      makePrediction({
        raceCode: "202605211201",
        stadiumId: "12",
        raceNumber: 1,
        dayLabel: "初日",
        betPayoutRealtime: { betCount: 1, betCostYen: 100, payoutYen: 2180, hit: true },
      }),
      makePrediction({
        raceCode: "202605211202",
        stadiumId: "12",
        raceNumber: 2,
        dayLabel: "初日",
        betPayoutRealtime: { betCount: 1, betCostYen: 100, payoutYen: 0, hit: false },
      }),
    ];
    const summary = computeSeriesSummary(emptyState, predictions, "2026-05-21");
    const agg = summary.byStadium["12"];
    expect(agg).toBeDefined();
    expect(agg?.dayCount).toBe(1);
    expect(agg?.seriesStartDate).toBe("2026-05-21");
    expect(agg?.settledRaceCount).toBe(2);
    expect(agg?.hitCount).toBe(1);
    expect(agg?.totalPayoutYen).toBe(2180);
    expect(agg?.hitRate).toBeCloseTo(0.5);
    expect(agg?.recoveryRate).toBeCloseTo(2180 / 200);
  });

  it("過去日キャッシュと当日分が合算される", () => {
    const stateWithHistory: SeriesState = {
      updatedAt: "2026-05-20T00:00:00.000Z",
      byStadium: {
        "12": {
          perDay: {
            "2026-05-19": {
              date: "2026-05-19",
              settledRaceCount: 12,
              hitCount: 3,
              totalBetCostYen: 1200,
              totalPayoutYen: 5000,
            },
            "2026-05-20": {
              date: "2026-05-20",
              settledRaceCount: 12,
              hitCount: 2,
              totalBetCostYen: 1200,
              totalPayoutYen: 3000,
            },
          },
          dayLabels: {
            "2026-05-19": "初日",
            "2026-05-20": "2日目",
          },
        },
      },
    };
    const todayPreds = [
      makePrediction({
        raceCode: "202605211201",
        stadiumId: "12",
        raceNumber: 1,
        dayLabel: "3日目",
        betPayoutRealtime: { betCount: 1, betCostYen: 100, payoutYen: 0, hit: false },
      }),
      makePrediction({
        raceCode: "202605211202",
        stadiumId: "12",
        raceNumber: 2,
        dayLabel: "3日目",
        betPayoutRealtime: { betCount: 1, betCostYen: 100, payoutYen: 2180, hit: true },
      }),
    ];
    const summary = computeSeriesSummary(stateWithHistory, todayPreds, "2026-05-21");
    const agg = summary.byStadium["12"];
    expect(agg?.dayCount).toBe(3);
    expect(agg?.seriesStartDate).toBe("2026-05-19");
    expect(agg?.seriesEndDate).toBe("2026-05-21");
    // 12 + 12 + 2 = 26
    expect(agg?.settledRaceCount).toBe(26);
    // 3 + 2 + 1 = 6
    expect(agg?.hitCount).toBe(6);
    // 5000 + 3000 + 2180 = 10180
    expect(agg?.totalPayoutYen).toBe(10180);
    // 1200 + 1200 + 200 = 2600
    expect(agg?.totalBetCostYen).toBe(2600);
  });

  it("過去のキャッシュに「初日」より前の日があっても、初日マーカーで止まる", () => {
    const state: SeriesState = {
      updatedAt: "",
      byStadium: {
        "12": {
          perDay: {
            "2026-05-15": {
              date: "2026-05-15",
              settledRaceCount: 12,
              hitCount: 99,
              totalBetCostYen: 1200,
              totalPayoutYen: 999999,
            },
            "2026-05-20": {
              date: "2026-05-20",
              settledRaceCount: 12,
              hitCount: 1,
              totalBetCostYen: 1200,
              totalPayoutYen: 2000,
            },
          },
          dayLabels: {
            "2026-05-15": "最終日",
            "2026-05-20": "初日",
          },
        },
      },
    };
    const todayPreds = [
      makePrediction({
        raceCode: "202605211201",
        stadiumId: "12",
        raceNumber: 1,
        dayLabel: "2日目",
        betPayoutRealtime: { betCount: 1, betCostYen: 100, payoutYen: 0, hit: false },
      }),
    ];
    const summary = computeSeriesSummary(state, todayPreds, "2026-05-21");
    const agg = summary.byStadium["12"];
    // 前節の 5/15 は除外され、5/20 (初日) と 5/21 のみ
    expect(agg?.dayCount).toBe(2);
    expect(agg?.seriesStartDate).toBe("2026-05-20");
    expect(agg?.settledRaceCount).toBe(13);
    expect(agg?.hitCount).toBe(1);
  });

  it("当日開催の無い会場は byStadium に含めない", () => {
    const state: SeriesState = {
      updatedAt: "",
      byStadium: {
        "12": {
          perDay: {
            "2026-05-20": {
              date: "2026-05-20",
              settledRaceCount: 12,
              hitCount: 2,
              totalBetCostYen: 1200,
              totalPayoutYen: 3000,
            },
          },
          dayLabels: { "2026-05-20": "最終日" },
        },
      },
    };
    // 当日の predictions は空 = 12 場の開催無し
    const summary = computeSeriesSummary(state, [], "2026-05-21");
    expect(summary.byStadium["12"]).toBeUndefined();
  });

  it("SERIES_LOOKBACK_DAYS は 7", () => {
    expect(SERIES_LOOKBACK_DAYS).toBe(7);
  });

  it("予想者別 predictions[] が指定されると byPredictor に分解集計される", () => {
    // 同レースで v1_basic は的中、v2_tenkai は外れた、というシナリオ。
    // primary (= top-level betPayout.realtime) は A君と同じ値、byPredictor に
    // 両者ぶんが入ることを確認する。
    const pred: RacePrediction = {
      raceCode: "202605211201",
      raceDate: "2026-05-21",
      stadiumId: "12",
      stadiumName: "test",
      raceNumber: 1,
      raceName: "general",
      raceTitle: "title",
      dayLabel: "初日",
      grade: "",
      votingDeadline: "",
      racers: [],
      startPrediction: { fromExhibition: false, entries: [] },
      aiEvaluation: {
        state: "daily",
        componentKeys: ["waku", "racer", "motor", "exhibit", "weather"],
        entries: [],
      },
      // 確定済みレース (1〜3 着が揃う) = 集計対象。
      raceResult: {
        raceCode: "202605211201",
        raceDate: "2026-05-21",
        stadiumId: "12",
        raceNumber: 1,
        votingDeadline: "",
        fetchedAt: "",
        recordedAt: "",
        kimarite: "",
        finishes: [
          { rank: 1, boatNumber: 1, racerName: "", raceTime: "" },
          { rank: 2, boatNumber: 2, racerName: "", raceTime: "" },
          { rank: 3, boatNumber: 3, racerName: "", raceTime: "" },
        ],
        courses: [],
        weather: {
          weather: "1",
          windDirection: "北",
          windSpeed: 3,
          waveHeight: 2,
          airTemperature: 20,
          waterTemperature: 20,
        },
      },
      betPayout: {
        daily: {
          betCount: 0,
          betCostYen: 0,
          payoutYen: 0,
          hit: false,
          actualSanrentan: null,
        },
        realtime: {
          betCount: 1,
          betCostYen: 100,
          payoutYen: 2180,
          hit: true,
          actualSanrentan: null,
        },
      },
      predictions: [
        {
          predictorId: "v1_basic",
          predictorName: "A君予想",
          slot: 1,
          betPayout: {
            daily: {
              betCount: 0,
              betCostYen: 0,
              payoutYen: 0,
              hit: false,
              actualSanrentan: null,
            },
            realtime: {
              betCount: 1,
              betCostYen: 100,
              payoutYen: 2180,
              hit: true,
              actualSanrentan: null,
            },
          },
          betHitStatus: { dailyHit: false, realtimeHit: true },
        },
        {
          predictorId: "v2_tenkai",
          predictorName: "B君予想",
          slot: 2,
          betPayout: {
            daily: {
              betCount: 0,
              betCostYen: 0,
              payoutYen: 0,
              hit: false,
              actualSanrentan: null,
            },
            realtime: {
              betCount: 2,
              betCostYen: 200,
              payoutYen: 0,
              hit: false,
              actualSanrentan: null,
            },
          },
          betHitStatus: { dailyHit: false, realtimeHit: false },
        },
      ],
      generatedAt: "2026-05-21T00:00:00.000Z",
    };
    const summary = computeSeriesSummary(emptyState, [pred], "2026-05-21");
    const agg = summary.byStadium["12"];
    expect(agg).toBeDefined();
    // 旧 UI / primary は A君と同じ
    expect(agg?.settledRaceCount).toBe(1);
    expect(agg?.hitCount).toBe(1);
    expect(agg?.recoveryRate).toBeCloseTo(2180 / 100);
    // byPredictor が埋まる
    expect(agg?.byPredictor).toBeDefined();
    expect(agg?.byPredictor?.v1_basic?.hitCount).toBe(1);
    expect(agg?.byPredictor?.v1_basic?.recoveryRate).toBeCloseTo(2180 / 100);
    expect(agg?.byPredictor?.v2_tenkai?.hitCount).toBe(0);
    expect(agg?.byPredictor?.v2_tenkai?.totalBetCostYen).toBe(200);
    expect(agg?.byPredictor?.v2_tenkai?.recoveryRate).toBe(0);
  });
});
