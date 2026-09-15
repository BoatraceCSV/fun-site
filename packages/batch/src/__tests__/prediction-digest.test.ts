import type { AiEvaluationEntry, RacePrediction, RaceResultRow } from "@fun-site/shared";
import { describe, expect, it } from "vitest";
import {
  type PredictionDigestDay,
  type PredictionDigestStore,
  collectPredictionDigests,
} from "../aggregator/prediction-digest-store.js";
import {
  PREDICTION_DIGEST_SCHEMA_VERSION,
  type PredictionDigest,
  honmeiWakuOf,
  toPredictionDigest,
} from "../aggregator/prediction-digest.js";

const PID = "v1_basic";

const settledResult = (raceCode: string, windSpeed: number): RaceResultRow => ({
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
    windSpeed,
    waveHeight: 2,
    airTemperature: 20,
    waterTemperature: 20,
  },
});

const evalEntries = (strengthByBoat: Record<number, number>): AiEvaluationEntry[] =>
  Object.entries(strengthByBoat).map(([boat, pt]) => ({
    boatNumber: Number(boat),
    contribution: {},
    strengthPt: pt,
  }));

const makePred = (args: {
  raceCode: string;
  settled?: boolean;
  grade?: string;
  windSpeed?: number;
  strengthByBoat?: Record<number, number>;
  sanrentanPayout?: number;
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
    grade: args.grade ?? "",
    votingDeadline: "",
    racers: [],
    startPrediction: { fromExhibition: false, entries: [] },
    aiEvaluation: { state: "realtime", componentKeys: [], entries: [] },
    raceResult:
      args.settled === false ? undefined : settledResult(args.raceCode, args.windSpeed ?? 3),
    predictions: [
      {
        predictorId: PID,
        predictorName: "A君予想",
        slot: 1,
        aiEvaluationRealtime: args.strengthByBoat
          ? { state: "realtime", componentKeys: [], entries: evalEntries(args.strengthByBoat) }
          : undefined,
        betPayout: {
          daily: { betCount: 2, betCostYen: 200, payoutYen: 0, hit: false, actualSanrentan: null },
          realtime: {
            betCount: 4,
            betCostYen: 400,
            payoutYen: 1500,
            hit: true,
            actualSanrentan:
              args.sanrentanPayout === undefined
                ? null
                : { combination: "1-2-3", payout: args.sanrentanPayout, popularity: 1 },
          },
        },
        betHitStatus: { dailyHit: false, realtimeHit: true },
      },
    ],
    generatedAt: "2026-09-15T00:00:00.000Z",
  };
};

describe("toPredictionDigest", () => {
  it("集計に必要な項目だけを射影する", () => {
    const digest = toPredictionDigest(
      makePred({
        raceCode: "202609150412",
        grade: "G1",
        windSpeed: 5,
        strengthByBoat: { 1: 60, 2: 65, 3: 50 },
        sanrentanPayout: 12_000,
      }),
    );
    expect(digest).toEqual({
      raceCode: "202609150412",
      raceDate: "2026-09-15",
      stadiumId: "04",
      grade: "G1",
      settled: true,
      windSpeed: 5,
      predictors: [
        {
          predictorId: PID,
          betCount: 4,
          betCostYen: 400,
          payoutYen: 1500,
          dailyHit: false,
          realtimeHit: true,
          honmeiWaku: 2,
          sanrentanPayout: 12_000,
        },
      ],
    } satisfies PredictionDigest);
    // RacePrediction の重い項目 (racers など) は持ち込まない。
    expect(Object.keys(digest)).not.toContain("racers");
  });

  it("未確定レースは settled=false・風速なし、評価と配当が無ければ項目を省く", () => {
    const digest = toPredictionDigest(makePred({ raceCode: "202609150401", settled: false }));
    expect(digest.settled).toBe(false);
    expect(digest.windSpeed).toBeUndefined();
    expect(digest.predictors[0]?.honmeiWaku).toBeUndefined();
    expect(digest.predictors[0]?.sanrentanPayout).toBeUndefined();
    // JSON 化したときにキーごと消える (キャッシュを小さく保つ)。
    expect(JSON.stringify(digest)).not.toContain("honmeiWaku");
  });

  it("本命枠番は strengthPt 最大艇で、同点なら若い枠番を優先する", () => {
    expect(
      honmeiWakuOf({
        state: "realtime",
        componentKeys: [],
        entries: evalEntries({ 1: 55, 2: 60, 3: 60 }),
      }),
    ).toBe(2);
    expect(honmeiWakuOf({ state: "realtime", componentKeys: [], entries: [] })).toBeUndefined();
    expect(honmeiWakuOf(undefined)).toBeUndefined();
  });
});

/** メモリ上の疑似 store。呼び出し履歴を記録する。 */
const fakeStore = (initial: Record<string, PredictionDigestDay>) => {
  const days = new Map(Object.entries(initial));
  const calls = { load: [] as string[], save: [] as string[], build: [] as string[] };
  const source = new Map<string, PredictionDigest[]>();
  const store: PredictionDigestStore = {
    load: async (date) => {
      calls.load.push(date);
      return days.get(date);
    },
    save: async (day) => {
      calls.save.push(day.date);
      days.set(day.date, day);
    },
    buildFromSource: async (date) => {
      calls.build.push(date);
      return source.get(date) ?? [];
    },
  };
  return { store, calls, days, source };
};

const cachedDay = (date: string, schemaVersion: number = PREDICTION_DIGEST_SCHEMA_VERSION) => ({
  schemaVersion,
  date,
  updatedAt: "2026-09-14T13:00:00.000Z",
  races: [toPredictionDigest(makePred({ raceCode: `${date.replaceAll("-", "")}0101` }))],
});

describe("collectPredictionDigests", () => {
  it("当日はメモリ上の予想から作って保存し、過去日はキャッシュを再利用する", async () => {
    const { store, calls, days } = fakeStore({ "2026-09-13": cachedDay("2026-09-13") });
    const today = makePred({ raceCode: "202609150612" });
    const digests = await collectPredictionDigests({
      dates: ["2026-09-13", "2026-09-15"],
      raceDate: "2026-09-15",
      currentPredictions: [today],
      store,
    });
    expect(digests.map((d) => d.raceCode)).toEqual(["202609130101", "202609150612"]);
    // 当日は load / buildFromSource を呼ばずに保存だけする。
    expect(calls.load).toEqual(["2026-09-13"]);
    expect(calls.build).toEqual([]);
    expect(calls.save).toEqual(["2026-09-15"]);
    expect(days.get("2026-09-15")?.races[0]?.raceCode).toBe("202609150612");
  });

  it("キャッシュの無い過去日は元データから作って保存する", async () => {
    const { store, calls, days, source } = fakeStore({});
    source.set("2026-09-12", [toPredictionDigest(makePred({ raceCode: "202609121201" }))]);
    const digests = await collectPredictionDigests({
      dates: ["2026-09-12", "2026-09-15"],
      raceDate: "2026-09-15",
      currentPredictions: [],
      store,
    });
    expect(digests.map((d) => d.raceCode)).toEqual(["202609121201"]);
    expect(calls.build).toEqual(["2026-09-12"]);
    expect(days.get("2026-09-12")?.schemaVersion).toBe(PREDICTION_DIGEST_SCHEMA_VERSION);
  });

  it("元データが空の過去日はキャッシュに固定しない", async () => {
    const { store, calls, days } = fakeStore({});
    await collectPredictionDigests({
      dates: ["2026-09-14"],
      raceDate: "2026-09-15",
      currentPredictions: [],
      store,
    });
    expect(calls.build).toEqual(["2026-09-14"]);
    expect(days.has("2026-09-14")).toBe(false);
  });

  it("schemaVersion が違うキャッシュは作り直す", async () => {
    const { store, calls, source } = fakeStore({ "2026-09-13": cachedDay("2026-09-13", 0) });
    source.set("2026-09-13", [toPredictionDigest(makePred({ raceCode: "202609130909" }))]);
    const digests = await collectPredictionDigests({
      dates: ["2026-09-13"],
      raceDate: "2026-09-15",
      currentPredictions: [],
      store,
    });
    expect(digests.map((d) => d.raceCode)).toEqual(["202609130909"]);
    expect(calls.build).toEqual(["2026-09-13"]);
    expect(calls.save).toEqual(["2026-09-13"]);
  });

  it("保存に失敗しても集計結果は返す", async () => {
    const { store } = fakeStore({});
    const failing: PredictionDigestStore = {
      ...store,
      save: async () => {
        throw new Error("gcs down");
      },
    };
    const digests = await collectPredictionDigests({
      dates: ["2026-09-15"],
      raceDate: "2026-09-15",
      currentPredictions: [makePred({ raceCode: "202609150101" })],
      store: failing,
    });
    expect(digests).toHaveLength(1);
  });
});
