import { describe, expect, it } from "vitest";
import type { MotorPtBaselineCell, MotorPtRunRow } from "../types/motor-pt-history.js";
import type { MotorPtBasis } from "../types/stadium-table.js";
import {
  MOTOR_PT_MISSING_FALLBACK,
  MOTOR_PT_PARAMS,
  computeMotorPtSteps,
  groupMotorPtRunsBySession,
  motorPtMatchesIndex,
  recomputeMotorRawPt,
  resolveMotorPtCell,
} from "../utils/motor-pt.js";

/**
 * モーターpt の「素点 → 偏差値pt → 寄与」と、配られた明細からの素点の組み直し。
 *
 * 素点そのものは上流 (`data/estimate/motor_pt/`) が配ってくるので、fun-site が
 * 責任を持つのは後半 2 段と検算だけ。ゴールデンは 2026-08-22 芦屋 (21) 1R の
 * 実データ（上流 index CSV / weights CSV / 内訳 CSV）。
 */

/** 芦屋 (21) の モーターpt 成分。値は 2026-08 の weights/v1_basic 実データ */
const ASHIYA: MotorPtBasis = {
  predictorId: "v1_basic",
  mu: -0.004658,
  sigma: 0.178514,
  weight: 0.08386,
  weightsMonth: "2026-08",
};

/**
 * 2026-08-22 芦屋 1R の 6 基。`[モーター番号, 素点, index CSV のモーターpt, 同 寄与]`。
 * 素点は内訳 CSV の `motors` 行、pt / 寄与 は index CSV の実値。
 */
const ASHIYA_1R: readonly [number, number, number, number][] = [
  [44, 0.001629, 50.35, 4.22],
  [24, 0.001989, 50.37, 4.22],
  [30, 0.129362, 57.51, 4.82],
  [6, -0.0684, 46.43, 3.89],
  [21, 0.162941, 59.39, 4.98],
  [13, -0.018887, 49.2, 4.13],
];

const runOf = (
  overrides: Partial<MotorPtRunRow> & Pick<MotorPtRunRow, "residual" | "weight">,
): MotorPtRunRow => ({
  recordDate: "2026-08-22",
  stadiumCode: "21",
  motorNumber: 44,
  sessionIndex: 0,
  sessionEnd: "2026-08-21",
  raceDate: "2026-08-20",
  day: 1,
  run: 1,
  racerClass: "A2",
  bucket: "G2_G3_一般",
  entryCourse: 3,
  finish: "2",
  rawScore: 60,
  cellMu: 43.8028,
  cellSigma: 25.2357,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────
// 素点 → モーターpt → 寄与
// ─────────────────────────────────────────────────────────────────────
describe("computeMotorPtSteps", () => {
  it("index CSV の モーターpt / 寄与 を再現する (芦屋 1R の 6 基)", () => {
    for (const [motorNumber, rawPt, expectedPt, expectedContribution] of ASHIYA_1R) {
      const steps = computeMotorPtSteps(ASHIYA, rawPt);
      expect(Number(steps.pt.toFixed(2)), `motor ${motorNumber} pt`).toBe(expectedPt);
      expect(Number(steps.contribution.toFixed(2)), `motor ${motorNumber} 寄与`).toBe(
        expectedContribution,
      );
    }
  });

  it("素点が μ に等しければ偏差値 50", () => {
    expect(computeMotorPtSteps(ASHIYA, ASHIYA.mu).pt).toBeCloseTo(50, 10);
  });

  it("素点が欠損なら偏差値変換を通さず 50 補完 (寄与は w × 50)", () => {
    const steps = computeMotorPtSteps(ASHIYA, null);
    expect(steps.rawPt).toBeNull();
    expect(steps.z).toBe(0);
    expect(steps.pt).toBe(MOTOR_PT_MISSING_FALLBACK);
    expect(steps.contribution).toBeCloseTo(ASHIYA.weight * MOTOR_PT_MISSING_FALLBACK, 10);
  });

  it("σ=0 の場は z=0 に倒す (0 除算を出さない)", () => {
    const steps = computeMotorPtSteps({ ...ASHIYA, sigma: 0 }, 1.23);
    expect(steps.z).toBe(0);
    expect(steps.pt).toBe(50);
  });
});

describe("motorPtMatchesIndex", () => {
  it("小数第 2 位まで一致していれば true", () => {
    expect(motorPtMatchesIndex(50.3512, 50.35)).toBe(true);
    expect(motorPtMatchesIndex(50.3549, 50.35)).toBe(true);
  });

  it("0.005 以上ずれたら false", () => {
    expect(motorPtMatchesIndex(50.36, 50.35)).toBe(false);
  });

  it("どちらかが undefined なら false", () => {
    expect(motorPtMatchesIndex(undefined, 50.35)).toBe(false);
    expect(motorPtMatchesIndex(50.35, undefined)).toBe(false);
  });

  it("σ を渡すと素点の丸めによる 2 桁表示の境界事故を許容する", () => {
    // 2026-08-22 児島 (16) 1R 5枠 の実例。素点 -0.03154 (CSV が 6 桁に丸めた値) を
    // σ=0.166244 で偏差値化すると 47.664998… となり、上流が内部 float から出した
    // 47.67 と 2 桁表示で 0.01 ずれる。2026-08-22 の 933 セル中 2 件がこれに当たる。
    expect(motorPtMatchesIndex(47.664998, 47.67)).toBe(false);
    expect(motorPtMatchesIndex(47.664998, 47.67, 0.166244)).toBe(true);
  });

  it("σ を渡しても本物のずれは許容しない", () => {
    // 内訳 CSV や重みが差し替わったときの差はこれよりずっと大きい
    expect(motorPtMatchesIndex(47.61, 47.67, 0.166244)).toBe(false);
    expect(motorPtMatchesIndex(50.35, 51.2, 0.178514)).toBe(false);
  });

  it("σ が 0 なら緩めない", () => {
    expect(motorPtMatchesIndex(47.664998, 47.67, 0)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 明細からの素点の組み直し
// ─────────────────────────────────────────────────────────────────────

/**
 * 2026-08-22 芦屋 モーター#44 の 40 走。`[節, 残差z, 減衰重み]`。
 * 上流 `runs` CSV の実値で、この 3 列だけが素点の計算に効く。
 */
const MOTOR_44_RUNS: readonly [number, number, number][] = [
  [0, 0.641835, 0.97716],
  [0, -0.827184, 0.97716],
  [1, 1.349957, 0.793701],
  [1, -0.011037, 0.793701],
  [1, -0.905978, 0.802923],
  [1, -1.35506, 0.812252],
  [1, -1.189427, 0.812252],
  // 半減期 60 日のちょうど 30 日前なので減衰重みが 2^-0.5 になる。上流 CSV の実値で、Math.SQRT1_2 を意図したものではない
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: 上流 CSV の実値 (半減期の半分ぶん前の減衰重み)
  [2, -0.089332, 0.707107],
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: 上流 CSV の実値 (半減期の半分ぶん前の減衰重み)
  [2, 0.226757, 0.707107],
  [2, -1.558217, 0.715323],
  [2, 0.190737, 0.715323],
  [2, 0.641835, 0.723635],
  [2, 0.64852, 0.723635],
  [2, 0.190737, 0.732043],
  [2, -0.089332, 0.740549],
  [2, 0.226757, 0.740549],
  [3, 0.64852, 0.63728],
  [3, -0.213227, 0.63728],
  [3, -0.647415, 0.644685],
  [3, 0.190737, 0.644685],
  [3, -0.089332, 0.652176],
  [3, -0.546957, 0.659754],
  [3, -0.492054, 0.659754],
  [3, 1.804257, 0.66742],
  [3, 1.804257, 0.675175],
  [3, -0.089332, 0.675175],
  [4, 0.190737, 0.554785],
  [4, 1.131762, 0.561231],
  [4, 0.64852, 0.561231],
  [4, 0.632182, 0.567752],
  [4, -0.393995, 0.567752],
  [4, 0.64852, 0.574349],
  [4, 0.226757, 0.574349],
  [5, -0.49855, 0.471937],
  [5, -0.49855, 0.471937],
  [5, -0.49855, 0.477421],
  [5, -0.49855, 0.482968],
  [5, -0.49855, 0.482968],
  [5, -0.49855, 0.482968],
  [5, -0.49855, 0.482968],
];

const motor44Runs: MotorPtRunRow[] = MOTOR_44_RUNS.map(([sessionIndex, residual, weight]) =>
  runOf({ sessionIndex, residual, weight }),
);

describe("recomputeMotorRawPt", () => {
  it("上流 motors 行の Σw / n_eff / 素点 を再現する (モーター#44 の 40 走)", () => {
    const got = recomputeMotorRawPt(motor44Runs);
    expect(got).not.toBeNull();
    // CSV が丸めた値からの再計算なので厳密一致はしない。上流の突合実測では
    // 素点の差は最大 6.4e-7 だった。
    expect(got?.sumW).toBeCloseTo(26.34242, 5);
    expect(got?.sumW2).toBeCloseTo(17.982322, 5);
    expect(got?.nEff).toBeCloseTo(38.589181, 4);
    expect(got?.meanResidual).toBeCloseTo(0.002051, 6);
    expect(got?.rawPt).toBeCloseTo(0.001629, 6);
  });

  it("再計算した素点からでも index CSV の モーターpt に届く", () => {
    const recomputed = recomputeMotorRawPt(motor44Runs);
    const pt = computeMotorPtSteps(ASHIYA, recomputed?.rawPt ?? null).pt;
    expect(Number(pt.toFixed(2))).toBe(50.35);
  });

  it("収縮は n_eff / (n_eff + k) 倍で、加重平均残差より必ず 0 側に寄る", () => {
    const runs = [runOf({ residual: 2, weight: 1 }), runOf({ residual: 2, weight: 1 })];
    const got = recomputeMotorRawPt(runs);
    expect(got?.meanResidual).toBeCloseTo(2, 10);
    expect(got?.nEff).toBeCloseTo(2, 10);
    expect(got?.rawPt).toBeCloseTo((2 / (2 + MOTOR_PT_PARAMS.shrinkagePriorK)) * 2, 10);
    expect(Math.abs(got?.rawPt ?? 0)).toBeLessThan(2);
  });

  it("重みが等しいとき n_eff は走数に一致する (Kish の定義)", () => {
    const runs = Array.from({ length: 7 }, () => runOf({ residual: 0.5, weight: 0.3 }));
    expect(recomputeMotorRawPt(runs)?.nEff).toBeCloseTo(7, 10);
  });

  it("走が 1 本も無ければ null (0 除算にしない)", () => {
    expect(recomputeMotorRawPt([])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 節ごとの畳み込み
// ─────────────────────────────────────────────────────────────────────
describe("groupMotorPtRunsBySession", () => {
  it("節インデックス昇順 (直近が先頭) にまとめる", () => {
    const sessions = groupMotorPtRunsBySession(motor44Runs);
    expect(sessions.map((s) => s.sessionIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sessions.map((s) => s.runs.length)).toEqual([2, 5, 9, 10, 7, 7]);
  });

  it("節ごとの Σw / Σ(w×z) が全体の合計と一致する", () => {
    const sessions = groupMotorPtRunsBySession(motor44Runs);
    const total = recomputeMotorRawPt(motor44Runs);
    expect(sessions.reduce((acc, s) => acc + s.sumW, 0)).toBeCloseTo(total?.sumW ?? 0, 10);
    expect(sessions.reduce((acc, s) => acc + s.sumWeightedResidual, 0)).toBeCloseTo(
      total?.sumWeightedResidual ?? 0,
      10,
    );
  });

  it("走が無ければ空配列", () => {
    expect(groupMotorPtRunsBySession([])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// コース補正セルのフォールバック階層
// ─────────────────────────────────────────────────────────────────────
describe("resolveMotorPtCell", () => {
  const baseline: MotorPtBaselineCell[] = [
    {
      racerClass: "A2",
      bucket: "G2_G3_一般",
      entryCourse: 3,
      mu: 43.8028,
      sigma: 25.2357,
      sampleCount: 412,
    },
    {
      racerClass: "A2",
      bucket: "G2_G3_一般",
      entryCourse: 0,
      mu: 40.1,
      sigma: 26.4,
      sampleCount: 2480,
    },
  ];

  it("進入コースのセルがあればそれを引く", () => {
    expect(resolveMotorPtCell(baseline, "A2", "G2_G3_一般", 3)?.sampleCount).toBe(412);
  });

  it("進入コースのセルが無ければ 級別 × グレード分類 に落ちる", () => {
    // baseline に載っていない = サンプル数が上流の下限未満だったセル
    expect(resolveMotorPtCell(baseline, "A2", "G2_G3_一般", 5)?.entryCourse).toBe(0);
  });

  it("進入不明 (0) は最初から 級別 × グレード分類 を引く", () => {
    expect(resolveMotorPtCell(baseline, "A2", "G2_G3_一般", 0)?.entryCourse).toBe(0);
  });

  it("どちらも無ければ null (= コース補正なし)", () => {
    expect(resolveMotorPtCell(baseline, "B2", "全", 1)).toBeNull();
  });
});
