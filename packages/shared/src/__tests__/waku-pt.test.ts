import { describe, expect, it } from "vitest";
import type { RacerWaku10, Waku10RunView } from "../types/prediction.js";
import { WAKU10_MAX_RUNS, WAKU_PT_SCALE, computeWaku10Aggregate } from "../utils/waku-pt.js";

/**
 * `computeWaku10Aggregate()` は枠番pt の再計算ではなく、`programs/waku10`
 * （枠番別過去10走）を読み手向けに集計する参考値。分母の規則は選手pt の素点と
 * 同じ（F / L / 失 / 妨 は計上、欠 / 転 / 落 / 沈 / エ / 不 は無かった扱い）。
 */
const run = (rank: string, overrides: Partial<Waku10RunView> = {}): Waku10RunView => ({
  rank,
  entryCourse: 3,
  courseIsAsWaku: false,
  grade: "IP",
  ...overrides,
});

const boat = (runs: readonly Waku10RunView[], boatNumber = 3): RacerWaku10 => ({
  boatNumber,
  racerName: "テスト太郎",
  winRate: 5.5,
  avgST: 0.16,
  avgStartOrder: 3.2,
  runs,
});

describe("computeWaku10Aggregate", () => {
  it("着順を 1-6 に振り分け、1着率 / 2連対率 / 3連対率 を出す", () => {
    const agg = computeWaku10Aggregate(boat([run("1"), run("2"), run("3"), run("6")]));

    expect(agg.rankCounts).toEqual([1, 1, 1, 0, 0, 1]);
    expect(agg.firstCount).toBe(1);
    expect(agg.top2Count).toBe(2);
    expect(agg.top3Count).toBe(3);
    expect(agg.countedRuns).toBe(4);
    expect(agg.firstRate).toBe(25);
    expect(agg.top2Rate).toBe(50);
    expect(agg.top3Rate).toBe(75);
  });

  it("選手責任トークン (F / L / 失 / 妨) は分母に計上する", () => {
    const agg = computeWaku10Aggregate(boat([run("1"), run("F"), run("L"), run("妨")]));

    expect(agg.countedRuns).toBe(4);
    expect(agg.firstRate).toBe(25);
    expect(agg.tokenCounts).toEqual([
      { token: "F", count: 1, racerResponsible: true },
      { token: "L", count: 1, racerResponsible: true },
      { token: "妨", count: 1, racerResponsible: true },
    ]);
  });

  it("選手責任外トークン (欠 / 転 / 落 / 沈 / エ / 不) は分母から外す", () => {
    const agg = computeWaku10Aggregate(boat([run("1"), run("欠"), run("転")]));

    expect(agg.totalRuns).toBe(3);
    expect(agg.countedRuns).toBe(1);
    expect(agg.firstRate).toBe(100);
    expect(agg.tokenCounts).toEqual([
      { token: "欠", count: 1, racerResponsible: false },
      { token: "転", count: 1, racerResponsible: false },
    ]);
  });

  it("同じトークンは出現順にまとめて数える", () => {
    const agg = computeWaku10Aggregate(boat([run("F"), run("欠"), run("F")]));

    expect(agg.tokenCounts).toEqual([
      { token: "F", count: 2, racerResponsible: true },
      { token: "欠", count: 1, racerResponsible: false },
    ]);
  });

  it("進入コースが枠番と違う走を数え、枠なり進入の本数も持つ", () => {
    const agg = computeWaku10Aggregate(
      boat([
        run("1", { entryCourse: 3, courseIsAsWaku: true }),
        run("2", { entryCourse: 3, courseIsAsWaku: false }),
        run("4", { entryCourse: 5, courseIsAsWaku: false }),
        run("6", { entryCourse: 2, courseIsAsWaku: false }),
      ]),
    );

    expect(agg.offCourseRuns).toBe(2);
    expect(agg.asWakuRuns).toBe(1);
  });

  it("この枠番での出走歴が無い艇は率を null にする", () => {
    const agg = computeWaku10Aggregate(boat([]));

    expect(agg.totalRuns).toBe(0);
    expect(agg.countedRuns).toBe(0);
    expect(agg.firstRate).toBeNull();
    expect(agg.top2Rate).toBeNull();
    expect(agg.top3Rate).toBeNull();
    expect(agg.rankCounts).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("分母が着順以外だけでも 0 除算しない", () => {
    const agg = computeWaku10Aggregate(boat([run("欠"), run("不")]));

    expect(agg.countedRuns).toBe(0);
    expect(agg.firstRate).toBeNull();
  });

  it("空文字スロット（出走歴不足）は totalRuns にもトークンにも数えない", () => {
    const agg = computeWaku10Aggregate(boat([run("1"), run("")]));

    // runs は上流で空スロット除外済みだが、混ざっても壊れないこと
    expect(agg.countedRuns).toBe(1);
    expect(agg.tokenCounts).toEqual([]);
  });

  it("枠番pt の偏差値スケールと waku10 の走数は上流と同じ定数を持つ", () => {
    expect(WAKU_PT_SCALE).toEqual({ mean: 50, sd: 10 });
    expect(WAKU10_MAX_RUNS).toBe(10);
  });
});
