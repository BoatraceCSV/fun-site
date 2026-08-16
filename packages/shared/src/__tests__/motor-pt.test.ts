import { describe, expect, it } from "vitest";
import type { SessionResultSlot } from "../types/race-card.js";
import {
  MOTOR_NEGATIVE_SCORE,
  MOTOR_PT_SCORE_TABLE,
  computeMotorSessionBreakdown,
  motorPtRaceGradeBucket,
  motorPtScoreRow,
  normalizeMotorFinishToken,
  resolveMotorPtBucket,
  scoreMotorRun,
} from "../utils/motor-pt.js";

/**
 * 期待値は BoatraceCSV `scripts/boatrace/index_features.py` の
 * `score_motor_run()` / `grade_bucket_for_grade()` / `resolve_grade_bucket()` /
 * `normalize_finish_token()` と、スコア表 CSV
 * (`data/estimate/motor_ability_score.csv`) に対応する。
 * 値の書き換えは上流の再確認をしてから行うこと。
 */
const slot = (rank: string, overrides: Partial<SessionResultSlot> = {}): SessionResultSlot => ({
  day: 1,
  run: 1,
  race: 5,
  entryCourse: 3,
  lane: 3,
  st: 0.15,
  rank,
  ...overrides,
});

describe("motorPtRaceGradeBucket", () => {
  it("SG / PG / GⅠ を SG_G1 に寄せる", () => {
    expect(motorPtRaceGradeBucket("ＳＧ")).toBe("SG_G1");
    expect(motorPtRaceGradeBucket("ＰＧ１")).toBe("SG_G1");
    expect(motorPtRaceGradeBucket("ＧⅠ")).toBe("SG_G1");
  });

  it("GⅡ / GⅢ / 一般 / 空文字は G2_G3_一般 に落ちる", () => {
    expect(motorPtRaceGradeBucket("ＧⅡ")).toBe("G2_G3_一般");
    expect(motorPtRaceGradeBucket("ＧⅢ")).toBe("G2_G3_一般");
    expect(motorPtRaceGradeBucket("一般")).toBe("G2_G3_一般");
    expect(motorPtRaceGradeBucket("")).toBe("G2_G3_一般");
  });
});

describe("resolveMotorPtBucket", () => {
  it("B1 / B2 は開催グレードに依らず 全", () => {
    expect(resolveMotorPtBucket("B1", "SG_G1")).toBe("全");
    expect(resolveMotorPtBucket("B2", "G2_G3_一般")).toBe("全");
  });

  it("A1 / A2 は開催グレードをそのまま使う", () => {
    expect(resolveMotorPtBucket("A1", "SG_G1")).toBe("SG_G1");
    expect(resolveMotorPtBucket("A2", "G2_G3_一般")).toBe("G2_G3_一般");
  });
});

describe("MOTOR_PT_SCORE_TABLE", () => {
  it("CSV と同じ 6 行構造で、各行 6 着ぶんの得点を持つ", () => {
    expect(MOTOR_PT_SCORE_TABLE).toHaveLength(6);
    for (const row of MOTOR_PT_SCORE_TABLE) {
      expect(row.points).toHaveLength(6);
      expect(row.points[5]).toBe(0);
    }
  });

  it("同じ 1 着でも B2 が A1 一般戦より高く付く", () => {
    expect(motorPtScoreRow("B2", "全")?.points[0]).toBe(125);
    expect(motorPtScoreRow("A1", "G2_G3_一般")?.points[0]).toBe(50);
  });

  it("級別が表に無ければ undefined", () => {
    expect(motorPtScoreRow("B1", "SG_G1")).toBeUndefined();
    expect(motorPtScoreRow("", "全")).toBeUndefined();
  });
});

describe("normalizeMotorFinishToken", () => {
  it("全角数字・数値形式を半角 1 文字に寄せる", () => {
    expect(normalizeMotorFinishToken("４")).toBe("4");
    expect(normalizeMotorFinishToken("4.0")).toBe("4");
    expect(normalizeMotorFinishToken(" 2 ")).toBe("2");
  });

  it("全角 Ｆ / Ｌ を半角化する", () => {
    expect(normalizeMotorFinishToken("Ｆ")).toBe("F");
    expect(normalizeMotorFinishToken("Ｌ")).toBe("L");
  });

  it("未出走・範囲外・未知トークンは null", () => {
    expect(normalizeMotorFinishToken("")).toBeNull();
    expect(normalizeMotorFinishToken("7")).toBeNull();
    expect(normalizeMotorFinishToken("nan")).toBeNull();
    expect(normalizeMotorFinishToken("？")).toBeNull();
  });
});

describe("scoreMotorRun", () => {
  const row = motorPtScoreRow("B1", "全");

  it("着順はスコア表の値で採点する", () => {
    expect(scoreMotorRun(row, "1")).toEqual({ kind: "scored", rank: 1, score: 100 });
    expect(scoreMotorRun(row, "6")).toEqual({ kind: "scored", rank: 6, score: 0 });
  });

  it("転 / 落 / 沈 / エ は -100 点（打点には計上する）", () => {
    expect(scoreMotorRun(row, "転")).toEqual({
      kind: "negative",
      token: "転",
      score: MOTOR_NEGATIVE_SCORE,
    });
    expect(scoreMotorRun(row, "エ")?.kind).toBe("negative");
  });

  it("F / L / 失 / 妨 / 欠 / 不 は集計から外す（選手pt とは扱いが逆）", () => {
    expect(scoreMotorRun(row, "F")).toEqual({ kind: "skipped", token: "F" });
    expect(scoreMotorRun(row, "欠")).toEqual({ kind: "skipped", token: "欠" });
  });

  it("級別不明でも 転落沈エ は採点でき、着順は採点できない", () => {
    expect(scoreMotorRun(undefined, "転")?.kind).toBe("negative");
    expect(scoreMotorRun(undefined, "1")).toBeNull();
  });

  it("未出走スロットは null", () => {
    expect(scoreMotorRun(row, "")).toBeNull();
  });
});

describe("computeMotorSessionBreakdown", () => {
  it("出走済みスロットだけを採点し、単純平均を返す", () => {
    const b = computeMotorSessionBreakdown(
      [slot("1"), slot("3", { day: 1, run: 2 }), slot("", { day: 2, run: 1, race: 0 })],
      "B1",
      "一般",
    );
    expect(b.bucket).toBe("全");
    expect(b.runs).toHaveLength(2);
    expect(b.totalScore).toBe(160); // 100 + 60
    expect(b.countedRuns).toBe(2);
    expect(b.average).toBe(80);
  });

  it("F は打点に入れず、転は -100 で打点に入れる", () => {
    const b = computeMotorSessionBreakdown(
      [slot("1"), slot("F", { run: 2 }), slot("転", { day: 2 })],
      "B1",
      "一般",
    );
    expect(b.runs).toHaveLength(3);
    expect(b.countedRuns).toBe(2);
    expect(b.totalScore).toBe(0); // 100 + (-100)
    expect(b.average).toBe(0);
  });

  it("A1 は開催グレードでスコア表が変わる", () => {
    const slots = [slot("1")];
    expect(computeMotorSessionBreakdown(slots, "A1", "一般").totalScore).toBe(50);
    expect(computeMotorSessionBreakdown(slots, "A1", "ＳＧ").totalScore).toBe(100);
  });

  it("全スロット未出走なら平均は null", () => {
    const b = computeMotorSessionBreakdown([slot("", { race: 0 })], "A1", "一般");
    expect(b.runs).toHaveLength(0);
    expect(b.average).toBeNull();
  });
});
