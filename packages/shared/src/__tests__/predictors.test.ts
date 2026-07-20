import { describe, expect, it } from "vitest";
import {
  COMPONENT_LABELS,
  COMPONENT_MISSING_FALLBACK,
  COMPONENT_MISSING_FALLBACK_DEFAULT,
  PREDICTORS,
  activePredictors,
  allPredictors,
  indexCsvTypeFor,
  isPreviewDerivedComponent,
  predictorById,
  predictorCsvPath,
  predictorFromIndexCsvType,
} from "../predictors.js";

describe("predictor registry", () => {
  it("has v1_basic active as the default predictor", () => {
    const v1 = predictorById("v1_basic");
    expect(v1).toBeDefined();
    expect(v1?.displayName).toBe("本命予想");
    expect(v1?.slot).toBe(1);
    expect(v1?.status).toBe("active");
    expect(v1?.componentKeys).toEqual(["waku", "racer", "motor", "exhibit", "weather"]);
  });

  it("keeps v2_tenkai as a retired entry (motor→motor2rate, past data preserved)", () => {
    // 2026-07-19 退役 (control に有意差なし)。エントリと成分定義は保持し ID は再利用しない。
    const v2 = predictorById("v2_tenkai");
    expect(v2).toBeDefined();
    expect(v2?.displayName).toBe("モーター評価変更予想");
    expect(v2?.slot).toBe(2);
    expect(v2?.status).toBe("retired");
    // recipe (componentKeys) は退役後も履歴解釈のため保持。
    expect(v2?.componentKeys).toEqual(["waku", "racer", "motor2rate", "exhibit", "weather"]);
    expect(v2?.componentKeys).toContain("motor2rate");
    // 退役済みなので active には含まれない。
    expect(activePredictors().some((p) => p.id === "v2_tenkai")).toBe(false);
  });

  it("keeps v3_tenkai as a retired entry (control + tenkai, past data preserved)", () => {
    // 2026-07-19 退役 (control に有意差なし)。エントリと成分定義は保持し ID は再利用しない。
    const v3 = predictorById("v3_tenkai");
    expect(v3).toBeDefined();
    expect(v3?.displayName).toBe("展開予想");
    expect(v3?.slot).toBe(3);
    expect(v3?.status).toBe("retired");
    expect(v3?.componentKeys).toEqual(["waku", "racer", "motor", "exhibit", "weather", "tenkai"]);
    expect(v3?.componentKeys).toContain("tenkai");
    expect(activePredictors().some((p) => p.id === "v3_tenkai")).toBe(false);
  });

  it("has v4_motor active with motor replaced by motor4 (5成分, motor 差し替え)", () => {
    // control (v1_basic) の着順ベース motor をチューニング版 motor4 に差し替えた
    // 5 成分構成 (成分数は control と同じで motor 指標だけ差し替え)。
    const v4 = predictorById("v4_motor");
    expect(v4).toBeDefined();
    expect(v4?.displayName).toBe("モーター予想");
    expect(v4?.slot).toBe(4);
    expect(v4?.status).toBe("active");
    expect(v4?.componentKeys).toEqual(["waku", "racer", "motor4", "exhibit", "weather"]);
    expect(v4?.componentKeys).not.toContain("tenkai");
    // 着順ベースの motor は使わない (motor4 に置換済み)。
    expect(v4?.componentKeys).not.toContain("motor");
    expect(v4?.componentKeys).toContain("motor4");
    // control (本命予想) と同じ 5 成分で、motor の位置だけ motor4 に差し替え。
    const v1Keys = predictorById("v1_basic")?.componentKeys ?? [];
    expect(v4?.componentKeys.length).toBe(v1Keys.length);
    expect(v4?.componentKeys).toEqual(v1Keys.map((k) => (k === "motor" ? "motor4" : k)));
    // active predictor として含まれる。
    expect(activePredictors().some((p) => p.id === "v4_motor")).toBe(true);
  });

  it("has v5_slit active with control-identical components and AI-estimated ST", () => {
    // control (v1_basic) と同一の 5 成分 (index / 強さpt は同値)。差分は
    // 1 マーク距離計算・スリット図の予測 ST のみ (全国平均ST → AI 推定 ST)。
    const v5 = predictorById("v5_slit");
    expect(v5).toBeDefined();
    expect(v5?.displayName).toBe("スリット予想");
    expect(v5?.slot).toBe(5);
    expect(v5?.status).toBe("active");
    expect(v5?.componentKeys).toEqual(predictorById("v1_basic")?.componentKeys);
    expect(v5?.useEstimatedST).toBe(true);
    // 他の予想者は予測 ST を差し替えない (既存処理へ影響なし)。
    expect(predictorById("v1_basic")?.useEstimatedST).toBeUndefined();
    expect(predictorById("v4_motor")?.useEstimatedST).toBeUndefined();
    expect(activePredictors().some((p) => p.id === "v5_slit")).toBe(true);
  });

  it("has v6_course active with waku swapped for course", () => {
    // コース予想 (v6_course): 本命予想の waku を場×レース番号×コース別の
    // course に差し替えた 5 成分の実験スロット (2026-07-22 投入)。
    // boatracecsv docs/design/course_strength_v6.md
    const v6 = predictorById("v6_course");
    expect(v6?.status).toBe("active");
    expect(v6?.slot).toBe(6);
    expect(v6?.componentKeys).toEqual(["course", "racer", "motor", "exhibit", "weather"]);
    // control との差分は waku → course の 1 成分のみ。
    const v1Keys = predictorById("v1_basic")?.componentKeys ?? [];
    expect(v6?.componentKeys).toEqual(v1Keys.map((k) => (k === "waku" ? "course" : k)));
    // course は daily でも値を持つ (preview 由来成分ではない)。
    expect(isPreviewDerivedComponent("course")).toBe(false);
    expect(activePredictors().some((p) => p.id === "v6_course")).toBe(true);
  });

  it("matches the boatracecsv registry started_at", () => {
    // boatracecsv 側 (data/estimate/{predictor_id}/) と揃えておく必要がある。
    // fun-site /predictors の累計回収率の起点。
    expect(predictorById("v1_basic")?.startedAt).toBe("2026-05-01");
    // 退役済みだが起点は当時のまま保持 (過去データ解釈のため)。
    expect(predictorById("v2_tenkai")?.startedAt).toBe("2026-06-13");
    expect(predictorById("v3_tenkai")?.startedAt).toBe("2026-06-20");
    // モーター予想 (v4_motor) は 2026-07-20 投入。
    expect(predictorById("v4_motor")?.startedAt).toBe("2026-07-20");
    // スリット予想 (v5_slit) は 2026-07-21 投入。
    expect(predictorById("v5_slit")?.startedAt).toBe("2026-07-21");
    // コース予想 (v6_course) は 2026-07-22 投入。
    expect(predictorById("v6_course")?.startedAt).toBe("2026-07-22");
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
    // v6_course: waku の代替。意味が変わるため「枠番pt」を流用しない。
    expect(COMPONENT_LABELS.course).toBe("コースpt");
    // motor4 は CSV 列名互換のため motor と同じラベル (ファイルは predictor_id ごとに分離)。
    expect(COMPONENT_LABELS.motor4).toBe("モーターpt");
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
