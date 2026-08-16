/**
 * 枠番pt（枠番＝コースの有利不利）の解説用ユーティリティ。
 *
 * 枠番pt は index CSV (`N枠_枠番pt` / `N枠_寄与_枠番pt`) の成分で、
 * BoatraceCSV 側が **場 × 季節 × コース** で学習したコース強度テーブルを
 * その艇のコースで引いた値である。2 段階で決まる:
 *
 *   1. 枠番pt = 50 + 10 × z（テーブル値の場内偏差値）  ← index CSV (`N枠_枠番pt`)
 *   2. 寄与   = w_場 × 枠番pt                          ← index CSV (`N枠_寄与_枠番pt`)
 *
 * **選手pt (`racer-pt.ts`) と違い、fun-site 側で再計算できない**。入力が
 * 「その場の過去数年ぶんの着順実績を季節 × コースで集計したテーブル」で、
 * fun-site が取得しているのは当日ぶんの CSV だけだからである。
 * モーターpt (`motor-pt.ts`) と同じ立場で、このファイルが持つのは
 *
 *   - 枠番pt が何を引いた値なのかを説明するための定数
 *   - **枠番別過去10走**（`programs/waku10`）を集計する `computeWaku10Aggregate()`
 *
 * の 2 つ。後者は枠番pt の入力ではなく **参考値** である
 * （枠番pt は場全体の傾向で、選手個人がその枠でどう走ったかは見ていない）。
 */

import type { RacerWaku10, Waku10RunView } from "../types/prediction.js";
import { NOT_RACER_RESPONSIBLE_TOKENS, RACER_RESPONSIBLE_TOKENS } from "./racer-pt.js";

/** 枠番pt が引くテーブルの軸。説明用 */
export const WAKU_PT_TABLE_AXES: readonly string[] = ["場", "季節", "コース"];

/**
 * 枠番pt の偏差値スケール。BoatraceCSV 側が全成分共通で使う。
 * 平均 50 / 標準偏差 10 で、`z = (pt − 50) ÷ 10`。
 */
export const WAKU_PT_SCALE = { mean: 50, sd: 10 } as const;

/**
 * `programs/waku10` が持つ走数。CSV は 10 スロット固定で、出走歴が
 * 足りない枠は空スロット（`RacerWaku10.runs` からは除外済み）になる。
 */
export const WAKU10_MAX_RUNS = 10;

/** 着順 1-6 ぶんの内訳。`rankCounts[着順-1]` が本数 */
export type Waku10RankCounts = readonly [number, number, number, number, number, number];

/** 着順以外のトークン 1 種ぶんの集計 */
export type Waku10TokenCount = {
  /** "F" / "L" / "欠" など */
  readonly token: string;
  readonly count: number;
  /** 選手責任 (F / L / 失 / 妨) か。false は 欠 / 転 / 落 / 沈 / エ / 不 */
  readonly racerResponsible: boolean;
};

/** 1 艇ぶんの枠番別過去10走の集計（**枠番pt の入力ではない参考値**） */
export type Waku10Aggregate = {
  readonly boatNumber: number;
  readonly racerName: string;
  /** CSV に載っていた走の総数（最大 {@link WAKU10_MAX_RUNS}） */
  readonly totalRuns: number;
  /**
   * 率の分母。着順 1-6 の走に、選手責任トークン (F / L / 失 / 妨) を足したもの。
   * 選手責任外 (欠 / 転 / 落 / 沈 / エ / 不) は無かった扱いで分母から外す
   * （選手pt の素点と同じ規則。`racer-pt.ts`）。
   */
  readonly countedRuns: number;
  readonly rankCounts: Waku10RankCounts;
  /** 1 着の本数 */
  readonly firstCount: number;
  /** 2 着以内の本数 */
  readonly top2Count: number;
  /** 3 着以内の本数 */
  readonly top3Count: number;
  /** 1着率 (%)。分母 0 なら null */
  readonly firstRate: number | null;
  /** 2連対率 (%)。分母 0 なら null */
  readonly top2Rate: number | null;
  /** 3連対率 (%)。分母 0 なら null */
  readonly top3Rate: number | null;
  /** 着順以外のトークンの内訳（出現順） */
  readonly tokenCounts: readonly Waku10TokenCount[];
  /**
   * 進入コースが枠番と違った走の本数（前付け・avoidance で枠なりが崩れた走）。
   * 枠番pt は枠番ではなく **コース** の強度なので、ここが多い枠は
   * 枠番pt の読みと実際の走りがずれやすい。
   */
  readonly offCourseRuns: number;
  /** そのうち CSV が空欄 = 枠なり進入だった走の本数 */
  readonly asWakuRuns: number;
};

const isRankToken = (rank: string): boolean => /^[1-6]$/.test(rank);

const rate = (count: number, denominator: number): number | null =>
  denominator === 0 ? null : (count / denominator) * 100;

/**
 * 枠番別過去10走を集計する。
 *
 * 枠番pt は「この場のこの季節のこのコースはどれくらい有利か」で、選手個人が
 * その枠でどう走ったかは見ていない。この集計はその差を読み手が埋めるための
 * 参考値で、枠番pt には一切入っていない。
 */
export const computeWaku10Aggregate = (boat: RacerWaku10): Waku10Aggregate => {
  const rankCounts: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const tokenOrder: string[] = [];
  const tokenTally = new Map<string, number>();
  let countedRuns = 0;
  let offCourseRuns = 0;
  let asWakuRuns = 0;

  for (const run of boat.runs as readonly Waku10RunView[]) {
    if (run.courseIsAsWaku) asWakuRuns += 1;
    if (run.entryCourse > 0 && run.entryCourse !== boat.boatNumber) offCourseRuns += 1;

    if (isRankToken(run.rank)) {
      const rank = Number(run.rank);
      rankCounts[rank - 1] = (rankCounts[rank - 1] ?? 0) + 1;
      countedRuns += 1;
      continue;
    }
    if (run.rank === "") continue;
    if (!tokenTally.has(run.rank)) tokenOrder.push(run.rank);
    tokenTally.set(run.rank, (tokenTally.get(run.rank) ?? 0) + 1);
    // 選手責任 (F / L / 失 / 妨) は分母に計上、選手責任外は無かった扱い
    if (RACER_RESPONSIBLE_TOKENS.includes(run.rank)) countedRuns += 1;
  }

  const firstCount = rankCounts[0];
  const top2Count = firstCount + rankCounts[1];
  const top3Count = top2Count + rankCounts[2];

  return {
    boatNumber: boat.boatNumber,
    racerName: boat.racerName,
    totalRuns: boat.runs.length,
    countedRuns,
    rankCounts,
    firstCount,
    top2Count,
    top3Count,
    firstRate: rate(firstCount, countedRuns),
    top2Rate: rate(top2Count, countedRuns),
    top3Rate: rate(top3Count, countedRuns),
    tokenCounts: tokenOrder.map((token) => ({
      token,
      count: tokenTally.get(token) ?? 0,
      racerResponsible: RACER_RESPONSIBLE_TOKENS.includes(token),
    })),
    offCourseRuns,
    asWakuRuns,
  };
};

/** `NOT_RACER_RESPONSIBLE_TOKENS` の再輸出。分母から外すトークンの説明に使う */
export const WAKU10_EXCLUDED_TOKENS: readonly string[] = NOT_RACER_RESPONSIBLE_TOKENS;

/** 分母に計上するトークン（選手責任）の説明用 */
export const WAKU10_COUNTED_TOKENS: readonly string[] = RACER_RESPONSIBLE_TOKENS;
