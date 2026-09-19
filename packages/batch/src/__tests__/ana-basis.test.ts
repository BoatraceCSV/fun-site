import type { AnaPicksRow, KimariteRow, StartPrediction } from "@fun-site/shared";
import { describe, expect, it } from "vitest";
import {
  ANA_PAIR_TABLE_CELLS,
  ANA_PAIR_TABLE_PAIRS,
  boatByCourseFrom,
  buildAnaBasis,
  buildAnaTables,
} from "../site-builder/ana-basis.js";

const kimariteRow = (state: "daily" | "realtime"): KimariteRow => ({
  raceCode: "202609190201",
  raceDate: "2026-09-19",
  state,
  upsetRate: 0.4,
  cellProbabilities: {
    逃げ_1: 0.6,
    抜き_1: 0.02,
    差し_2: 0.1,
    まくり_3: 0.12,
    まくり差し_3: 0.08,
    まくり_4: 0.05,
    その他_5: 0.03,
  },
});

const picksRow = (state: "daily" | "realtime"): AnaPicksRow => ({
  raceCode: "202609190201",
  raceDate: "2026-09-19",
  state,
  picks: [
    { combo: [3, 1, 4], kimarite: "まくり差し", probability: 0.05 },
    { combo: [2, 1, 3], kimarite: "差し" },
  ],
});

const tables = buildAnaTables(
  [
    { cell: "まくり_3", second: 4, third: 5, n: 10, probability: 0.3 },
    { cell: "まくり_3", second: 1, third: 4, n: 8, probability: 0.2 },
    { cell: "まくり差し_3", second: 1, third: 4, n: 30, probability: 0.5 },
    { cell: "差し_2", second: 1, third: 3, n: 40, probability: 0.6 },
    { cell: "まくり_4", second: 5, third: 1, n: 5, probability: 0.4 },
    { cell: "逃げ_1", second: 2, third: 3, n: 100, probability: 0.3 },
  ],
  [
    { courses: [3, 1, 4], n: 500, mode: "まくり差し", shares: { まくり差し: 0.6, まくり: 0.2 } },
    { courses: [2, 5, 3], n: 50, mode: "差し", shares: { 差し: 0.7 } },
  ],
);

/** 2 号艇が 5 コース、5 号艇が 2 コースに入った展示進入 */
const shifted: StartPrediction = {
  fromExhibition: true,
  entries: [1, 5, 3, 4, 2, 6].map((boat, i) => ({
    boatNumber: boat,
    courseNumber: i + 1,
    startTiming: 0.15,
    exhibitionStartTiming: null,
  })),
};

describe("boatByCourseFrom", () => {
  it("展示進入があればコース → 艇番に写す", () => {
    expect(boatByCourseFrom(shifted)).toEqual([1, 5, 3, 4, 2, 6]);
  });
  it("展示未取得・コース重複は枠なりに倒す", () => {
    expect(boatByCourseFrom(undefined)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(boatByCourseFrom({ ...shifted, fromExhibition: false })).toEqual([1, 2, 3, 4, 5, 6]);
    const dup: StartPrediction = {
      fromExhibition: true,
      entries: shifted.entries.map((e) => ({ ...e, courseNumber: 1 })),
    };
    expect(boatByCourseFrom(dup)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("buildAnaBasis", () => {
  it("daily は枠なり、realtime は展示進入で出目をコースに写像し、決まり手分布を突き合わせる", () => {
    const basis = buildAnaBasis(
      { daily: kimariteRow("daily"), realtime: kimariteRow("realtime") },
      { daily: picksRow("daily"), realtime: picksRow("realtime") },
      shifted,
      tables,
    );
    expect(basis?.daily?.boatByCourse).toEqual([1, 2, 3, 4, 5, 6]);
    expect(basis?.daily?.picks[0]).toEqual({
      combo: [3, 1, 4],
      courses: [3, 1, 4],
      kimarite: "まくり差し",
      probability: 0.05,
      kimariteShares: { n: 500, shares: { まくり差し: 0.6, まくり: 0.2 } },
    });
    // 確率列が無い出目は probability を持たない
    expect(basis?.daily?.picks[1]).toEqual({
      combo: [2, 1, 3],
      courses: [2, 1, 3],
      kimarite: "差し",
    });
    // realtime: 2 号艇は 5 コース → 出目 2-1-3 のコース並びは 5-1-3 (テーブルに無いので分布なし)
    expect(basis?.realtime?.boatByCourse).toEqual([1, 5, 3, 4, 2, 6]);
    expect(basis?.realtime?.picks[1]?.courses).toEqual([5, 1, 3]);
    expect(basis?.realtime?.picks[1]?.kimariteShares).toBeUndefined();
    expect(basis?.realtime?.upsetRate).toBe(0.4);
  });

  it("荒れ側 (1 コース頭以外) の上位セルだけ、確率降順でペア表を載せる", () => {
    const basis = buildAnaBasis(
      { realtime: kimariteRow("realtime") },
      undefined,
      undefined,
      tables,
    );
    const pt = basis?.realtime?.pairTables ?? [];
    expect(pt).toHaveLength(ANA_PAIR_TABLE_CELLS);
    expect(pt.map((p) => p.cell)).toEqual(["まくり_3", "差し_2", "まくり差し_3"]);
    expect(pt[0]?.cellProbability).toBe(0.12);
    expect(pt[0]?.pairs.map((p) => p.probability)).toEqual([0.3, 0.2]);
    expect(pt.every((p) => p.pairs.length <= ANA_PAIR_TABLE_PAIRS)).toBe(true);
    // 買い目が無い状態でも根拠 (セル確率) は載る
    expect(basis?.realtime?.picks).toEqual([]);
  });

  it("荒れ度メーターの行が無い状態は作らず、両方無ければ undefined", () => {
    expect(
      buildAnaBasis(undefined, { daily: picksRow("daily") }, undefined, tables),
    ).toBeUndefined();
    const only = buildAnaBasis({ daily: kimariteRow("daily") }, undefined, undefined, undefined);
    expect(only?.realtime).toBeUndefined();
    expect(only?.daily?.pairTables).toEqual([]);
    expect(only?.daily?.picks).toEqual([]);
  });

  it("テーブルが両方空なら buildAnaTables は undefined", () => {
    expect(buildAnaTables([], [])).toBeUndefined();
  });
});
