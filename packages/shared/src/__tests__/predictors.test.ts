import { describe, expect, it } from "vitest";
import {
  COMPONENT_LABELS,
  COMPONENT_MISSING_FALLBACK,
  COMPONENT_MISSING_FALLBACK_DEFAULT,
  PREDICTORS,
  activePredictors,
  allPredictors,
  indexCsvTypeFor,
  predictorById,
  predictorCsvPath,
  predictorFromIndexCsvType,
} from "../predictors.js";

describe("predictor registry", () => {
  it("has v1_basic active as the default predictor", () => {
    const v1 = predictorById("v1_basic");
    expect(v1).toBeDefined();
    expect(v1?.displayName).toBe("A君予想");
    expect(v1?.slot).toBe(1);
    expect(v1?.status).toBe("active");
    expect(v1?.componentKeys).toEqual(["waku", "racer", "motor", "exhibit", "weather"]);
  });

  it("has v2_tenkai active with motor2rate experiment (A君 5成分 + motor2rate)", () => {
    // 展開優位pt 撤去後、次の実験として motor2rate を加えた 6 成分構成。
    const v2 = predictorById("v2_tenkai");
    expect(v2).toBeDefined();
    expect(v2?.displayName).toBe("B君予想");
    expect(v2?.slot).toBe(2);
    expect(v2?.status).toBe("active");
    expect(v2?.componentKeys).toEqual([
      "waku",
      "racer",
      "motor",
      "exhibit",
      "weather",
      "motor2rate",
    ]);
    expect(v2?.componentKeys).not.toContain("tenkai");
    // A君予想 (control) の 5 成分 + motor2rate になっていること。
    expect(v2?.componentKeys.slice(0, 5)).toEqual(predictorById("v1_basic")?.componentKeys);
  });

  it("matches the boatracecsv registry started_at", () => {
    // boatracecsv 側 (data/estimate/{predictor_id}/) と揃えておく必要がある。
    // fun-site /predictors の累計回収率の起点。
    expect(predictorById("v1_basic")?.startedAt).toBe("2026-05-01");
    // 展開予想撤去で recipe が変わったため 2026-06-13 にリセット。
    expect(predictorById("v2_tenkai")?.startedAt).toBe("2026-06-13");
  });

  it("returns active predictors sorted by slot", () => {
    const actives = activePredictors();
    expect(actives.length).toBeGreaterThan(0);
    expect(actives.every((p) => p.status === "active")).toBe(true);
    for (let i = 1; i < actives.length; i++) {
      const prev = actives[i - 1];
      const curr = actives[i];
      if (!(prev && curr)) throw new Error("unreachable");
      expect(curr.slot).toBeGreaterThanOrEqual(prev.slot);
    }
  });

  it("returns undefined for unknown predictor id", () => {
    expect(predictorById("does_not_exist")).toBeUndefined();
  });

  it("includes every active predictor in allPredictors()", () => {
    expect(allPredictors()).toBe(PREDICTORS);
    for (const p of activePredictors()) {
      expect(allPredictors()).toContain(p);
    }
  });
});

describe("component constants", () => {
  it("has a Japanese label for each component key", () => {
    expect(COMPONENT_LABELS.waku).toBe("枠番pt");
    expect(COMPONENT_LABELS.racer).toBe("選手pt");
    expect(COMPONENT_LABELS.motor).toBe("モーターpt");
    expect(COMPONENT_LABELS.exhibit).toBe("展示pt");
    expect(COMPONENT_LABELS.weather).toBe("気象pt");
    expect(COMPONENT_LABELS.tenkai).toBe("展開優位pt");
    expect(COMPONENT_LABELS.motor2rate).toBe("モーター2連率pt");
  });

  it("uses 30 for racer fallback (新人 / 長期離脱明け対策)", () => {
    expect(COMPONENT_MISSING_FALLBACK.racer).toBe(30.0);
  });

  it("defaults to 50 for other component fallbacks", () => {
    expect(COMPONENT_MISSING_FALLBACK_DEFAULT).toBe(50.0);
    // motor などはオーバーライドなし
    expect(COMPONENT_MISSING_FALLBACK.motor).toBeUndefined();
  });
});

describe("predictorCsvPath", () => {
  it("builds the data/estimate/{predictor_id}/YYYY/MM/DD.csv path", () => {
    const v1 = predictorById("v1_basic");
    if (!v1) throw new Error("v1_basic missing");
    expect(predictorCsvPath(v1, { year: 2026, month: 5, day: 24 })).toBe(
      "data/estimate/v1_basic/2026/05/24.csv",
    );
  });

  it("zero-pads month and day", () => {
    const v1 = predictorById("v1_basic");
    if (!v1) throw new Error("v1_basic missing");
    expect(predictorCsvPath(v1, { year: 2026, month: 1, day: 3 })).toBe(
      "data/estimate/v1_basic/2026/01/03.csv",
    );
  });
});

describe("Pub/Sub csv_type round-trip", () => {
  it("indexCsvTypeFor + predictorFromIndexCsvType are inverses", () => {
    const v1 = predictorById("v1_basic");
    if (!v1) throw new Error("v1_basic missing");
    const csvType = indexCsvTypeFor(v1);
    expect(csvType).toBe("index:v1_basic");
    expect(predictorFromIndexCsvType(csvType)).toBe(v1);
  });

  it("returns undefined for non-index csv_type", () => {
    expect(predictorFromIndexCsvType("title")).toBeUndefined();
    expect(predictorFromIndexCsvType("results")).toBeUndefined();
    expect(predictorFromIndexCsvType("index")).toBeUndefined(); // no colon
  });

  it("returns undefined for unknown predictor id in csv_type", () => {
    expect(predictorFromIndexCsvType("index:does_not_exist")).toBeUndefined();
  });
});
