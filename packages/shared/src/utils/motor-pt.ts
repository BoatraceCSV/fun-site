/**
 * モーターpt（モーター能力指数）の定数・採点ルール。
 *
 * BoatraceCSV 側 `scripts/boatrace/index_features.py` の `score_motor_run()` /
 * `grade_bucket_for_grade()` / `resolve_grade_bucket()` / `normalize_finish_token()`
 * の TypeScript 移植。設計は BoatraceCSV `docs/design/motor_ability_index_v2.md`。
 *
 * モーターpt は 3 段階で決まる:
 *
 *   1. 素点   = 直近6節の走を採点し、時間減衰 + コース補正 + ベイズ収縮した加重平均
 *   2. モーターpt = 50 + 10 × (素点 − μ_場) / σ_場   ← index CSV (`N枠_モーターpt`)
 *   3. 寄与   = w_場 × モーターpt                     ← index CSV (`N枠_寄与_モーターpt`)
 *
 * **選手pt (`racer-pt.ts`) と違い、1 の素点は fun-site 側で再計算できない**。
 * 素点の入力は「当場の過去6節ぶんの race_cards（全モーターの全走）」と
 * 「コース補正のための全場横断ベースライン」で、fun-site が取得しているのは
 * 当日ぶんの CSV だけだからである。したがってこのファイルが持つのは
 *
 *   - スコア表と着順トークンの分類ルール（= 1 走がどう採点されるか）
 *   - 集計パラメータ（節数・半減期・収縮強度など）を説明用に定数化したもの
 *   - **今節**の走りだけを採点する `computeMotorSessionBreakdown()`
 *
 * の 3 つ。最後のものはモーターpt そのものではなく **参考値** である
 * （モーターpt の集計は「当日を含む節」を対象外にするため。
 * BoatraceCSV `detect_sessions()` が `window_end` を除外する）。
 */

import type { SessionResultSlot } from "../types/race-card.js";

/** 級別。スコア表の行キー。 */
export type MotorPtRacerClass = "A1" | "A2" | "B1" | "B2";

/**
 * スコア表のグレード分類。
 * A1 / A2 は開催グレードで 2 分割し、B1 / B2 はグレードに依らず「全」1 本。
 */
export type MotorPtGradeBucket = "SG_G1" | "G2_G3_一般" | "全";

/** スコア表の 1 行。`points[着順-1]` が得点。 */
export type MotorPtScoreRow = {
  readonly racerClass: MotorPtRacerClass;
  readonly bucket: MotorPtGradeBucket;
  readonly points: readonly [number, number, number, number, number, number];
};

/**
 * 着順スコア表。BoatraceCSV `data/estimate/motor_ability_score.csv` と同値。
 *
 * 上位級の選手が乗って上位に入るのは「選手が強い」からで、モーターの評価としては
 * 割り引く。逆に B2 の 1 着はモーターの出足を強く示唆するので高く付く
 * （= 同じ 1 着でも B2:125pt に対し A1 の一般戦は 50pt）。
 */
export const MOTOR_PT_SCORE_TABLE: readonly MotorPtScoreRow[] = [
  { racerClass: "B2", bucket: "全", points: [125, 100, 75, 50, 25, 0] },
  { racerClass: "B1", bucket: "全", points: [100, 80, 60, 40, 20, 0] },
  { racerClass: "A2", bucket: "SG_G1", points: [125, 100, 75, 50, 25, 0] },
  { racerClass: "A2", bucket: "G2_G3_一般", points: [75, 60, 45, 30, 15, 0] },
  { racerClass: "A1", bucket: "SG_G1", points: [100, 80, 60, 40, 20, 0] },
  { racerClass: "A1", bucket: "G2_G3_一般", points: [50, 40, 30, 20, 10, 0] },
];

/** グレード分類の表示ラベル。 */
export const MOTOR_PT_GRADE_BUCKET_LABELS: Readonly<Record<MotorPtGradeBucket, string>> = {
  SG_G1: "SG / GⅠ",
  G2_G3_一般: "GⅡ・GⅢ・一般",
  全: "全グレード",
};

/**
 * 機材起因とみなす欠場等。**-100 点だが打点（分母）には計上する**。
 * 転 転覆 / 落 落水 / 沈 沈没 / エ エンスト。
 */
export const MOTOR_NEGATIVE_TOKENS: readonly string[] = ["転", "落", "沈", "エ"];

/** `MOTOR_NEGATIVE_TOKENS` に与える得点。 */
export const MOTOR_NEGATIVE_SCORE = -100;

/**
 * 集計から外すトークン（分子・分母とも計上しない）。
 * F / L / 失 / 妨 は選手起因、欠 / 不 は無効走。
 *
 * **選手pt とは扱いが逆**で、F・L はモーターの評価に含めない
 * （選手pt では 0 点として出走回数に計上され、素点を強く下げる）。
 */
export const MOTOR_SKIP_TOKENS: readonly string[] = ["F", "L", "失", "妨", "欠", "不"];

/**
 * 素点集計のパラメータ。BoatraceCSV `index_features.py` の同名定数と同期。
 * fun-site 側では計算に使わず、計算ロジックの解説にのみ使う。
 */
export const MOTOR_PT_PARAMS = {
  /** 採用節数（新→旧。時間減衰でテール側は自然に薄れる） */
  historySessions: 6,
  /** 節検出のために遡る日数 */
  lookbackDays: 90,
  /** 時間減衰の半減期（日） */
  decayHalfLifeDays: 60,
  /** ベイズ収縮の prior 強度（n_eff = k で 50% 収縮） */
  shrinkagePriorK: 10,
  /** コース baseline を (級別,グレード,コース) セルで採用する最小サンプル数 */
  laneBaselineMinSamples: 5,
  /** コース baseline の SD 下限（0 除算と z 残差の暴発を防ぐ） */
  laneBaselineSdFloor: 10,
} as const;

/** 開催グレードの生文字列 → A1 / A2 に適用するグレード分類。 */
export const motorPtRaceGradeBucket = (grade: string): "SG_G1" | "G2_G3_一般" => {
  const s = (grade ?? "").trim();
  for (const tag of ["SG", "ＳＧ", "PG", "ＰＧ", "G1", "Ｇ１", "ＧⅠ"]) {
    if (s.includes(tag)) return "SG_G1";
  }
  return "G2_G3_一般";
};

/** 級別が B1 / B2 なら開催グレードに依らず「全」。 */
export const resolveMotorPtBucket = (
  racerClass: string,
  raceGradeBucket: "SG_G1" | "G2_G3_一般",
): MotorPtGradeBucket => (racerClass === "B1" || racerClass === "B2" ? "全" : raceGradeBucket);

/** スコア表の行を引く。級別が A1/A2/B1/B2 以外なら undefined（採点不能）。 */
export const motorPtScoreRow = (
  racerClass: string,
  bucket: MotorPtGradeBucket,
): MotorPtScoreRow | undefined =>
  MOTOR_PT_SCORE_TABLE.find((row) => row.racerClass === racerClass && row.bucket === bucket);

/**
 * 節間成績スロットの着順を正規化する。`normalize_finish_token()` の移植。
 * 未出走・未知トークンは null。
 */
export const normalizeMotorFinishToken = (raw: string): string | null => {
  const s = (raw ?? "").trim();
  if (s === "" || s.toLowerCase() === "nan") return null;
  // 全角数字 ０-９ / 数値形式 ("4" / "4.0")
  const half = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const n = Number(half);
  if (Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= 6) return String(n);
  const t = s.replace("Ｆ", "F").replace("Ｌ", "L");
  if (MOTOR_NEGATIVE_TOKENS.includes(t) || MOTOR_SKIP_TOKENS.includes(t)) return t;
  return null;
};

/** 1 走の採点結果。 */
export type MotorPtRunMark =
  /** 着順 1-6。スコア表の値が加算され、打点 1 に計上される */
  | { readonly kind: "scored"; readonly rank: number; readonly score: number }
  /** 転 / 落 / 沈 / エ。-100 点で打点 1 に計上される */
  | { readonly kind: "negative"; readonly token: string; readonly score: number }
  /** F / L / 失 / 妨 / 欠 / 不。得点・打点とも計上しない */
  | { readonly kind: "skipped"; readonly token: string };

/**
 * 1 走の採点。`score_motor_run()` の移植。
 * 採点対象外（スキップトークン / 未知トークン / 級別不明）は null。
 */
export const scoreMotorRun = (
  row: MotorPtScoreRow | undefined,
  rawRank: string,
): MotorPtRunMark | null => {
  const token = normalizeMotorFinishToken(rawRank);
  if (token === null) return null;
  if (MOTOR_NEGATIVE_TOKENS.includes(token)) {
    return { kind: "negative", token, score: MOTOR_NEGATIVE_SCORE };
  }
  if (MOTOR_SKIP_TOKENS.includes(token)) return { kind: "skipped", token };
  if (row === undefined) return null;
  const rank = Number(token);
  return { kind: "scored", rank, score: row.points[rank - 1] ?? 0 };
};

/** 今節 1 走ぶんの採点内訳。 */
export type MotorPtRun = {
  /** 開催日次 (1-7) */
  readonly day: number;
  /** その日の何走目か (1-2) */
  readonly run: number;
  /** 出走したレース番号 */
  readonly race: number;
  /** 進入コース (1-6)。不明は 0。コース補正の入力になる値 */
  readonly entryCourse: number;
  /** 枠番 (1-6)。不明は 0 */
  readonly lane: number;
  readonly mark: MotorPtRunMark;
};

/** 今節の採点内訳（**参考値**。モーターpt の集計対象ではない）。 */
export type MotorPtSessionBreakdown = {
  /** 採点に使った級別 */
  readonly racerClass: string;
  /** 適用されたグレード分類 */
  readonly bucket: MotorPtGradeBucket;
  /** 適用されたスコア表の行。級別不明なら undefined */
  readonly row: MotorPtScoreRow | undefined;
  /** 出走済みスロットの採点結果（時系列順） */
  readonly runs: readonly MotorPtRun[];
  /** 得点計 */
  readonly totalScore: number;
  /** 打点（分母）。scored + negative の本数 */
  readonly countedRuns: number;
  /** 単純平均。打点 0 なら null */
  readonly average: number | null;
};

/**
 * **今節**の走りをスコア表で採点する。
 *
 * モーターpt の素点は当日を含む節を対象外にするため、この値はモーターpt には
 * 一切入っていない。「このモーターが今節どう走っているか」を、モーターpt と
 * 同じものさし（スコア表）で読むための参考値。時間減衰・コース補正・
 * ベイズ収縮もかけていない単純平均である。
 *
 * @param slots 今節の 14 スロット（未出走を含む）
 * @param racerClass このモーターに乗っている選手の級別
 * @param raceGrade 開催グレードの生文字列
 */
export const computeMotorSessionBreakdown = (
  slots: readonly SessionResultSlot[],
  racerClass: string,
  raceGrade: string,
): MotorPtSessionBreakdown => {
  const bucket = resolveMotorPtBucket(racerClass, motorPtRaceGradeBucket(raceGrade));
  const row = motorPtScoreRow(racerClass, bucket);

  const runs: MotorPtRun[] = [];
  let totalScore = 0;
  let countedRuns = 0;

  for (const slot of slots) {
    const mark = scoreMotorRun(row, slot.rank);
    if (mark === null) continue;
    if (mark.kind !== "skipped") {
      totalScore += mark.score;
      countedRuns += 1;
    }
    runs.push({
      day: slot.day,
      run: slot.run,
      race: slot.race,
      entryCourse: slot.entryCourse,
      lane: slot.lane,
      mark,
    });
  }

  return {
    racerClass,
    bucket,
    row,
    runs,
    totalScore,
    countedRuns,
    average: countedRuns === 0 ? null : totalScore / countedRuns,
  };
};
