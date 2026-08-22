import { describe, expect, it } from "vitest";
import type { WeatherPtBasis } from "../types/stadium-table.js";
import {
  STADIUM_FACING_DEG,
  WEATHER_PT_DAILY_NEUTRAL,
  WEATHER_PT_SCALE,
  type WeatherFeatureInput,
  type WeatherPtInput,
  classifyWind,
  computeWeatherFeatures,
  computeWeatherPtAggregate,
  computeWeatherPtSteps,
  weatherRegressionCategory,
} from "../utils/weather-pt.js";

/**
 * テストするのは (1) 水面気象 → 特徴量、(2) 特徴量 × 係数 → 生値 → 偏差値 → 寄与 の
 * 再現（上流 index CSV と一致する式であること）、(3) 6 艇の気象pt を順位・進入コースと
 * 並べる参考値の集計。
 */
const input = (boatNumber: number, overrides: Partial<WeatherPtInput> = {}): WeatherPtInput => ({
  boatNumber,
  courseNumber: boatNumber,
  weatherPt: undefined,
  ...overrides,
});

const weather = (overrides: Partial<WeatherFeatureInput> = {}): WeatherFeatureInput => ({
  weather: "1",
  windSpeed: 0,
  windDirection: "",
  waveHeight: 0,
  airTemperature: 20,
  waterTemperature: 20,
  ...overrides,
});

describe("classifyWind", () => {
  it("スタンド方位と同じ向きの風は追い風、真逆は向かい風、直交は横風", () => {
    // 戸田 (02) の facing は 0°。風向コード 1 = 0°、5 = 180°、3 = 90°
    expect(classifyWind("1", "02")?.relation).toBe("tail");
    expect(classifyWind("5", "02")?.relation).toBe("head");
    expect(classifyWind("3", "02")?.relation).toBe("cross");
  });

  it("場ごとのスタンド方位で判定が変わる", () => {
    // 桐生 (01) の facing は 90°。風向コード 3 = 90° なので追い風になる
    expect(STADIUM_FACING_DEG["01"]).toBe(90);
    expect(classifyWind("3", "01")?.relation).toBe("tail");
    expect(classifyWind("1", "01")?.relation).toBe("cross");
  });

  it("風向が空欄 / 未知コード / 未知の場コードなら null", () => {
    expect(classifyWind("", "02")).toBeNull();
    expect(classifyWind(undefined, "02")).toBeNull();
    expect(classifyWind("9", "02")).toBeNull();
    expect(classifyWind("1", "99")).toBeNull();
  });
});

describe("weatherRegressionCategory", () => {
  it("雪・霧は雨に、コード 6 / 9 と未知コードは晴に畳む", () => {
    expect(weatherRegressionCategory("1")).toBe("晴");
    expect(weatherRegressionCategory("2")).toBe("曇");
    expect(weatherRegressionCategory("3")).toBe("雨");
    expect(weatherRegressionCategory("4")).toBe("雨");
    expect(weatherRegressionCategory("5")).toBe("雨");
    expect(weatherRegressionCategory("6")).toBe("晴");
    expect(weatherRegressionCategory("")).toBe("晴");
  });
});

describe("computeWeatherFeatures", () => {
  it("追い風のときは windTailMs だけに風速が入る", () => {
    const f = computeWeatherFeatures(weather({ windSpeed: 4, windDirection: "1" }), "02");

    expect(f.windRelation).toBe("tail");
    expect(f.windTailMs).toBe(4);
    expect(f.windHeadMs).toBe(0);
  });

  it("向かい風のときは windHeadMs だけに風速が入る", () => {
    const f = computeWeatherFeatures(weather({ windSpeed: 4, windDirection: "5" }), "02");

    expect(f.windRelation).toBe("head");
    expect(f.windTailMs).toBe(0);
    expect(f.windHeadMs).toBe(4);
  });

  it("横風・風向不明のときはどちらの風成分も 0 になる", () => {
    const cross = computeWeatherFeatures(weather({ windSpeed: 4, windDirection: "3" }), "02");
    const unknown = computeWeatherFeatures(weather({ windSpeed: 4, windDirection: "" }), "02");

    expect(cross.windRelation).toBe("cross");
    expect(cross.windTailMs).toBe(0);
    expect(cross.windHeadMs).toBe(0);
    expect(unknown.windRelation).toBeNull();
    expect(unknown.windTailMs).toBe(0);
    expect(unknown.windHeadMs).toBe(0);
  });

  it("気温 − 水温 と天候ダミーを組み立てる", () => {
    const f = computeWeatherFeatures(
      weather({ weather: "3", waveHeight: 5, airTemperature: 12, waterTemperature: 15 }),
      "02",
    );

    expect(f.waveCm).toBe(5);
    expect(f.tempDiffC).toBe(-3);
    expect(f.isCloudy).toBe(false);
    expect(f.isRainy).toBe(true);
    expect(f.facingDeg).toBe(0);
  });
});

describe("computeWeatherPtAggregate", () => {
  it("気象pt は高い順で順位を付け、最上位との差を出す", () => {
    const agg = computeWeatherPtAggregate([
      input(1, { weatherPt: 52 }),
      input(2, { weatherPt: 58 }),
      input(3, { weatherPt: 46 }),
    ]);

    expect(agg.boats.map((b) => b.ptRank)).toEqual([2, 1, 3]);
    expect(agg.topPt).toBe(58);
    expect(agg.bottomPt).toBe(46);
    expect(agg.ptSpread).toBe(12);
    expect(agg.boats.map((b) => b.gapToTopPt)).toEqual([-6, 0, -12]);
    expect(agg.ptCount).toBe(3);
  });

  it("同値は同順位にし、次の順位はその数だけ飛ばす", () => {
    const agg = computeWeatherPtAggregate([
      input(1, { weatherPt: 55 }),
      input(2, { weatherPt: 55 }),
      input(3, { weatherPt: 40 }),
    ]);

    expect(agg.boats.map((b) => b.ptRank)).toEqual([1, 1, 3]);
  });

  it("偏差値スケールから z を出す", () => {
    const agg = computeWeatherPtAggregate([input(1, { weatherPt: 60 })]);

    expect(WEATHER_PT_SCALE).toEqual({ mean: 50, sd: 10 });
    expect(agg.boats[0]?.z).toBeCloseTo(1, 10);
  });

  it("pt が無い艇には順位も z も付けない", () => {
    const agg = computeWeatherPtAggregate([
      input(1, { weatherPt: 55 }),
      input(2),
      input(3, { weatherPt: 45 }),
    ]);

    expect(agg.boats.map((b) => b.ptRank)).toEqual([1, null, 2]);
    expect(agg.boats[1]?.z).toBeNull();
    expect(agg.ptCount).toBe(2);
  });

  it("内コースほど気象pt が高いレースは innerBias が正になる", () => {
    const agg = computeWeatherPtAggregate([
      input(1, { weatherPt: 60 }),
      input(2, { weatherPt: 55 }),
      input(3, { weatherPt: 50 }),
      input(4, { weatherPt: 47 }),
      input(5, { weatherPt: 44 }),
      input(6, { weatherPt: 40 }),
    ]);

    expect(agg.innerBias).toBeCloseTo(1, 10);
  });

  it("外コースほど気象pt が高いレースは innerBias が負になる", () => {
    const agg = computeWeatherPtAggregate([
      input(1, { weatherPt: 40 }),
      input(2, { weatherPt: 44 }),
      input(3, { weatherPt: 48 }),
      input(4, { weatherPt: 52 }),
      input(5, { weatherPt: 56 }),
      input(6, { weatherPt: 60 }),
    ]);

    expect(agg.innerBias).toBeCloseTo(-1, 10);
  });

  it("全艇が中立値 50 の daily 評価は allNeutral、順位相関は出せない", () => {
    const agg = computeWeatherPtAggregate(
      [1, 2, 3, 4, 5, 6].map((n) => input(n, { weatherPt: WEATHER_PT_DAILY_NEUTRAL })),
    );

    expect(agg.allNeutral).toBe(true);
    expect(agg.ptSpread).toBe(0);
    expect(agg.innerBias).toBeNull();
  });

  it("進入コースが枠番と違う艇に courseShifted を立てる", () => {
    const agg = computeWeatherPtAggregate([
      input(1, { courseNumber: 2, weatherPt: 48 }),
      input(2, { courseNumber: 1, weatherPt: 58 }),
      input(3, { weatherPt: 50 }),
    ]);

    expect(agg.boats.map((b) => b.courseShifted)).toEqual([true, true, false]);
  });
});

/** 係数は「コース番号 × 特徴量の位置」が分かる値にして、列の取り違えを検出する */
const basis = (overrides: Partial<WeatherPtBasis> = {}): WeatherPtBasis => ({
  predictorId: "v1_basic",
  coefs: {
    waveCm: [0.11, 0.12, 0.13, 0.14, 0.15, 0.16],
    tempDiffC: [0.21, 0.22, 0.23, 0.24, 0.25, 0.26],
    windTailMs: [0.31, 0.32, 0.33, 0.34, 0.35, 0.36],
    windHeadMs: [0.41, 0.42, 0.43, 0.44, 0.45, 0.46],
    isCloudy: [0.51, 0.52, 0.53, 0.54, 0.55, 0.56],
    isRainy: [0.61, 0.62, 0.63, 0.64, 0.65, 0.66],
  },
  mu: 0,
  sigma: 0.2,
  weight: 0.08,
  weightsMonth: "2026-08",
  ...overrides,
});

describe("computeWeatherPtSteps", () => {
  it("その艇の進入コースの列だけを引き、生値 → 偏差値 → 寄与 まで出す", () => {
    // 戸田 (facing 0°) で風向 5 = 180° → 向かい風 2m/s、波 3cm、気温−水温 = +1、曇り
    const features = computeWeatherFeatures(
      weather({
        weather: "2",
        windSpeed: 2,
        windDirection: "5",
        waveHeight: 3,
        airTemperature: 21,
        waterTemperature: 20,
      }),
      "02",
    );

    const steps = computeWeatherPtSteps(basis(), features, 3);
    if (!steps) throw new Error("steps should be defined");

    // 3コースの係数だけを使う: 3×0.13 + 1×0.23 + 0×0.33 + 2×0.43 + 1×0.53 + 0×0.63
    expect(steps.terms.map((t) => t.coef)).toEqual([0.13, 0.23, 0.33, 0.43, 0.53, 0.63]);
    expect(steps.rawAdvantage).toBeCloseTo(2.01, 10);
    expect(steps.z).toBeCloseTo(10.05, 10);
    expect(steps.pt).toBeCloseTo(150.5, 10);
    expect(steps.contribution).toBeCloseTo(0.08 * 150.5, 10);
  });

  it("生値は小数第 4 位に丸める（上流 index_features.py の round(v, 4) と揃える）", () => {
    const features = computeWeatherFeatures(weather({ waveHeight: 1 }), "02");
    // 波 1cm × 0.11 のみ。丸めが効くよう 5 桁目を持つ係数にする
    const steps = computeWeatherPtSteps(
      basis({ coefs: { ...basis().coefs, waveCm: [0.12345, 0, 0, 0, 0, 0] } }),
      features,
      1,
    );

    expect(steps?.rawAdvantage).toBe(0.1235);
  });

  it("σ が 0 の場は上流と同じく z = 0（偏差値 50）に倒す", () => {
    const features = computeWeatherFeatures(weather({ waveHeight: 5 }), "02");
    const steps = computeWeatherPtSteps(basis({ sigma: 0 }), features, 1);

    expect(steps?.z).toBe(0);
    expect(steps?.pt).toBe(WEATHER_PT_SCALE.mean);
  });

  it("コースが 1〜6 の外なら undefined", () => {
    const features = computeWeatherFeatures(weather(), "02");
    expect(computeWeatherPtSteps(basis(), features, 0)).toBeUndefined();
    expect(computeWeatherPtSteps(basis(), features, 7)).toBeUndefined();
  });
});
