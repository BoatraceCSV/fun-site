/**
 * 選手pt（選手能力指数）の **素点（算出基準点）** 計算。
 *
 * BoatraceCSV 側 `scripts/boatrace/index_features.py` の `racer_pt_for_boat()` /
 * `score_for_finish()` / `grade_of()` / `parse_finishes()` の TypeScript 移植。
 * 式は br-racers.jp の能力指数算出式に準拠する。
 *
 * 選手pt は 3 段階で決まる:
 *
 *   1. 素点   = round(Σ 着順スコア / 出走回数)      ← **このファイルの責務**
 *   2. 選手pt = 50 + 10 × (素点 − μ_場) / σ_場       ← index CSV (`N枠_選手pt`)
 *   3. 寄与   = w_場 × 選手pt                        ← index CSV (`N枠_寄与_選手pt`)
 *
 * μ / σ / w は場別・月別に学習された値で fun-site には取り込んでいないため、
 * 2 以降は index CSV の値をそのまま表示する。1 だけは入力データ
 * (`programs/recent_national` / `recent_local`) が `RacePrediction.recentForm`
 * として手元にあるので、選手詳細ページで計算過程を開示するために再計算する。
 *
 * **移植にあたっての注意**:
 * - 丸めは Python の `round()` に合わせて **偶数丸め (round half to even)** を使う。
 *   `Math.round` は half-up なので 56.5 のようなケースで CSV と 1pt ずれる。
 * - 全国5節と当地5節は BoatraceCSV 側で単純連結されており重複排除が無い。
 *   当地で走った節は両方に現れて **二重計上** される。ここでも同じ挙動を再現し、
 *   どの節が二重計上されているかを `duplicated` で開示する。
 */

import { type RankMark, tokenizeRankString } from "./rank-marks.js";

/** グレード分類。スコア表の行に対応する 3 バケット。 */
export type RacerPtGradeBucket = "SG_GI" | "GII" | "GIII";

/**
 * 着順スコア表。`[バケット][優勝戦か][着順-1]`。
 * BoatraceCSV `index_features.py` の `SCORE_TABLE` と同値。
 */
export const RACER_PT_SCORE_TABLE: Readonly<
  Record<
    RacerPtGradeBucket,
    { readonly yusho: readonly number[]; readonly other: readonly number[] }
  >
> = {
  SG_GI: { yusho: [100, 98, 94, 91, 88, 85], other: [85, 82, 77, 73, 69, 65] },
  GII: { yusho: [80, 78, 74, 71, 68, 65], other: [70, 67, 62, 58, 54, 50] },
  GIII: { yusho: [65, 63, 59, 55, 52, 50], other: [60, 58, 55, 50, 46, 45] },
};

/** グレード分類の表示ラベル。 */
export const RACER_PT_GRADE_BUCKET_LABELS: Readonly<Record<RacerPtGradeBucket, string>> = {
  SG_GI: "SG / GⅠ",
  GII: "GⅡ",
  GIII: "GⅢ・一般",
};

/**
 * 選手責任の欠場等。**得点 0 だが出走回数には計上する**（＝素点を強く下げる）。
 * F フライング / L 出遅れ / 失 失格 / 妨 妨害失格。
 */
export const RACER_RESPONSIBLE_TOKENS: readonly string[] = ["F", "L", "失", "妨"];

/**
 * 非選手責任の欠場等。**分子・分母とも計上しない**（無かった扱い）。
 * 欠 欠場 / 転 転覆 / 落 落水 / 沈 沈没 / エ エンスト / 不 不完走。
 */
export const NOT_RACER_RESPONSIBLE_TOKENS: readonly string[] = ["欠", "転", "落", "沈", "エ", "不"];

/**
 * グレード生文字列 → スコア表のバケット。
 * どれにも当てはまらない文字列（"一般" 等）は GIII バケットに落ちる。
 */
export const racerPtGradeBucket = (grade: string): RacerPtGradeBucket => {
  const s = (grade ?? "").trim();
  if (s === "") return "GIII";
  if (s.includes("ＳＧ") || s.includes("SG") || s.includes("ＰＧ") || s.includes("PG")) {
    return "SG_GI";
  }
  if (s.includes("ＧⅠ") || s.includes("GⅠ") || s.includes("G1") || s.includes("Ｇ１")) {
    return "SG_GI";
  }
  if (s.includes("ＧⅡ") || s.includes("GⅡ") || s.includes("G2") || s.includes("Ｇ２")) {
    return "GII";
  }
  if (s.includes("ＧⅢ") || s.includes("GⅢ") || s.includes("G3") || s.includes("Ｇ３")) {
    return "GIII";
  }
  return "GIII";
};

/** 着順スコア。着順が 1-6 の範囲外なら 0。 */
export const racerPtScoreFor = (
  bucket: RacerPtGradeBucket,
  finish: number,
  yusho: boolean,
): number => {
  if (finish < 1 || finish > 6) return 0;
  return RACER_PT_SCORE_TABLE[bucket][yusho ? "yusho" : "other"][finish - 1] ?? 0;
};

/**
 * 偶数丸め（round half to even）。Python の組み込み `round()` と同じ挙動。
 * `Math.round(56.5)` は 57 になるが Python は 56 を返すため、CSV の 選手pt と
 * 突き合わせる素点はこちらで丸める必要がある。
 */
export const roundHalfToEven = (value: number): number => {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
};

/** 素点の入力になる 1 節分。`RacerRecentForm` の全国/当地セッションから組み立てる。 */
export type RacerPtSessionInput = {
  /** 全国5節 (`national`) 由来か当地5節 (`local`) 由来か */
  readonly source: "national" | "local";
  readonly startDate: string;
  readonly endDate: string;
  readonly stadiumName: string;
  /** グレード生文字列（"一般" / "ＧⅢ" / "ＳＧ" など） */
  readonly grade: string;
  /** 着順時系列の生文字列 */
  readonly ranks: string;
};

/** 素点計算における 1 トークンの扱い。着順列の可視化に使う。 */
export type RacerPtMark =
  /** 着順 1-6。`score` 点が加算され、出走 1 回に計上される */
  | {
      readonly kind: "rank";
      readonly rank: number;
      readonly yusho: boolean;
      readonly score: number;
    }
  /** F / L / 失 / 妨。0 点だが出走 1 回に計上される */
  | { readonly kind: "responsible"; readonly token: string }
  /** 欠 / 転 / 落 / 沈 / エ / 不、および解釈できない文字。集計から除外される */
  | { readonly kind: "excluded"; readonly token: string }
  /** 日区切り */
  | { readonly kind: "separator" };

/** 素点計算における 1 節分の内訳。 */
export type RacerPtSession = RacerPtSessionInput & {
  /** 適用されたスコア表のバケット */
  readonly bucket: RacerPtGradeBucket;
  /** 着順列をトークンごとに分解し、適用スコアを付与したもの */
  readonly marks: readonly RacerPtMark[];
  /** この節の得点計 */
  readonly score: number;
  /** この節の出走回数（F/L/失/妨 を含む） */
  readonly runs: number;
  /**
   * 同一節（場・期間が一致）が全国側と当地側の両方に現れているか。
   * true の節は素点で 2 回計上される（BoatraceCSV 側の実装挙動）。
   */
  readonly duplicated: boolean;
};

/** 素点の計算結果。 */
export type RacerPtBreakdown = {
  readonly sessions: readonly RacerPtSession[];
  readonly totalScore: number;
  readonly totalRuns: number;
  /**
   * 素点（算出基準点）。出走 0 回の場合は null。
   * null のとき index CSV 側では選手pt が `COMPONENT_MISSING_FALLBACK.racer` (=30) で
   * 補完される。
   */
  readonly basePoint: number | null;
};

/** 節の同一性キー。場名と期間で判定する。 */
const sessionKey = (s: RacerPtSessionInput): string =>
  `${s.stadiumName}|${s.startDate}|${s.endDate}`;

/** 1 節分の着順列を素点計算用のトークン列へ分解する。 */
const markSession = (input: RacerPtSessionInput, duplicated: boolean): RacerPtSession => {
  const bucket = racerPtGradeBucket(input.grade);
  const marks: RacerPtMark[] = [];
  let score = 0;
  let runs = 0;

  for (const mark of tokenizeRankString(input.ranks) as readonly RankMark[]) {
    if (mark.kind === "separator") {
      marks.push({ kind: "separator" });
      continue;
    }
    if (mark.kind === "rank") {
      // 1-6 以外の数字は BoatraceCSV 側でも集計対象外（分子・分母とも計上しない）。
      if (mark.rank < 1 || mark.rank > 6) {
        marks.push({ kind: "excluded", token: String(mark.rank) });
        continue;
      }
      const s = racerPtScoreFor(bucket, mark.rank, mark.yusho);
      score += s;
      runs += 1;
      marks.push({ kind: "rank", rank: mark.rank, yusho: mark.yusho, score: s });
      continue;
    }
    // 優勝戦の括弧に着順以外が入っているケース (`[F]` `[妨]` `[転]` 等)。
    // BoatraceCSV 側の `parse_finishes()` は括弧の中から**着順の数字だけ**を拾うため、
    // これらは得点にも出走回数にも一切計上されない（bare な `F` とは扱いが違う）。
    // CSV の 選手pt を説明するページなので、こちらも同じく読み捨てる。
    if (mark.yusho === true) {
      marks.push({ kind: "excluded", token: mark.token });
      continue;
    }
    if (RACER_RESPONSIBLE_TOKENS.includes(mark.token)) {
      runs += 1;
      marks.push({ kind: "responsible", token: mark.token });
      continue;
    }
    marks.push({ kind: "excluded", token: mark.token });
  }

  return { ...input, bucket, marks, score, runs, duplicated };
};

/**
 * 素点（算出基準点）を、節ごと・着順ごとの内訳付きで計算する。
 *
 * `sessions` は **BoatraceCSV 側と同じ順序**（全国 前1節→前5節、続いて当地
 * 前1節→前5節）で渡すこと。重複排除は行わない（同上の理由）。
 */
export const computeRacerPtBreakdown = (
  sessions: readonly RacerPtSessionInput[],
): RacerPtBreakdown => {
  const bySource = new Map<string, Set<string>>();
  for (const s of sessions) {
    const set = bySource.get(sessionKey(s)) ?? new Set<string>();
    set.add(s.source);
    bySource.set(sessionKey(s), set);
  }

  const marked = sessions.map((s) => markSession(s, (bySource.get(sessionKey(s))?.size ?? 0) > 1));
  const totalScore = marked.reduce((acc, s) => acc + s.score, 0);
  const totalRuns = marked.reduce((acc, s) => acc + s.runs, 0);

  return {
    sessions: marked,
    totalScore,
    totalRuns,
    basePoint: totalRuns === 0 ? null : roundHalfToEven(totalScore / totalRuns),
  };
};

/**
 * `RacerRecentForm` 相当の全国/当地セッションを、素点計算の入力順
 * （全国 前1節→前5節 → 当地 前1節→前5節）に並べ替えて返す。
 */
export const racerPtSessionInputs = (recentForm: {
  readonly national: readonly Omit<RacerPtSessionInput, "source">[];
  readonly local: readonly Omit<RacerPtSessionInput, "source">[];
}): RacerPtSessionInput[] => [
  ...recentForm.national.map((s) => ({ ...s, source: "national" as const })),
  ...recentForm.local.map((s) => ({ ...s, source: "local" as const })),
];
