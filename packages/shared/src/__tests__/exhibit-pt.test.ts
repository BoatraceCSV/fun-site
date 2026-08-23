import { describe, expect, it } from "vitest";
import type { ExhibitPtBasis } from "../types/stadium-table.js";
import {
  EXHIBIT_PT_DAILY_NEUTRAL,
  EXHIBIT_PT_SCALE,
  type ExhibitPtInput,
  buildExhibitPtSeries,
  computeExhibitPtAggregate,
  computeExhibitPtStepsByBoat,
  exhibitPtMatchesIndex,
  raceHensachi,
} from "../utils/exhibit-pt.js";

/**
 * `computeExhibitPtAggregate()` は展示pt の再計算ではなく、同じ直前情報スナップショットの
 * 計測値（展示タイム・スタート展示ST）を展示pt と並べて順位で見比べるための参考値。
 */
const input = (boatNumber: number, overrides: Partial<ExhibitPtInput> = {}): ExhibitPtInput => ({
  boatNumber,
  exhibitionTime: null,
  exhibitionStartTiming: null,
  exhibitPt: undefined,
  ...overrides,
});

describe("computeExhibitPtAggregate", () => {
  it("展示タイムは速い順、展示pt は高い順で順位を付ける", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.8, exhibitPt: 55 }),
      input(2, { exhibitionTime: 6.7, exhibitPt: 60 }),
      input(3, { exhibitionTime: 6.9, exhibitPt: 45 }),
    ]);

    expect(agg.boats.map((b) => b.timeRank)).toEqual([2, 1, 3]);
    expect(agg.boats.map((b) => b.ptRank)).toEqual([2, 1, 3]);
    expect(agg.measuredTimeCount).toBe(3);
    expect(agg.ptCount).toBe(3);
  });

  it("同値は同順位にし、次の順位はその数だけ飛ばす", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7 }),
      input(2, { exhibitionTime: 6.7 }),
      input(3, { exhibitionTime: 6.9 }),
    ]);

    expect(agg.boats.map((b) => b.timeRank)).toEqual([1, 1, 3]);
  });

  it("未計測の艇には順位を付けず、計測できた艇だけで最速 / 最遅 / 開きを出す", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.75 }),
      input(2, { exhibitionTime: null }),
      input(3, { exhibitionTime: 6.95 }),
    ]);

    expect(agg.boats.map((b) => b.timeRank)).toEqual([1, null, 2]);
    expect(agg.measuredTimeCount).toBe(2);
    expect(agg.fastestTime).toBe(6.75);
    expect(agg.slowestTime).toBe(6.95);
    expect(agg.timeSpread).toBeCloseTo(0.2, 10);
    expect(agg.boats[0]?.gapToFastestTime).toBe(0);
    expect(agg.boats[2]?.gapToFastestTime).toBeCloseTo(0.2, 10);
    expect(agg.boats[1]?.gapToFastestTime).toBeNull();
  });

  it("スタート展示ST は負値（フライング側）も含めて速い順に並べる", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionStartTiming: 0.15 }),
      input(2, { exhibitionStartTiming: -0.02 }),
      input(3, { exhibitionStartTiming: null }),
    ]);

    expect(agg.boats.map((b) => b.startTimingRank)).toEqual([2, 1, null]);
    expect(agg.measuredStartTimingCount).toBe(2);
  });

  it("rankGap は展示pt順位 − 展示タイム順位（正なら展示タイムの速さの割に展示pt が低い）", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7, exhibitPt: 45 }), // 展示最速なのに pt 最下位
      input(2, { exhibitionTime: 6.8, exhibitPt: 55 }),
      input(3, { exhibitionTime: 6.9, exhibitPt: 50 }),
    ]);

    expect(agg.boats.map((b) => b.rankGap)).toEqual([2, -1, -1]);
  });

  it("展示タイムが速い艇ほど展示pt が高いレースでは順位相関が +1 になる", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7, exhibitPt: 62 }),
      input(2, { exhibitionTime: 6.8, exhibitPt: 55 }),
      input(3, { exhibitionTime: 6.9, exhibitPt: 48 }),
      input(4, { exhibitionTime: 7.0, exhibitPt: 41 }),
    ]);

    expect(agg.ptTimeAgreement).toBeCloseTo(1, 10);
  });

  it("展示タイムと展示pt が逆順のレースでは順位相関が −1 になる", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7, exhibitPt: 41 }),
      input(2, { exhibitionTime: 6.8, exhibitPt: 48 }),
      input(3, { exhibitionTime: 6.9, exhibitPt: 62 }),
    ]);

    expect(agg.ptTimeAgreement).toBeCloseTo(-1, 10);
  });

  it("両方揃った艇が 3 未満、または全艇が中立値のレースでは順位相関を出さない", () => {
    const tooFew = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7, exhibitPt: 55 }),
      input(2, { exhibitionTime: 6.8, exhibitPt: 45 }),
      input(3, { exhibitionTime: null, exhibitPt: 50 }),
    ]);
    expect(tooFew.ptTimeAgreement).toBeNull();

    // daily 行は全艇が中立値 50 なので順位が付かず、相関も定義できない
    const daily = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7, exhibitPt: EXHIBIT_PT_DAILY_NEUTRAL }),
      input(2, { exhibitionTime: 6.8, exhibitPt: EXHIBIT_PT_DAILY_NEUTRAL }),
      input(3, { exhibitionTime: 6.9, exhibitPt: EXHIBIT_PT_DAILY_NEUTRAL }),
    ]);
    expect(daily.ptTimeAgreement).toBeNull();
  });

  it("艇番昇順に並べ替えて返す", () => {
    const agg = computeExhibitPtAggregate([
      input(6, { exhibitionTime: 6.9 }),
      input(1, { exhibitionTime: 6.7 }),
      input(3, { exhibitionTime: 6.8 }),
    ]);

    expect(agg.boats.map((b) => b.boatNumber)).toEqual([1, 3, 6]);
  });

  it("偏差値スケールは全成分共通の 50 ± 10", () => {
    expect(EXHIBIT_PT_SCALE).toEqual({ mean: 50, sd: 10 });
    expect(EXHIBIT_PT_DAILY_NEUTRAL).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 展示pt の再現（生値 → 偏差値 → 寄与）
// ─────────────────────────────────────────────────────────────────────

/**
 * 上流 (BoatraceCSV) の実データから採った検算ケース。`exhibitionTimes` /
 * `originalValues` は `previews/tkz` / `previews/original_exhibition` の生値、
 * `mu` / `sigma` / `weight` は `estimate/stadium/weights/v1_basic/2026-08.csv` の
 * その場の行、`expectedPt` / `expectedContribution` は同日の index CSV の
 * `N枠_展示pt` / `N枠_寄与_展示pt`（`状態=realtime` 行）。
 *
 * 場ごとの構成差を全部踏ませる: 3 項目場 / 2 項目場 / オリジナル展示が無い場
 * (江戸川) / 展示タイムが 1 艇も取れていないレース / 1 艇だけ全欠測のレース。
 */
type ExhibitGolden = {
  readonly note: string;
  readonly raceCode: string;
  readonly stadiumName: string;
  readonly exhibitionTimes: readonly (number | null)[];
  readonly originalLabels: readonly string[];
  readonly originalValues: readonly (readonly (number | null)[])[] | null;
  readonly mu: number;
  readonly sigma: number;
  readonly weight: number;
  readonly expectedPt: readonly number[];
  readonly expectedContribution: readonly number[];
};

const GOLDEN: readonly ExhibitGolden[] = [
  {
    note: "3 項目場 (芦屋 1R)",
    raceCode: "202608222101",
    stadiumName: "芦屋",
    exhibitionTimes: [6.92, 6.89, 6.88, 6.85, 6.87, 6.82],
    originalLabels: ["一周", "まわり足", "直線"],
    originalValues: [
      [36.77, 7.73, 7.73],
      [37.29, 7.96, 7.85],
      [37.04, 7.85, 7.85],
      [37.09, 8.06, 7.75],
      [36.9, 7.97, 7.73],
      [37.21, 7.95, 7.86],
    ],
    mu: 49.992816,
    sigma: 7.106081,
    weight: 0.217918,
    expectedPt: [60.47, 38.51, 48.34, 49.63, 55.4, 47.72],
    expectedContribution: [13.18, 8.39, 10.53, 10.82, 12.07, 10.4],
  },
  {
    note: "2 項目場 (尼崎 1R、計測数=2 なので 3 系列)",
    raceCode: "202608011301",
    stadiumName: "尼崎",
    exhibitionTimes: [6.88, 6.87, 6.86, 6.86, 6.95, 6.88],
    originalLabels: ["一周", "まわり足"],
    originalValues: [
      [37.22, 11.32],
      [37.74, 11.59],
      [38.02, 11.6],
      [38.41, 11.9],
      [38.2, 11.93],
      [37.93, 11.73],
    ],
    mu: 49.999981,
    sigma: 7.771881,
    weight: 0.240535,
    expectedPt: [65.85, 55.73, 53.72, 43.06, 32.35, 49.28],
    expectedContribution: [15.84, 13.4, 12.92, 10.36, 7.78, 11.85],
  },
  {
    note: "オリジナル展示が無い場 (江戸川 1R、展示タイム 1 系列のみ)",
    raceCode: "202608220301",
    stadiumName: "江戸川",
    exhibitionTimes: [6.59, 6.67, 6.74, 6.82, 6.68, 6.74],
    originalLabels: [],
    originalValues: null,
    mu: 50.015031,
    sigma: 9.997932,
    weight: 0.054525,
    expectedPt: [66.29, 55.11, 45.32, 34.14, 53.72, 45.32],
    expectedContribution: [3.61, 3.0, 2.47, 1.86, 2.93, 2.47],
  },
  {
    note: "展示タイムが 1 艇も取れていないレース (平和島 12R、オリジナル展示のみで決まる)",
    raceCode: "202608220412",
    stadiumName: "平和島",
    exhibitionTimes: [null, null, null, null, null, null],
    originalLabels: ["一周", "まわり足", "直線"],
    originalValues: [
      [37.73, 5.7, 7.52],
      [38.03, 5.7, 7.57],
      [37.51, 5.63, 7.5],
      [38.67, 5.62, 7.63],
      [38.01, 6.26, 7.9],
      [38.38, 5.93, 7.62],
    ],
    mu: 49.992141,
    sigma: 6.336523,
    weight: 0.21375,
    expectedPt: [61.03, 54.94, 66.44, 45.67, 29.15, 42.85],
    expectedContribution: [13.04, 11.74, 14.2, 9.76, 6.23, 9.16],
  },
  {
    note: "6 号艇だけ全欠測 (びわこ 7R、その艇は 50 補完)",
    raceCode: "202608011107",
    stadiumName: "びわこ",
    exhibitionTimes: [6.73, 6.75, 6.97, 6.93, 6.79, null],
    originalLabels: ["一周", "まわり足", "直線"],
    originalValues: [
      [37.5, 5.7, 8.17],
      [37.8, 6.07, 8.1],
      [38.3, 6.03, 8.0],
      [38.33, 6.37, 8.17],
      [38.16, 6.57, 7.87],
      [null, null, null],
    ],
    mu: 49.997425,
    sigma: 5.873534,
    weight: 0.19695,
    expectedPt: [63.78, 56.27, 44.3, 34.49, 51.18, 50.0],
    expectedContribution: [12.56, 11.08, 8.73, 6.79, 10.08, 9.85],
  },
];

const BOATS = [1, 2, 3, 4, 5, 6];

const goldenBasis = (g: ExhibitGolden): ExhibitPtBasis => ({
  predictorId: "v1_basic",
  mu: g.mu,
  sigma: g.sigma,
  weight: g.weight,
  weightsMonth: "2026-08",
});

const goldenSeries = (g: ExhibitGolden) =>
  buildExhibitPtSeries(
    BOATS,
    new Map(BOATS.map((n, i) => [n, g.exhibitionTimes[i] ?? null])),
    g.originalValues === null
      ? null
      : {
          labels: g.originalLabels,
          boats: BOATS.map((n, i) => ({
            boatNumber: n,
            values: g.originalValues?.[i] ?? [],
          })),
        },
  );

describe("raceHensachi", () => {
  it("小さい値ほど高い偏差値になる（上流 hensachi() と符号が逆向き）", () => {
    const out = raceHensachi([1, 2, 3]);
    expect(out[0]).toBeGreaterThan(50);
    expect(out[1]).toBeCloseTo(50, 10);
    expect(out[2]).toBeLessThan(50);
  });

  it("母標準偏差 (ddof=0) を使う", () => {
    // [1, 3] の平均 2 / 母標準偏差 1 → 1 は 50 + 10 × (2 − 1) / 1 = 60
    expect(raceHensachi([1, 3])[0]).toBeCloseTo(60, 10);
  });

  it("有効値が 2 未満の系列は全艇 null", () => {
    expect(raceHensachi([6.8, null, null])).toEqual([null, null, null]);
    expect(raceHensachi([null, null])).toEqual([null, null]);
  });

  it("全艇同値 (σ = 0) の系列は全艇 50", () => {
    expect(raceHensachi([6.8, 6.8, 6.8])).toEqual([50, 50, 50]);
  });
});

describe("buildExhibitPtSeries", () => {
  it("展示タイム → 計測項目順 の 4 系列を組む（上流の系列順と同じ）", () => {
    const series = goldenSeries(GOLDEN[0] as ExhibitGolden);
    expect(series.map((s) => s.label)).toEqual(["展示タイム", "一周", "まわり足", "直線"]);
    expect(series.map((s) => s.source)).toEqual([
      "exhibitionTime",
      "original",
      "original",
      "original",
    ]);
  });

  it("オリジナル展示が無い場は展示タイムの 1 系列だけ", () => {
    expect(goldenSeries(GOLDEN[2] as ExhibitGolden).map((s) => s.label)).toEqual(["展示タイム"]);
  });

  it("計測数=2 の場は 3 系列", () => {
    expect(goldenSeries(GOLDEN[1] as ExhibitGolden)).toHaveLength(3);
  });
});

describe("computeExhibitPtStepsByBoat", () => {
  for (const g of GOLDEN) {
    it(`上流 index CSV と小数第 2 位まで一致する: ${g.note}`, () => {
      const steps = computeExhibitPtStepsByBoat(goldenBasis(g), BOATS, goldenSeries(g));

      for (const [i, n] of BOATS.entries()) {
        const s = steps.get(n);
        expect(s, `${g.raceCode} ${n}枠`).toBeDefined();
        expect(Number((s?.pt ?? 0).toFixed(2)), `${g.raceCode} ${n}枠 展示pt`).toBe(
          g.expectedPt[i],
        );
        expect(Number((s?.contribution ?? 0).toFixed(2)), `${g.raceCode} ${n}枠 寄与`).toBe(
          g.expectedContribution[i],
        );
      }
    });
  }

  it("全系列が欠測の艇は生値 null・展示pt 50（上流の 50 補完と同じ）", () => {
    const g = GOLDEN[4] as ExhibitGolden;
    const steps = computeExhibitPtStepsByBoat(goldenBasis(g), BOATS, goldenSeries(g));
    const boat6 = steps.get(6);

    expect(boat6?.raw).toBeNull();
    expect(boat6?.usedCount).toBe(0);
    expect(boat6?.pt).toBe(EXHIBIT_PT_DAILY_NEUTRAL);
  });

  it("4 系列は等重み — 展示タイム最速でも他 3 項目が最下位なら展示pt は下がる", () => {
    const basis: ExhibitPtBasis = {
      predictorId: "v1_basic",
      mu: 50,
      sigma: 10,
      weight: 0.2,
      weightsMonth: "2026-08",
    };
    // 1 号艇: 展示タイム最速 / オリジナル 3 項目は最下位
    const series = buildExhibitPtSeries(
      [1, 2],
      new Map([
        [1, 6.7],
        [2, 6.9],
      ]),
      {
        labels: ["一周", "まわり足", "直線"],
        boats: [
          { boatNumber: 1, values: [38.0, 6.5, 8.0] },
          { boatNumber: 2, values: [37.0, 6.0, 7.5] },
        ],
      },
    );
    const steps = computeExhibitPtStepsByBoat(basis, [1, 2], series);

    // 展示タイムだけ +10、他 3 項目が −10 → 生値 = (60 + 40 + 40 + 40) / 4 = 45
    expect(steps.get(1)?.raw).toBe(45);
    expect(steps.get(1)?.pt).toBeCloseTo(45, 10);
    expect(steps.get(1)?.terms.map((t) => t.rank)).toEqual([1, 2, 2, 2]);
  });

  it("σ が 0 の場は z=0 に倒す（上流と同じ）", () => {
    const basis: ExhibitPtBasis = {
      predictorId: "v1_basic",
      mu: 50,
      sigma: 0,
      weight: 0.2,
      weightsMonth: "2026-08",
    };
    const series = buildExhibitPtSeries(
      [1, 2],
      new Map([
        [1, 6.7],
        [2, 6.9],
      ]),
      null,
    );
    expect(computeExhibitPtStepsByBoat(basis, [1, 2], series).get(1)?.pt).toBe(
      EXHIBIT_PT_SCALE.mean,
    );
  });
});

describe("exhibitPtMatchesIndex", () => {
  it("小数第 2 位まで一致していれば true", () => {
    expect(exhibitPtMatchesIndex(60.4712, 60.47)).toBe(true);
    expect(exhibitPtMatchesIndex(60.48, 60.47)).toBe(false);
    expect(exhibitPtMatchesIndex(undefined, 60.47)).toBe(false);
    expect(exhibitPtMatchesIndex(60.47, undefined)).toBe(false);
  });
});
