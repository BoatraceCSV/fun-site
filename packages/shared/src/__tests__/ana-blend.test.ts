import { describe, expect, it } from "vitest";
import {
  ANA_BLEND_PARAMS,
  cellProbabilityMatrix,
  firstCourseDistribution,
  kimariteDistribution,
  modulatePairProbabilities,
  parseCellName,
  strengthZScore,
  upsetFirstCourseShares,
} from "../utils/ana-blend.js";

const CELLS = {
  逃げ_1: 0.6,
  抜き_1: 0.02,
  差し_2: 0.1,
  まくり_3: 0.12,
  まくり差し_3: 0.08,
  まくり_4: 0.05,
  その他_5: 0.03,
};

describe("parseCellName", () => {
  it("決まり手と 1着コースに分ける (決まり手側の _ は含まない前提)", () => {
    expect(parseCellName("まくり差し_3")).toEqual({ kimarite: "まくり差し", firstCourse: 3 });
    expect(parseCellName("その他_6")).toEqual({ kimarite: "その他", firstCourse: 6 });
  });
  it("形式外は null", () => {
    expect(parseCellName("逃げ")).toBeNull();
    expect(parseCellName("逃げ_7")).toBeNull();
    expect(parseCellName("_1")).toBeNull();
  });
});

describe("firstCourseDistribution / upsetFirstCourseShares", () => {
  it("1着コースごとに合計する", () => {
    const d = firstCourseDistribution(CELLS);
    expect(d[0]).toBeCloseTo(0.62);
    expect(d[2]).toBeCloseTo(0.2);
    expect(d[5]).toBe(0);
  });
  it("荒れ側は 1 コースを除いて正規化し降順", () => {
    const s = upsetFirstCourseShares(CELLS);
    expect(s[0]).toEqual({ course: 3, share: expect.closeTo(0.2 / 0.38, 6) });
    expect(s.map((e) => e.course)).toEqual([3, 2, 4, 5, 6]);
    expect(s.reduce((a, e) => a + e.share, 0)).toBeCloseTo(1);
  });
  it("荒れ側が 0 なら空", () => {
    expect(upsetFirstCourseShares({ 逃げ_1: 1 })).toEqual([]);
  });
});

describe("kimariteDistribution / cellProbabilityMatrix", () => {
  it("全種類を固定順で返し、その他は末尾に畳む", () => {
    const d = kimariteDistribution(CELLS);
    expect(d.map((e) => e.kimarite)).toEqual([
      "逃げ",
      "差し",
      "まくり",
      "まくり差し",
      "抜き",
      "恵まれ",
      "その他",
    ]);
    expect(d.find((e) => e.kimarite === "まくり")?.probability).toBeCloseTo(0.17);
    expect(d.find((e) => e.kimarite === "恵まれ")?.probability).toBe(0);
    expect(d.find((e) => e.kimarite === "その他")?.probability).toBeCloseTo(0.03);
  });
  it("行列の行合計は決まり手分布、列合計は 1着コース分布と一致する", () => {
    const m = cellProbabilityMatrix(CELLS);
    const rowSum = m.find((r) => r.kimarite === "まくり")?.byCourse.reduce((a, b) => a + b, 0);
    expect(rowSum).toBeCloseTo(0.17);
    const col3 = m.reduce((a, r) => a + (r.byCourse[2] ?? 0), 0);
    expect(col3).toBeCloseTo(firstCourseDistribution(CELLS)[2] ?? -1);
  });
});

describe("modulatePairProbabilities", () => {
  const pairs = [
    { second: 1, third: 4, probability: 0.5 },
    { second: 4, third: 1, probability: 0.5 },
  ];
  it("z が全て 0 なら表の値をそのまま正規化する", () => {
    expect(modulatePairProbabilities(pairs, [0, 0, 0, 0, 0, 0])).toEqual([0.5, 0.5]);
  });
  it("強い艇のコースが 2着のペアが上がる (2着の係数 γ は 3着の γ/2 より強い)", () => {
    const z = [strengthZScore(60), 0, 0, strengthZScore(50), 0, 0];
    const [a, b] = modulatePairProbabilities(pairs, z);
    expect(a).toBeGreaterThan(b ?? 0);
    expect((a ?? 0) + (b ?? 0)).toBeCloseTo(1);
  });
  it("γ は上流の定数と同期している", () => {
    expect(ANA_BLEND_PARAMS.gamma).toBe(0.5);
    expect(ANA_BLEND_PARAMS.excludedFirstCourse).toBe(1);
  });
});
