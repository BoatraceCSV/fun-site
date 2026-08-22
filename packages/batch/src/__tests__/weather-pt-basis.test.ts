import type { SuiParamsRow } from "@fun-site/shared";
import { computeWeatherFeatures, computeWeatherPtSteps } from "@fun-site/shared";
import { describe, expect, it } from "vitest";
import type { StadiumWeightsFetch } from "../fetcher/index.js";
import { buildWeatherPtBasisByStadium } from "../site-builder/weather-pt-basis.js";

/** 芦屋 (21) の気象回帰係数。値は 2026-08 時点の sui_params.csv 実データ */
const ASHIYA_PARAMS: SuiParamsRow[] = [
  {
    stadiumName: "芦屋",
    coefs: {
      waveCm: [-0.0511, 0.0617, 0.0094, -0.0411, -0.0382, 0.0592],
      tempDiffC: [-0.0039, 0.0135, 0.0228, -0.0293, -0.0149, 0.0119],
      windTailMs: [-0.0261, -0.0985, 0.0209, 0.0186, 0.0876, -0.0025],
      windHeadMs: [0.0063, 0.0125, 0.0044, -0.0261, 0.0211, -0.0182],
      isCloudy: [0.1215, -0.0219, -0.011, -0.3169, 0.1388, 0.0895],
      isRainy: [0.1195, 0.0058, 0.219, -0.2573, -0.1011, 0.0142],
    },
  },
];

const ASHIYA_WEIGHTS: StadiumWeightsFetch = {
  predictorId: "v1_basic",
  month: "2026-08",
  rows: [{ stadiumName: "芦屋", mu: -0.000154, sigma: 0.187976, weight: 0.094823 }],
};

describe("buildWeatherPtBasisByStadium", () => {
  it("場名キーの 2 テーブルを突合し、場コードで引けるようにする", () => {
    const basis = buildWeatherPtBasisByStadium(ASHIYA_PARAMS, ASHIYA_WEIGHTS).get("21");

    expect(basis).toBeDefined();
    expect(basis?.predictorId).toBe("v1_basic");
    expect(basis?.weightsMonth).toBe("2026-08");
    expect(basis?.coefs.waveCm[0]).toBe(-0.0511);
    expect(basis?.sigma).toBe(0.187976);
  });

  it("index CSV の 気象pt / 寄与 を再現する", () => {
    // 2026-08-22 芦屋 1R: 波1cm / 風向5(南)1.0m/s / 晴 / 気温29.4・水温31.0。
    // index CSV の 1枠(1コース進入) は 気象pt=47.95 / 寄与=4.55。
    const basis = buildWeatherPtBasisByStadium(ASHIYA_PARAMS, ASHIYA_WEIGHTS).get("21");
    const features = computeWeatherFeatures(
      {
        weather: "1",
        windSpeed: 1,
        windDirection: "5",
        waveHeight: 1,
        airTemperature: 29.4,
        waterTemperature: 31.0,
      },
      "21",
    );
    // 芦屋のスタンド方位は 0°、風向 5 = 180° なので向かい風
    expect(features.windRelation).toBe("head");

    const steps = computeWeatherPtSteps(basis!, features, 1);

    expect(steps?.rawAdvantage).toBe(-0.0386);
    expect(steps?.pt).toBeCloseTo(47.95, 2);
    expect(steps?.contribution).toBeCloseTo(4.55, 2);
  });

  it("係数か重みの片方しか無い場は落とす（再現できないため）", () => {
    expect(buildWeatherPtBasisByStadium(ASHIYA_PARAMS, undefined).size).toBe(0);
    expect(buildWeatherPtBasisByStadium([], ASHIYA_WEIGHTS).size).toBe(0);
    expect(buildWeatherPtBasisByStadium(ASHIYA_PARAMS, { ...ASHIYA_WEIGHTS, rows: [] }).size).toBe(
      0,
    );
  });

  it("場マスタに無い場名の行は落とす", () => {
    const map = buildWeatherPtBasisByStadium([{ ...ASHIYA_PARAMS[0]!, stadiumName: "架空場" }], {
      ...ASHIYA_WEIGHTS,
      rows: [{ ...ASHIYA_WEIGHTS.rows[0]!, stadiumName: "架空場" }],
    });
    expect(map.size).toBe(0);
  });
});
