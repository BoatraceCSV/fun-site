import { describe, expect, it } from "vitest";
import { parseKimariteTable, parsePairTable } from "../fetcher/ana-tables-schemas.js";

describe("parsePairTable", () => {
  const HEADER = "セル,2着コース,3着コース,n,確率";
  it("セル・コース・確率を読む", () => {
    const rows = parsePairTable(`${HEADER}\nまくり差し_3,1,4,120,0.21\nまくり差し_3,1,5,90,0.18`);
    expect(rows).toEqual([
      { cell: "まくり差し_3", second: 1, third: 4, n: 120, probability: 0.21 },
      { cell: "まくり差し_3", second: 1, third: 5, n: 90, probability: 0.18 },
    ]);
  });
  it("コース範囲外・2着=3着・確率欠損の行は落とす", () => {
    const rows = parsePairTable(
      [
        HEADER,
        "まくり_3,7,1,1,0.1",
        "まくり_3,4,4,1,0.1",
        "まくり_3,4,5,1,",
        "まくり_3,4,5,3,0.5",
      ].join("\n"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.n).toBe(3);
  });
});

describe("parseKimariteTable", () => {
  const HEADER =
    "1着コース,2着コース,3着コース,n,最頻決まり手,逃げ,差し,まくり,まくり差し,抜き,恵まれ";
  it("出目ごとの最頻決まり手と分布を読む", () => {
    const rows = parseKimariteTable(`${HEADER}\n3,1,4,500,まくり差し,0,0.1,0.2,0.6,0.08,0.02`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.courses).toEqual([3, 1, 4]);
    expect(rows[0]?.mode).toBe("まくり差し");
    expect(rows[0]?.shares["まくり差し"]).toBe(0.6);
    expect(rows[0]?.shares["恵まれ"]).toBe(0.02);
  });
  it("無い決まり手列は 0、同一コースの重複行は落とす", () => {
    const rows = parseKimariteTable(
      [
        "1着コース,2着コース,3着コース,n,最頻決まり手,逃げ",
        "1,2,3,10,逃げ,0.95",
        "1,1,3,10,逃げ,0.95",
      ].join("\n"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.shares["まくり"]).toBe(0);
  });
});
