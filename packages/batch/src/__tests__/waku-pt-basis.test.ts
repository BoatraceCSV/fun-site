import type { WakuTableRow } from "@fun-site/shared";
import { computeWakuPtSteps } from "@fun-site/shared";
import { describe, expect, it } from "vitest";
import type { StadiumWeightsFetch } from "../fetcher/index.js";
import { buildWakuPtBasisByStadium } from "../site-builder/waku-pt-basis.js";

/** 戸田 (02) の 4 季節ぶん。値は 2026-08 時点の win_rate.csv 実データ */
const TODA_TABLE: WakuTableRow[] = [
  { stadiumId: "02", season: "春", rates: [6.832, 5.542, 5.44, 5.104, 4.25, 3.036] },
  { stadiumId: "02", season: "夏", rates: [7.232, 5.448, 5.074, 4.994, 4.398, 2.998] },
  { stadiumId: "02", season: "秋", rates: [7.064, 5.498, 5.362, 4.88, 4.306, 3.2] },
  { stadiumId: "02", season: "冬", rates: [7.276, 5.452, 5.502, 4.946, 4.29, 2.82] },
];

const TODA_WEIGHTS: StadiumWeightsFetch = {
  predictorId: "v1_basic",
  month: "2026-08",
  rows: [{ stadiumName: "戸田", mu: 5.036928, sigma: 1.224463, weight: 0.280848 }],
};

describe("buildWakuPtBasisByStadium", () => {
  it("場名キーの weights と場コードキーのテーブルを突合する", () => {
    const map = buildWakuPtBasisByStadium(TODA_TABLE, TODA_WEIGHTS, "2026-08-22");
    const basis = map.get("02");

    expect(basis).toBeDefined();
    expect(basis?.predictorId).toBe("v1_basic");
    expect(basis?.weightsMonth).toBe("2026-08");
    expect(basis?.season).toBe("夏");
    expect(basis?.ratesBySeason.夏[0]).toBe(7.232);
  });

  it("index CSV の 枠番pt / 寄与 を再現する", () => {
    // 2026-08-22 戸田 1R の 1枠: index CSV は 枠番pt=67.93 / 寄与=19.08
    const basis = buildWakuPtBasisByStadium(TODA_TABLE, TODA_WEIGHTS, "2026-08-22").get("02");
    const steps = computeWakuPtSteps(basis!, 1);

    expect(steps?.rawRate).toBe(7.232);
    expect(steps?.pt).toBeCloseTo(67.93, 2);
    expect(steps?.contribution).toBeCloseTo(19.08, 2);
  });

  it("レース日の月から季節を決める", () => {
    const seasons = ["2026-03-01", "2026-06-01", "2026-09-01", "2026-12-01"].map(
      (d) => buildWakuPtBasisByStadium(TODA_TABLE, TODA_WEIGHTS, d).get("02")?.season,
    );
    expect(seasons).toEqual(["春", "夏", "秋", "冬"]);
  });

  it("weights が無ければ空 (枠番pt を再現できないので根拠を出さない)", () => {
    expect(buildWakuPtBasisByStadium(TODA_TABLE, undefined, "2026-08-22").size).toBe(0);
  });

  it("4 季節が揃わない場は落とす", () => {
    const partial = TODA_TABLE.filter((r) => r.season !== "冬");
    expect(buildWakuPtBasisByStadium(partial, TODA_WEIGHTS, "2026-08-22").size).toBe(0);
  });

  it("場マスタに無い場名の weights 行は無視する", () => {
    const weights: StadiumWeightsFetch = {
      ...TODA_WEIGHTS,
      rows: [{ stadiumName: "存在しない場", mu: 5, sigma: 1, weight: 0.3 }],
    };
    expect(buildWakuPtBasisByStadium(TODA_TABLE, weights, "2026-08-22").size).toBe(0);
  });
});

describe("computeWakuPtSteps", () => {
  const basis = buildWakuPtBasisByStadium(TODA_TABLE, TODA_WEIGHTS, "2026-08-22").get("02")!;

  it("コースが 1〜6 の外なら undefined", () => {
    expect(computeWakuPtSteps(basis, 0)).toBeUndefined();
    expect(computeWakuPtSteps(basis, 7)).toBeUndefined();
  });

  it("σ が 0 の場は偏差値 50 に倒す (上流と同じ)", () => {
    const steps = computeWakuPtSteps({ ...basis, sigma: 0 }, 1);
    expect(steps?.z).toBe(0);
    expect(steps?.pt).toBe(50);
  });
});
