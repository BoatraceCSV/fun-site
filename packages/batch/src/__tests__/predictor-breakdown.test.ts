import type {
  AiEvaluationEntry,
  PredictorBreakdown,
  RacePrediction,
  RaceResultRow,
} from "@fun-site/shared";
import { describe, expect, it } from "vitest";
import { aggregatePredictorBreakdown } from "../aggregator/predictor-breakdown.js";

const PID = "v1_basic"; // A君予想 (active, startedAt 2026-05-01)

type RealtimeBet = {
  betCount: number;
  betCostYen: number;
  payoutYen: number;
  hit: boolean;
  /** 確定 3連単 配当。undefined なら actualSanrentan=null (配当帯=不明)。 */
  sanrentanPayout?: number;
};

const weather = (windSpeed: number): RaceResultRow["weather"] => ({
  weather: "1",
  windDirection: "北",
  windSpeed,
  waveHeight: 2,
  airTemperature: 20,
  waterTemperature: 20,
});

const evalEntries = (strengthByBoat: Record<number, number>): AiEvaluationEntry[] =>
  Object.entries(strengthByBoat).map(([boat, pt]) => ({
    boatNumber: Number(boat),
    contribution: {},
    strengthPt: pt,
  }));

/** 1 予想者ぶんの直前ベットを持つ RacePrediction を 1 件作る。 */
const makePred = (args: {
  raceCode: string;
  stadiumId: string;
  grade?: string;
  windSpeed?: number;
  realtime?: RealtimeBet;
  strengthByBoat?: Record<number, number>;
  /** false で結果未確定 (raceResult 無し) を表現。既定 true。 */
  settled?: boolean;
}): RacePrediction => {
  const date = `${args.raceCode.slice(0, 4)}-${args.raceCode.slice(4, 6)}-${args.raceCode.slice(6, 8)}`;
  const rt = args.realtime;
  return {
    raceCode: args.raceCode,
    raceDate: date,
    stadiumId: args.stadiumId,
    stadiumName: "test",
    raceNumber: Number(args.raceCode.slice(10, 12)),
    raceName: "general",
    raceTitle: "title",
    dayLabel: "",
    grade: args.grade ?? "",
    votingDeadline: "",
    racers: [],
    startPrediction: { fromExhibition: false, entries: [] },
    aiEvaluation: { state: "realtime", componentKeys: [], entries: [] },
    raceResult:
      args.settled === false
        ? undefined
        : {
            raceCode: args.raceCode,
            raceDate: date,
            stadiumId: args.stadiumId,
            raceNumber: Number(args.raceCode.slice(10, 12)),
            votingDeadline: "",
            fetchedAt: "",
            recordedAt: "",
            kimarite: "",
            // 確定済み: 1〜3 着が揃う (isSettledResult=true)。
            finishes: [
              { rank: 1, boatNumber: 1, racerName: "", raceTime: "" },
              { rank: 2, boatNumber: 2, racerName: "", raceTime: "" },
              { rank: 3, boatNumber: 3, racerName: "", raceTime: "" },
            ],
            courses: [],
            weather: weather(args.windSpeed ?? 3),
          },
    predictions: rt
      ? [
          {
            predictorId: PID,
            predictorName: "A君予想",
            slot: 1,
            aiEvaluationRealtime: args.strengthByBoat
              ? {
                  state: "realtime",
                  componentKeys: [],
                  entries: evalEntries(args.strengthByBoat),
                }
              : undefined,
            betPayout: {
              daily: {
                betCount: 0,
                betCostYen: 0,
                payoutYen: 0,
                hit: false,
                actualSanrentan: null,
              },
              realtime: {
                betCount: rt.betCount,
                betCostYen: rt.betCostYen,
                payoutYen: rt.payoutYen,
                hit: rt.hit,
                actualSanrentan:
                  rt.sanrentanPayout === undefined
                    ? null
                    : { combination: "1-2-3", payout: rt.sanrentanPayout, popularity: null },
              },
            },
            betHitStatus: { dailyHit: false, realtimeHit: rt.hit },
          },
        ]
      : [],
    generatedAt: "2026-05-21T00:00:00.000Z",
  };
};

const sumRaceCount = (buckets: PredictorBreakdown["byStadium"]): number =>
  buckets.reduce((acc, b) => acc + b.metrics.raceCount, 0);

const A = (report: ReturnType<typeof aggregatePredictorBreakdown>): PredictorBreakdown =>
  report.predictors.find((p) => p.predictorId === PID)!;

describe("aggregatePredictorBreakdown", () => {
  it("直前買い目が無いレース (betCostYen=0) は集計対象外", () => {
    const report = aggregatePredictorBreakdown([
      makePred({ raceCode: "202605021201", stadiumId: "12" }), // predictions=[]
      makePred({
        raceCode: "202605021202",
        stadiumId: "12",
        realtime: { betCount: 0, betCostYen: 0, payoutYen: 0, hit: false },
      }),
      makePred({
        raceCode: "202605021203",
        stadiumId: "12",
        realtime: { betCount: 2, betCostYen: 200, payoutYen: 0, hit: false },
      }),
    ]);
    expect(A(report).total.raceCount).toBe(1);
  });

  it("未確定レース (結果なし) は母数・購入額から除外", () => {
    const report = aggregatePredictorBreakdown([
      // 買い目はあるが結果未確定 → 除外。
      makePred({
        raceCode: "202605021201",
        stadiumId: "12",
        settled: false,
        realtime: { betCount: 2, betCostYen: 200, payoutYen: 0, hit: false },
      }),
      // 確定済み → 集計対象。
      makePred({
        raceCode: "202605021202",
        stadiumId: "12",
        realtime: { betCount: 1, betCostYen: 100, payoutYen: 800, hit: true },
      }),
    ]);
    const a = A(report).total;
    expect(a.raceCount).toBe(1);
    expect(a.betCostYen).toBe(100);
    expect(a.hitCount).toBe(1);
  });

  it("total の回収率・的中率を直前のみで算出", () => {
    const report = aggregatePredictorBreakdown([
      makePred({
        raceCode: "202605021201",
        stadiumId: "12",
        realtime: { betCount: 1, betCostYen: 100, payoutYen: 800, hit: true, sanrentanPayout: 800 },
      }),
      makePred({
        raceCode: "202605021202",
        stadiumId: "12",
        realtime: { betCount: 3, betCostYen: 300, payoutYen: 0, hit: false, sanrentanPayout: 5000 },
      }),
    ]);
    const a = A(report).total;
    expect(a.raceCount).toBe(2);
    expect(a.hitCount).toBe(1);
    expect(a.hitRate).toBeCloseTo(0.5);
    expect(a.betCostYen).toBe(400);
    expect(a.payoutYen).toBe(800);
    expect(a.recoveryRate).toBeCloseTo(2.0);
    expect(report.metric).toBe("realtime");
  });

  it("内部完結する軸の raceCount 合計が total と一致", () => {
    const report = aggregatePredictorBreakdown([
      makePred({
        raceCode: "202605021201",
        stadiumId: "12",
        grade: "G1",
        realtime: { betCount: 2, betCostYen: 200, payoutYen: 0, hit: false },
        strengthByBoat: { 1: 60, 2: 50 },
      }),
      makePred({
        raceCode: "202605031801",
        stadiumId: "18",
        grade: "SG",
        realtime: { betCount: 12, betCostYen: 1200, payoutYen: 3000, hit: true },
        strengthByBoat: { 1: 40, 4: 70 },
      }),
    ]);
    const a = A(report);
    expect(a.total.raceCount).toBe(2);
    for (const axis of [a.byStadium, a.byGrade, a.byBetCount, a.byHonmeiWaku]) {
      expect(sumRaceCount(axis)).toBe(a.total.raceCount);
    }
  });

  it("配当帯は不明バケット込みで total と一致・風速は確定済みなので不明なし", () => {
    const report = aggregatePredictorBreakdown([
      // 配当あり・風速 7
      makePred({
        raceCode: "202605021201",
        stadiumId: "12",
        windSpeed: 7,
        realtime: {
          betCount: 1,
          betCostYen: 100,
          payoutYen: 0,
          hit: false,
          sanrentanPayout: 12000,
        },
      }),
      // 配当なし (sanrentanPayout 未指定 → 不明バンド)。確定済みなので風速は既定 3 で既知。
      makePred({
        raceCode: "202605021202",
        stadiumId: "12",
        realtime: { betCount: 1, betCostYen: 100, payoutYen: 0, hit: false },
      }),
    ]);
    const a = A(report);
    expect(sumRaceCount(a.byPayoutBand)).toBe(a.total.raceCount);
    expect(sumRaceCount(a.byWindSpeed)).toBe(a.total.raceCount);
    // 配当は欠損しうるので不明バケットが立つ。
    expect(a.byPayoutBand.some((b) => b.key === "unknown")).toBe(true);
    // 集計対象は確定済みレースのみ = 風速は必ず存在するため不明バケットは立たない。
    expect(a.byWindSpeed.some((b) => b.key === "unknown")).toBe(false);
    // 12000円 は 1万円〜 バンドへ。
    expect(a.byPayoutBand.find((b) => b.key === "band_10000_")?.metrics.raceCount).toBe(1);
    // 風速 7 は 6〜7m/s ビンへ、既定 3 は 2〜3m/s ビンへ。
    expect(a.byWindSpeed.find((b) => b.key === "w6_7")?.metrics.raceCount).toBe(1);
    expect(a.byWindSpeed.find((b) => b.key === "w2_3")?.metrics.raceCount).toBe(1);
  });

  it("本命枠番は strengthPt 最大艇から導出", () => {
    const report = aggregatePredictorBreakdown([
      makePred({
        raceCode: "202605021201",
        stadiumId: "12",
        realtime: { betCount: 1, betCostYen: 100, payoutYen: 0, hit: false },
        strengthByBoat: { 1: 40, 4: 72, 6: 55 },
      }),
    ]);
    const a = A(report);
    expect(a.byHonmeiWaku).toHaveLength(1);
    expect(a.byHonmeiWaku[0]!.key).toBe("4");
    expect(a.byHonmeiWaku[0]!.label).toBe("4号艇");
  });

  it("時系列は日次・累積とも単調に件数が増える", () => {
    const report = aggregatePredictorBreakdown([
      makePred({
        raceCode: "202605021201",
        stadiumId: "12",
        realtime: { betCount: 1, betCostYen: 100, payoutYen: 500, hit: true },
      }),
      makePred({
        raceCode: "202605031201",
        stadiumId: "12",
        realtime: { betCount: 1, betCostYen: 100, payoutYen: 0, hit: false },
      }),
      makePred({
        raceCode: "202605031202",
        stadiumId: "12",
        realtime: { betCount: 1, betCostYen: 100, payoutYen: 0, hit: false },
      }),
    ]);
    const ts = A(report).timeseries;
    expect(ts.map((p) => p.date)).toEqual(["2026-05-02", "2026-05-03"]);
    expect(ts[0]!.metrics.raceCount).toBe(1);
    expect(ts[1]!.metrics.raceCount).toBe(2);
    // 累積は単調増加。
    expect(ts[0]!.cumulative.raceCount).toBe(1);
    expect(ts[1]!.cumulative.raceCount).toBe(3);
    expect(ts[1]!.cumulative.recoveryRate).toBeCloseTo(500 / 300);
  });

  it("データが無い予想者は null レートで全予想者ぶん出力", () => {
    const report = aggregatePredictorBreakdown([]);
    // active 2 名はレジストリから必ず出る。
    expect(report.predictors.length).toBeGreaterThanOrEqual(2);
    const a = A(report);
    expect(a.total.raceCount).toBe(0);
    expect(a.total.recoveryRate).toBeNull();
    expect(a.total.hitRate).toBeNull();
    expect(a.timeseries).toEqual([]);
  });
});
