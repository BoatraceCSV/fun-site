import { buildExhibitPtSeries, computeExhibitPtStepsByBoat } from "@fun-site/shared";
import { describe, expect, it } from "vitest";
import type { StadiumWeightsFetch } from "../fetcher/index.js";
import { buildExhibitPtBasisByStadium } from "../site-builder/exhibit-pt-basis.js";

/** 芦屋 (21) の展示pt 成分。値は 2026-08 の weights/v1_basic 実データ */
const ASHIYA_WEIGHTS: StadiumWeightsFetch = {
  predictorId: "v1_basic",
  month: "2026-08",
  rows: [{ stadiumName: "芦屋", mu: 49.992816, sigma: 7.106081, weight: 0.217918 }],
};

const BOATS = [1, 2, 3, 4, 5, 6];

describe("buildExhibitPtBasisByStadium", () => {
  it("場名キーの weights を場コードで引けるようにする", () => {
    const basis = buildExhibitPtBasisByStadium(ASHIYA_WEIGHTS).get("21");

    expect(basis).toBeDefined();
    expect(basis?.predictorId).toBe("v1_basic");
    expect(basis?.weightsMonth).toBe("2026-08");
    expect(basis?.mu).toBe(49.992816);
    expect(basis?.sigma).toBe(7.106081);
    expect(basis?.weight).toBe(0.217918);
  });

  it("index CSV の 展示pt / 寄与 を再現する", () => {
    // 2026-08-22 芦屋 1R。展示タイム (previews/tkz) とオリジナル展示 3 項目
    // (previews/original_exhibition) から、index CSV の 1枠 展示pt=60.47 / 寄与=13.18。
    const basis = buildExhibitPtBasisByStadium(ASHIYA_WEIGHTS).get("21");
    const series = buildExhibitPtSeries(
      BOATS,
      new Map([
        [1, 6.92],
        [2, 6.89],
        [3, 6.88],
        [4, 6.85],
        [5, 6.87],
        [6, 6.82],
      ]),
      {
        labels: ["一周", "まわり足", "直線"],
        boats: [
          { boatNumber: 1, values: [36.77, 7.73, 7.73] },
          { boatNumber: 2, values: [37.29, 7.96, 7.85] },
          { boatNumber: 3, values: [37.04, 7.85, 7.85] },
          { boatNumber: 4, values: [37.09, 8.06, 7.75] },
          { boatNumber: 5, values: [36.9, 7.97, 7.73] },
          { boatNumber: 6, values: [37.21, 7.95, 7.86] },
        ],
      },
    );

    // biome-ignore lint/style/noNonNullAssertion: 直前の toBeDefined 相当を上で確認済み
    const steps = computeExhibitPtStepsByBoat(basis!, BOATS, series);

    expect(steps.get(1)?.pt).toBeCloseTo(60.47, 2);
    expect(steps.get(1)?.contribution).toBeCloseTo(13.18, 2);
    expect(steps.get(2)?.pt).toBeCloseTo(38.51, 2);
    expect(steps.get(6)?.pt).toBeCloseTo(47.72, 2);
  });

  it("weights が取れていなければ空 Map（画面は根拠テーブル未取得の表示に倒す）", () => {
    expect(buildExhibitPtBasisByStadium(undefined).size).toBe(0);
    expect(buildExhibitPtBasisByStadium({ ...ASHIYA_WEIGHTS, rows: [] }).size).toBe(0);
  });

  it("場マスタに無い場名の行は落とす", () => {
    const map = buildExhibitPtBasisByStadium({
      ...ASHIYA_WEIGHTS,
      // biome-ignore lint/style/noNonNullAssertion: テスト固定データ
      rows: [{ ...ASHIYA_WEIGHTS.rows[0]!, stadiumName: "架空場" }],
    });
    expect(map.size).toBe(0);
  });
});
