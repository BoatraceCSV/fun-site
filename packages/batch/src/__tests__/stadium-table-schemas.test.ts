import { describe, expect, it } from "vitest";
import { parseStadiumWakuWeights, parseWakuTable } from "../fetcher/stadium-table-schemas.js";

const WAKU_TABLE_HEADER =
  "場コード,季節,1コース勝率,2コース勝率,3コース勝率,4コース勝率,5コース勝率,6コース勝率";

const WEIGHTS_HEADER =
  "stadium,n_samples,mu_waku,sigma_waku,mu_racer,sigma_racer,w_waku,w_racer,r2,fallback";

describe("parseWakuTable", () => {
  it("場コード / 季節 / 6 コースの勝率を読む", () => {
    const csv = [
      WAKU_TABLE_HEADER,
      "02,夏,7.232,5.448,5.074,4.994,4.398,2.998",
      "02,冬,7.276,5.452,5.502,4.946,4.29,2.82",
    ].join("\n");

    expect(parseWakuTable(csv)).toEqual([
      { stadiumId: "02", season: "夏", rates: [7.232, 5.448, 5.074, 4.994, 4.398, 2.998] },
      { stadiumId: "02", season: "冬", rates: [7.276, 5.452, 5.502, 4.946, 4.29, 2.82] },
    ]);
  });

  it("場コードは 2 桁にゼロ詰めする", () => {
    const csv = [WAKU_TABLE_HEADER, "1,春,7.7,5.2,5.2,4.7,4.5,3.0"].join("\n");
    expect(parseWakuTable(csv)[0]?.stadiumId).toBe("01");
  });

  it("コース値が欠けている行は落とす（0 として表示すると嘘になるため）", () => {
    const csv = [
      WAKU_TABLE_HEADER,
      "02,夏,7.232,5.448,,4.994,4.398,2.998",
      "02,秋,7.064,5.498,5.362,4.88,4.306,3.2",
    ].join("\n");

    const rows = parseWakuTable(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.season).toBe("秋");
  });

  it("未知の季節ラベルの行は落とす", () => {
    const csv = [WAKU_TABLE_HEADER, "02,梅雨,7.2,5.4,5.0,4.9,4.3,2.9"].join("\n");
    expect(parseWakuTable(csv)).toEqual([]);
  });
});

describe("parseStadiumWakuWeights", () => {
  it("waku 成分の μ / σ / w だけを取り出す", () => {
    const csv = [
      WEIGHTS_HEADER,
      "戸田,5273,5.036928,1.224463,53.623517,5.035514,0.280848,0.26655,0.168325,0",
    ].join("\n");

    expect(parseStadiumWakuWeights(csv)).toEqual([
      { stadiumName: "戸田", mu: 5.036928, sigma: 1.224463, weight: 0.280848 },
    ]);
  });

  it("waku 成分を持たない予想者の weights ファイルは空になる", () => {
    // course 成分に差し替えた予想者の weights には mu_waku 等が無い
    const csv = [
      "stadium,n_samples,mu_course,sigma_course,w_course",
      "戸田,5273,35.2,8.1,0.31",
    ].join("\n");
    expect(parseStadiumWakuWeights(csv)).toEqual([]);
  });
});
