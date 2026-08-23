import { computeMotorPtSteps } from "@fun-site/shared";
import { describe, expect, it } from "vitest";
import type { StadiumWeightsFetch } from "../fetcher/index.js";
import {
  parseMotorPtBaseline,
  parseMotorPtMotors,
  parseMotorPtRuns,
} from "../fetcher/motor-pt-schemas.js";
import {
  buildMotorPtBasisByStadium,
  buildMotorPtHistoryLookup,
  motorPtKey,
  selectMotorPtBaselineCells,
} from "../site-builder/motor-pt-basis.js";

/**
 * モーターpt 素点の内訳 CSV のパースと、レース JSON への畳み込み。
 * 値は 2026-08-22 芦屋 (21) の上流実データ。
 */

/** 芦屋 (21) の モーターpt 成分。2026-08 の weights/v1_basic 実データ */
const ASHIYA_WEIGHTS: StadiumWeightsFetch = {
  predictorId: "v1_basic",
  month: "2026-08",
  rows: [{ stadiumName: "芦屋", mu: -0.004658, sigma: 0.178514, weight: 0.08386 }],
};

/** runs CSV の抜粋。芦屋 #44 の直近節 2 走 + #24 の 1 走 */
const RUNS_CSV = `記録日,場コード,モーター番号,節,節最終日,走行日,日次,走,級別,グレード分類,進入,着順,生得点,セルμ,セルσ,残差z,減衰重み
2026-08-22,21,44,0,2026-08-21,2026-08-20,1,1,A2,G2_G3_一般,3,2,60,43.8028,25.2357,0.641835,0.97716
2026-08-22,21,44,0,2026-08-21,2026-08-20,1,2,A2,G2_G3_一般,1,3,45,61.8161,20.3293,-0.827184,0.97716
2026-08-22,21,44,1,2026-08-05,2026-08-02,1,1,B1,全,6,3,60,25.0533,25.8873,1.349957,0.793701
2026-08-22,21,24,0,2026-08-21,2026-08-21,2,1,B1,全,4,転,-100,40.3539,32.0688,-4.376372,0.988458
`;

/** motors CSV の抜粋。#44 は履歴あり、#99 は履歴ゼロ (集計列が空欄) */
const MOTORS_CSV = `記録日,場コード,モーター番号,節数,走数,Σw,Σw2,n_eff,加重平均残差,素点
2026-08-22,21,44,6,40,26.34242,17.982322,38.589181,0.002051,0.001629
2026-08-22,21,24,6,36,24.1,16.4,35.00232,0.002504,0.001989
2026-08-22,21,99,0,0,,,,,
`;

/** baseline CSV の抜粋。進入=0 は 級別 × グレード分類 のフォールバックセル */
const BASELINE_CSV = `記録日,級別,グレード分類,進入,μ,σ,サンプル数
2026-08-22,A2,G2_G3_一般,1,61.8161,20.3293,1204
2026-08-22,A2,G2_G3_一般,3,43.8028,25.2357,1112
2026-08-22,A2,G2_G3_一般,0,40.1,26.4,6480
2026-08-22,B1,全,6,25.0533,25.8873,2210
2026-08-22,B1,全,0,38.2,30.1,13820
2026-08-22,A1,SG_G1,2,55.5,18.2,340
`;

// ─────────────────────────────────────────────────────────────────────
// パーサ
// ─────────────────────────────────────────────────────────────────────
describe("parseMotorPtRuns", () => {
  it("1 走 1 行を型付きで読む", () => {
    const runs = parseMotorPtRuns(RUNS_CSV);
    expect(runs).toHaveLength(4);
    expect(runs[0]).toEqual({
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
      residual: 0.641835,
      weight: 0.97716,
    });
  });

  it("機材起因トークン (転/落/沈/エ) は着順文字列と -100 点で入る", () => {
    const capsize = parseMotorPtRuns(RUNS_CSV).find((r) => r.motorNumber === 24);
    expect(capsize?.finish).toBe("転");
    expect(capsize?.rawScore).toBe(-100);
  });

  it("B1 / B2 は開催グレードに依らず 全 バケット", () => {
    const b1 = parseMotorPtRuns(RUNS_CSV).filter((r) => r.racerClass === "B1");
    expect(b1.every((r) => r.bucket === "全")).toBe(true);
  });
});

describe("parseMotorPtMotors", () => {
  it("集計行を読む", () => {
    const motors = parseMotorPtMotors(MOTORS_CSV);
    expect(motors[0]).toMatchObject({
      stadiumCode: "21",
      motorNumber: 44,
      sessionCount: 6,
      runCount: 40,
      nEff: 38.589181,
      rawPt: 0.001629,
    });
  });

  it("履歴ゼロのモーターは集計列が null (0 と区別する)", () => {
    const empty = parseMotorPtMotors(MOTORS_CSV).find((m) => m.motorNumber === 99);
    expect(empty?.runCount).toBe(0);
    expect(empty?.rawPt).toBeNull();
    expect(empty?.sumW).toBeNull();
    expect(empty?.nEff).toBeNull();
  });
});

describe("parseMotorPtBaseline", () => {
  it("コース補正セルを読む", () => {
    const cells = parseMotorPtBaseline(BASELINE_CSV);
    expect(cells).toHaveLength(6);
    expect(cells[0]).toEqual({
      recordDate: "2026-08-22",
      racerClass: "A2",
      bucket: "G2_G3_一般",
      entryCourse: 1,
      mu: 61.8161,
      sigma: 20.3293,
      sampleCount: 1204,
    });
  });

  it("進入=0 はフォールバックセルとしてそのまま保持する", () => {
    const fallback = parseMotorPtBaseline(BASELINE_CSV).find(
      (c) => c.racerClass === "A2" && c.entryCourse === 0,
    );
    expect(fallback?.sampleCount).toBe(6480);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 場別 μ/σ/w
// ─────────────────────────────────────────────────────────────────────
describe("buildMotorPtBasisByStadium", () => {
  it("場名キーの weights を場コードで引けるようにする", () => {
    const basis = buildMotorPtBasisByStadium(ASHIYA_WEIGHTS).get("21");
    expect(basis).toMatchObject({
      predictorId: "v1_basic",
      weightsMonth: "2026-08",
      mu: -0.004658,
      sigma: 0.178514,
      weight: 0.08386,
    });
  });

  it("index CSV の モーターpt / 寄与 を再現する", () => {
    // 2026-08-22 芦屋 1R 1枠 (モーター#44)。素点 0.001629 → モーターpt=50.35 / 寄与=4.22
    const basis = buildMotorPtBasisByStadium(ASHIYA_WEIGHTS).get("21");
    if (!basis) throw new Error("basis missing");
    const steps = computeMotorPtSteps(basis, 0.001629);
    expect(Number(steps.pt.toFixed(2))).toBe(50.35);
    expect(Number(steps.contribution.toFixed(2))).toBe(4.22);
  });

  it("weights が無ければ空 Map (画面は未取得表示に倒れる)", () => {
    expect(buildMotorPtBasisByStadium(undefined).size).toBe(0);
    expect(buildMotorPtBasisByStadium({ ...ASHIYA_WEIGHTS, rows: [] }).size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// motors + runs の畳み込み
// ─────────────────────────────────────────────────────────────────────
describe("buildMotorPtHistoryLookup", () => {
  const lookup = buildMotorPtHistoryLookup(
    parseMotorPtMotors(MOTORS_CSV),
    parseMotorPtRuns(RUNS_CSV),
  );

  it("(場コード-モーター番号) で引ける", () => {
    const h = lookup.get(motorPtKey("21", 44));
    expect(h?.runs).toHaveLength(3);
    expect(h?.rawPt).toBe(0.001629);
    expect(h?.sessionCount).toBe(6);
  });

  it("走を 節 → 走行日 → 日次 → 走 の順に並べ直す", () => {
    const runs = lookup.get(motorPtKey("21", 44))?.runs ?? [];
    expect(runs.map((r) => [r.sessionIndex, r.day, r.run])).toEqual([
      [0, 1, 1],
      [0, 1, 2],
      [1, 1, 1],
    ]);
  });

  it("履歴ゼロのモーターも runs 空のエントリとして残す", () => {
    // 「CSV 未取得」(= lookup に無い) と「直近 6 節に有効な走が無い」を
    // 画面が区別できるようにするため
    const empty = lookup.get(motorPtKey("21", 99));
    expect(empty).toBeDefined();
    expect(empty?.runs).toEqual([]);
    expect(empty?.rawPt).toBeNull();
  });

  it("motors 行が無いモーターは lookup に載らない", () => {
    expect(lookup.get(motorPtKey("21", 1))).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// レースが引いたセルの抜き出し
// ─────────────────────────────────────────────────────────────────────
describe("selectMotorPtBaselineCells", () => {
  const baseline = parseMotorPtBaseline(BASELINE_CSV);
  const runs = parseMotorPtRuns(RUNS_CSV);

  it("走が引いたセルとそのフォールバック先だけを残す", () => {
    const cells = selectMotorPtBaselineCells(baseline, runs);
    const keys = cells.map((c) => `${c.racerClass}/${c.bucket}/${c.entryCourse}`);
    // 走が使ったのは A2 の進入 3・1 と B1 の進入 6・4。進入 4 のセルは baseline に
    // 無い (サンプル数不足) ので、フォールバック先の 進入=0 が拾われる。
    expect(keys).toEqual([
      "A2/G2_G3_一般/0",
      "A2/G2_G3_一般/1",
      "A2/G2_G3_一般/3",
      "B1/全/0",
      "B1/全/6",
    ]);
  });

  it("このレースが触らない級別のセルは落とす", () => {
    const cells = selectMotorPtBaselineCells(baseline, runs);
    expect(cells.some((c) => c.racerClass === "A1")).toBe(false);
  });

  it("走が無い / baseline が無ければ空配列", () => {
    expect(selectMotorPtBaselineCells(baseline, [])).toEqual([]);
    expect(selectMotorPtBaselineCells([], runs)).toEqual([]);
  });
});
