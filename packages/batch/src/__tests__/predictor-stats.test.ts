import type { RacePrediction, RaceResultRow } from "@fun-site/shared";
import { describe, expect, it } from "vitest";
import { aggregatePredictorStats } from "../aggregator/predictor-stats.js";

const PID = "v1_basic"; // A君予想 (active)

const settledResult = (raceCode: string): RaceResultRow => ({
  raceCode,
  raceDate: `${raceCode.slice(0, 4)}-${raceCode.slice(4, 6)}-${raceCode.slice(6, 8)}`,
  stadiumId: raceCode.slice(8, 10),
  raceNumber: Number(raceCode.slice(10, 12)),
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
});

const makePred = (args: {
  raceCode: string;
  settled: boolean;
  dailyBet: { betCount: number; betCostYen: number; payoutYen: number; hit: boolean };
  realtimeBet: { betCount: number; betCostYen: number; payoutYen: number; hit: boolean };
}): RacePrediction => {
  const date = `${args.raceCode.slice(0, 4)}-${args.raceCode.slice(4, 6)}-${args.raceCode.slice(6, 8)}`;
  return {
    raceCode: args.raceCode,
    raceDate: date,
    stadiumId: args.raceCode.slice(8, 10),
    stadiumName: "test",
    raceNumber: Number(args.raceCode.slice(10, 12)),
    raceName: "general",
    raceTitle: "title",
    dayLabel: "",
    grade: "",
    votingDeadline: "",
    racers: [],
    startPrediction: { fromExhibition: false, entries: [] },
    aiEvaluation: { state: "realtime", componentKeys: [], entries: [] },
    raceResult: args.settled ? settledResult(args.raceCode) : undefined,
    predictions: [
      {
        predictorId: PID,
        predictorName: "A君予想",
        slot: 1,
        betPayout: {
          daily: { ...args.dailyBet, actualSanrentan: null },
          realtime: { ...args.realtimeBet, actualSanrentan: null },
        },
        betHitStatus: { dailyHit: args.dailyBet.hit, realtimeHit: args.realtimeBet.hit },
      },
    ],
    generatedAt: "2026-05-21T00:00:00.000Z",
  };
};

const findTotal = (report: ReturnType<typeof aggregatePredictorStats>) =>
  report.predictors.find((p) => p.predictorId === PID)?.total;

describe("aggregatePredictorStats", () => {
  it("直前のみを集計し、当日買い目と未確定レースは除外する", () => {
    const report = aggregatePredictorStats([
      // 確定済み・直前的中。当日は購入額 300/払戻 5000 だが集計に含めない。
      makePred({
        raceCode: "202605021201",
        settled: true,
        dailyBet: { betCount: 3, betCostYen: 300, payoutYen: 5000, hit: true },
        realtimeBet: { betCount: 1, betCostYen: 100, payoutYen: 800, hit: true },
      }),
      // 確定済み・直前は外れ (当日は的中)。hitCount は直前基準なので加算しない。
      makePred({
        raceCode: "202605021202",
        settled: true,
        dailyBet: { betCount: 2, betCostYen: 200, payoutYen: 3000, hit: true },
        realtimeBet: { betCount: 1, betCostYen: 100, payoutYen: 0, hit: false },
      }),
      // 未確定 (結果なし): 直前買い目はあるが母数から除外。
      makePred({
        raceCode: "202605021203",
        settled: false,
        dailyBet: { betCount: 0, betCostYen: 0, payoutYen: 0, hit: false },
        realtimeBet: { betCount: 2, betCostYen: 200, payoutYen: 0, hit: false },
      }),
    ]);
    const total = findTotal(report);
    expect(total?.raceCount).toBe(2);
    // 直前のみ: 100 + 100 = 200 (当日 300/200 は含めない)。
    expect(total?.betCostYen).toBe(200);
    // 直前のみ: 800 + 0 = 800 (当日 5000/3000 は含めない)。
    expect(total?.payoutYen).toBe(800);
    // 的中は直前基準で 1 レース (当日的中は数えない)。
    expect(total?.hitCount).toBe(1);
    expect(total?.realtimeHitCount).toBe(1);
    // 参考値として当日的中数は残る。
    expect(total?.dailyHitCount).toBe(2);
    expect(total?.recoveryRate).toBeCloseTo(4.0);
  });

  it("すべて未確定なら母数 0", () => {
    const report = aggregatePredictorStats([
      makePred({
        raceCode: "202605021201",
        settled: false,
        dailyBet: { betCount: 0, betCostYen: 0, payoutYen: 0, hit: false },
        realtimeBet: { betCount: 2, betCostYen: 200, payoutYen: 0, hit: false },
      }),
    ]);
    const total = findTotal(report);
    expect(total?.raceCount).toBe(0);
    expect(total?.betCostYen).toBe(0);
    expect(total?.recoveryRate).toBeNull();
  });
});

describe("aggregatePredictorStats — 体験指標", () => {
  const find = (report: ReturnType<typeof aggregatePredictorStats>) =>
    report.predictors.find((p) => p.predictorId === PID);

  it("平均配当は的中レースの払戻を的中数で割る (外れは分母に入れない)", () => {
    const report = aggregatePredictorStats([
      makePred({
        raceCode: "202608010101",
        settled: true,
        dailyBet: { betCount: 5, betCostYen: 500, payoutYen: 0, hit: false },
        realtimeBet: { betCount: 5, betCostYen: 500, payoutYen: 4000, hit: true },
      }),
      makePred({
        raceCode: "202608010102",
        settled: true,
        dailyBet: { betCount: 5, betCostYen: 500, payoutYen: 0, hit: false },
        realtimeBet: { betCount: 5, betCostYen: 500, payoutYen: 0, hit: false },
      }),
    ]);
    const total = find(report)?.total;
    expect(total?.raceCount).toBe(2);
    expect(total?.hitCount).toBe(1);
    expect(total?.hitPayoutYen).toBe(4000);
    // 2 レース買って 1 本的中 → 平均配当は 4000 (2000 ではない)
    expect(total?.averagePayoutYen).toBe(4000);
  });

  it("平均点数はレースあたりの購入点数", () => {
    const report = aggregatePredictorStats([
      makePred({
        raceCode: "202608010101",
        settled: true,
        dailyBet: { betCount: 5, betCostYen: 500, payoutYen: 0, hit: false },
        realtimeBet: { betCount: 5, betCostYen: 500, payoutYen: 0, hit: false },
      }),
      makePred({
        raceCode: "202608010102",
        settled: true,
        dailyBet: { betCount: 11, betCostYen: 1100, payoutYen: 0, hit: false },
        realtimeBet: { betCount: 11, betCostYen: 1100, payoutYen: 0, hit: false },
      }),
    ]);
    expect(find(report)?.total.averageBetCount).toBe(8);
  });

  it("万舟は 1 万円以上の的中のみ数え、賭け金あたりでも出す", () => {
    const report = aggregatePredictorStats([
      makePred({
        raceCode: "202608010101",
        settled: true,
        dailyBet: { betCount: 5, betCostYen: 500, payoutYen: 0, hit: false },
        realtimeBet: { betCount: 5, betCostYen: 500, payoutYen: 9999, hit: true },
      }),
      makePred({
        raceCode: "202608010102",
        settled: true,
        dailyBet: { betCount: 5, betCostYen: 500, payoutYen: 0, hit: false },
        realtimeBet: { betCount: 5, betCostYen: 500, payoutYen: 10000, hit: true },
      }),
    ]);
    const total = find(report)?.total;
    // 9,999 円は万舟に含めない (境界は 10,000 円以上)
    expect(total?.bigHitCount).toBe(1);
    // 賭け金 1,000 円で 1 本 → 1 万円あたり 10 本
    expect(total?.bigHitPer10kYen).toBe(10);
  });

  it("的中ゼロなら平均配当は null (0 で割らない)", () => {
    const report = aggregatePredictorStats([
      makePred({
        raceCode: "202608010101",
        settled: true,
        dailyBet: { betCount: 5, betCostYen: 500, payoutYen: 0, hit: false },
        realtimeBet: { betCount: 5, betCostYen: 500, payoutYen: 0, hit: false },
      }),
    ]);
    const total = find(report)?.total;
    expect(total?.averagePayoutYen).toBeNull();
    expect(total?.bigHitPer10kYen).toBe(0);
  });

  it("月をまたいでも通算が正しく積み上がる", () => {
    const report = aggregatePredictorStats([
      makePred({
        raceCode: "202607010101",
        settled: true,
        dailyBet: { betCount: 4, betCostYen: 400, payoutYen: 0, hit: false },
        realtimeBet: { betCount: 4, betCostYen: 400, payoutYen: 20000, hit: true },
      }),
      makePred({
        raceCode: "202608010101",
        settled: true,
        dailyBet: { betCount: 6, betCostYen: 600, payoutYen: 0, hit: false },
        realtimeBet: { betCount: 6, betCostYen: 600, payoutYen: 0, hit: false },
      }),
    ]);
    const overall = find(report);
    expect(overall?.monthly.map((m) => m.month)).toEqual(["2026-07", "2026-08"]);
    expect(overall?.total.averageBetCount).toBe(5);
    expect(overall?.total.averagePayoutYen).toBe(20000);
    expect(overall?.total.bigHitCount).toBe(1);
  });
});
