import { describe, expect, it } from "vitest";
import {
  parseStadiumComponentWeights,
  parseSuiParams,
  parseWakuTable,
} from "../fetcher/stadium-table-schemas.js";

const WAKU_TABLE_HEADER =
  "場コード,季節,1コース勝率,2コース勝率,3コース勝率,4コース勝率,5コース勝率,6コース勝率";

const WEIGHTS_HEADER =
  "stadium,n_samples,mu_waku,sigma_waku,mu_racer,sigma_racer,mu_weather,sigma_weather," +
  "w_waku,w_racer,w_weather,r2,fallback";

/** sui_params.csv の列順（base 6 列 + 特徴量 6 種 × 6 コース） */
const SUI_PARAMS_HEADER = [
  "stadium",
  ...[
    "base",
    "wave_cm",
    "temp_diff",
    "wind_tail_ms",
    "wind_head_ms",
    "is_cloudy",
    "is_rainy",
  ].flatMap((feat) => [1, 2, 3, 4, 5, 6].map((c) => `${feat}_c${c}`)),
].join(",");

/** 1 場ぶんの行。各特徴量は `${index}.${course}` と読める値にして取り違えを検出する */
const suiParamsRow = (stadium: string): string =>
  [
    stadium,
    ...[0, 1, 2, 3, 4, 5, 6].flatMap((feat) => [1, 2, 3, 4, 5, 6].map((c) => `${feat}.${c}`)),
  ].join(",");

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

describe("parseSuiParams", () => {
  it("特徴量 × コースの係数を読む（base 切片は読まない）", () => {
    const csv = [SUI_PARAMS_HEADER, suiParamsRow("桐生")].join("\n");

    expect(parseSuiParams(csv)).toEqual([
      {
        stadiumName: "桐生",
        coefs: {
          // feat 0 は base_c*。読み飛ばされるので wave_cm は 1.x から始まる
          waveCm: [1.1, 1.2, 1.3, 1.4, 1.5, 1.6],
          tempDiffC: [2.1, 2.2, 2.3, 2.4, 2.5, 2.6],
          windTailMs: [3.1, 3.2, 3.3, 3.4, 3.5, 3.6],
          windHeadMs: [4.1, 4.2, 4.3, 4.4, 4.5, 4.6],
          isCloudy: [5.1, 5.2, 5.3, 5.4, 5.5, 5.6],
          isRainy: [6.1, 6.2, 6.3, 6.4, 6.5, 6.6],
        },
      },
    ]);
  });

  it("係数が 1 つでも欠けている行は落とす（0 として扱うと嘘になるため）", () => {
    const broken = suiParamsRow("戸田").replace(",3.4,", ",,");
    const csv = [SUI_PARAMS_HEADER, broken, suiParamsRow("江戸川")].join("\n");

    const rows = parseSuiParams(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stadiumName).toBe("江戸川");
  });
});

describe("parseStadiumComponentWeights", () => {
  it("指定した成分の μ / σ / w だけを取り出す", () => {
    const csv = [
      WEIGHTS_HEADER,
      "戸田,5273,5.036928,1.224463,53.623517,5.035514,-0.000078,0.17484,0.280848,0.26655,0.082971,0.22,0",
    ].join("\n");

    expect(parseStadiumComponentWeights(csv, "waku")).toEqual([
      { stadiumName: "戸田", mu: 5.036928, sigma: 1.224463, weight: 0.280848 },
    ]);
    expect(parseStadiumComponentWeights(csv, "weather")).toEqual([
      { stadiumName: "戸田", mu: -0.000078, sigma: 0.17484, weight: 0.082971 },
    ]);
  });

  it("その成分を持たない予想者の weights ファイルは空になる", () => {
    // course 成分に差し替えた予想者の weights には mu_waku 等が無い
    const csv = [
      "stadium,n_samples,mu_course,sigma_course,w_course",
      "戸田,5273,35.2,8.1,0.31",
    ].join("\n");
    expect(parseStadiumComponentWeights(csv, "waku")).toEqual([]);
    expect(parseStadiumComponentWeights(csv, "weather")).toEqual([]);
  });
});
