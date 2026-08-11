import { describe, expect, it } from "vitest";
import { parseRacerSt } from "../fetcher/racer-st-schemas.js";

/** 帯 (推定ST_p25 / _p75) 導入前のヘッダ。後方互換の検証に使う */
const LEGACY_HEADER = [
  "レースコード",
  "レース日",
  "レース場コード",
  "レース回",
  ...[1, 2, 3, 4, 5, 6].flatMap((b) => [`${b}枠_登録番号`, `${b}枠_推定ST`]),
].join(",");

/** 現行ヘッダ (帯つき) */
const HEADER = [
  "レースコード",
  "レース日",
  "レース場コード",
  "レース回",
  ...[1, 2, 3, 4, 5, 6].flatMap((b) => [
    `${b}枠_登録番号`,
    `${b}枠_推定ST`,
    `${b}枠_推定ST_p25`,
    `${b}枠_推定ST_p75`,
  ]),
].join(",");

describe("parseRacerSt", () => {
  it("1 レース 1 行 × 6 枠の推定 ST と帯をパースする", () => {
    const csv = [
      HEADER,
      [
        "202607200101,2026-07-20,01,01R",
        "3303,0.1512,0.1090,0.1934",
        "4663,0.1723,0.1301,0.2145",
        "4001,0.1601,0.1179,0.2023",
        "4002,0.1655,0.1233,0.2077",
        "4003,0.1688,0.1266,0.2110",
        "4004,0.1901,0.1479,0.2323",
      ].join(","),
    ].join("\n");
    const rows = parseRacerSt(csv);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.raceCode).toBe("202607200101");
    expect(row?.raceDate).toBe("2026-07-20");
    expect(row?.entries).toHaveLength(6);
    expect(row?.entries[0]).toEqual({
      boatNumber: 1,
      registrationNumber: 3303,
      estimatedST: 0.1512,
      estimatedStP25: 0.109,
      estimatedStP75: 0.1934,
    });
    expect(row?.entries[5]).toEqual({
      boatNumber: 6,
      registrationNumber: 4004,
      estimatedST: 0.1901,
      estimatedStP25: 0.1479,
      estimatedStP75: 0.2323,
    });
  });

  it("帯は推定 ST を中心に対称", () => {
    const csv = [
      HEADER,
      [
        "202607200101,2026-07-20,01,01R",
        "3303,0.1512,0.1090,0.1934",
        ",,,",
        ",,,",
        ",,,",
        ",,,",
        ",,,",
      ].join(","),
    ].join("\n");
    const e = parseRacerSt(csv)[0]?.entries[0];
    const est = e?.estimatedST ?? 0;
    expect(est - (e?.estimatedStP25 ?? 0)).toBeCloseTo((e?.estimatedStP75 ?? 0) - est, 3);
  });

  it("欠場枠 (空欄) は null になる", () => {
    const csv = [
      HEADER,
      [
        "202607200102,2026-07-20,01,02R",
        "3303,0.1512,0.1090,0.1934",
        ",,,",
        "4001,0.1601,0.1179,0.2023",
        "4002,0.1655,0.1233,0.2077",
        "4003,0.1688,0.1266,0.2110",
        "4004,0.1901,0.1479,0.2323",
      ].join(","),
    ].join("\n");
    const rows = parseRacerSt(csv);
    expect(rows[0]?.entries[1]).toEqual({
      boatNumber: 2,
      registrationNumber: null,
      estimatedST: null,
      estimatedStP25: null,
      estimatedStP75: null,
    });
  });

  it("帯の列を持たない旧 CSV も読める (帯は null)", () => {
    const csv = [
      LEGACY_HEADER,
      "202607200101,2026-07-20,01,01R,3303,0.1512,4663,0.1723,4001,0.1601,4002,0.1655,4003,0.1688,4004,0.1901",
    ].join("\n");
    expect(parseRacerSt(csv)[0]?.entries[0]).toEqual({
      boatNumber: 1,
      registrationNumber: 3303,
      estimatedST: 0.1512,
      estimatedStP25: null,
      estimatedStP75: null,
    });
  });

  it("空 CSV は空配列", () => {
    expect(parseRacerSt(`${HEADER}\n`)).toEqual([]);
  });
});
