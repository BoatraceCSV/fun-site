import { describe, expect, it } from "vitest";
import { parseKimarite } from "../fetcher/kimarite-schemas.js";

const HEADER =
  "レースコード,レース日,レース場コード,レース回,状態,荒れ度,P_逃げ_1,P_まくり_3,P_差し_2";

const row = (state: string, upset: string, probs: string[]): string =>
  ["202608120101", "2026-08-12", "01", "1R", state, upset, ...probs].join(",");

describe("parseKimarite", () => {
  it("荒れ度とセル確率を読む", () => {
    const rows = parseKimarite(
      `${HEADER}\n${row("realtime", "0.7000", ["0.300000", "0.080000", "0.100000"])}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.raceCode).toBe("202608120101");
    expect(rows[0]?.state).toBe("realtime");
    expect(rows[0]?.upsetRate).toBeCloseTo(0.7);
    expect(rows[0]?.cellProbabilities["逃げ_1"]).toBeCloseTo(0.3);
    expect(rows[0]?.cellProbabilities["まくり_3"]).toBeCloseTo(0.08);
  });

  it("荒れ度は 1 − P(逃げ_1) と整合している", () => {
    const rows = parseKimarite(
      `${HEADER}\n${row("realtime", "0.7000", ["0.300000", "0.080000", "0.100000"])}`,
    );
    const nige = rows[0]?.cellProbabilities["逃げ_1"] ?? 0;
    expect(rows[0]?.upsetRate).toBeCloseTo(1 - nige, 3);
  });

  it("daily と realtime を両方読む", () => {
    const csv = [
      HEADER,
      row("daily", "0.6000", ["0.400000", "0.080000", "0.100000"]),
      row("realtime", "0.7000", ["0.300000", "0.080000", "0.100000"]),
    ].join("\n");
    expect(parseKimarite(csv).map((r) => r.state)).toEqual(["daily", "realtime"]);
  });

  it("状態が不明な行・荒れ度が非数の行は落とす", () => {
    const csv = [
      HEADER,
      row("", "0.7000", ["0.300000", "0.080000", "0.100000"]),
      row("realtime", "", ["0.300000", "0.080000", "0.100000"]),
    ].join("\n");
    expect(parseKimarite(csv)).toHaveLength(0);
  });

  it("空 CSV でも落ちない", () => {
    expect(parseKimarite(HEADER)).toEqual([]);
  });
});
