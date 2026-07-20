import { describe, expect, it } from "vitest";
import { parseRacerSt } from "../fetcher/racer-st-schemas.js";

const HEADER = [
  "レースコード",
  "レース日",
  "レース場コード",
  "レース回",
  ...[1, 2, 3, 4, 5, 6].flatMap((b) => [`${b}枠_登録番号`, `${b}枠_推定ST`]),
].join(",");

describe("parseRacerSt", () => {
  it("1 レース 1 行 × 6 枠の推定 ST をパースする", () => {
    const csv = [
      HEADER,
      "202607200101,2026-07-20,01,01R,3303,0.1512,4663,0.1723,4001,0.1601,4002,0.1655,4003,0.1688,4004,0.1901",
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
    });
    expect(row?.entries[5]).toEqual({
      boatNumber: 6,
      registrationNumber: 4004,
      estimatedST: 0.1901,
    });
  });

  it("欠場枠 (空欄) は null になる", () => {
    const csv = [
      HEADER,
      "202607200102,2026-07-20,01,02R,3303,0.1512,,,4001,0.1601,4002,0.1655,4003,0.1688,4004,0.1901",
    ].join("\n");
    const rows = parseRacerSt(csv);
    expect(rows[0]?.entries[1]).toEqual({
      boatNumber: 2,
      registrationNumber: null,
      estimatedST: null,
    });
  });

  it("空 CSV は空配列", () => {
    expect(parseRacerSt(`${HEADER}\n`)).toEqual([]);
  });
});
