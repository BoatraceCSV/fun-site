/**
 * 展示pt（直前情報の展示走行の出来）の解説用ユーティリティ。
 *
 * 展示pt は index CSV (`N枠_展示pt` / `N枠_寄与_展示pt`) の成分で、**preview 由来**である。
 * 朝バッチ (`state=daily`) の時点では展示が行われていないため中立値 50 が入り、寄与は 0 に
 * 潰されている。締切5分前の直前情報が反映された `state=realtime` の行で初めて実測が入る。
 *
 * **選手pt (`racer-pt.ts`) と違い、fun-site 側で再計算できない。** 展示pt が展示タイム・
 * スタート展示・周回展示のどれをどう重み付けしているかは BoatraceCSV 側の実装で、
 * fun-site はその重みを取り込んでいないからである。モーターpt (`motor-pt.ts`) ・
 * 枠番pt (`waku-pt.ts`) と同じ立場で、このファイルが持つのは
 *
 *   - 展示pt がどのスケールの値で、daily と realtime で何が変わるのかを説明するための定数
 *   - **同じ直前情報スナップショットの計測値**（展示タイム・スタート展示ST）を
 *     展示pt と並べて順位で見比べる `computeExhibitPtAggregate()`
 *
 * の 2 つ。後者は展示pt の内訳ではなく **参考値** である（展示pt の入力かどうか、
 * 入力だとしてどの重みなのかは開示されていない）。
 */

import { competitionRanks, spearman } from "./ranking.js";

/**
 * 展示pt の偏差値スケール。BoatraceCSV 側が全成分共通で使う。
 * 平均 50 / 標準偏差 10 で、`z = (pt − 50) ÷ 10`。
 */
export const EXHIBIT_PT_SCALE = { mean: 50, sd: 10 } as const;

/**
 * `state=daily` の行に入る展示pt。展示が行われる前の中立値で、
 * このとき寄与は 0 に潰されている（`COMPONENT_MISSING_FALLBACK_DEFAULT` と同値）。
 */
export const EXHIBIT_PT_DAILY_NEUTRAL = 50;

/** 展示pt と並べて見る直前情報の一次ソース。説明用 */
export const EXHIBIT_PREVIEW_SOURCES: readonly string[] = [
  "previews/tkz",
  "previews/stt",
  "previews/original_exhibition",
];

/** 展示pt と並べる 1 艇ぶんの入力 */
export type ExhibitPtInput = {
  readonly boatNumber: number;
  /** 展示タイム (秒)。小さいほど速い。未計測 / tkz 未取得は null */
  readonly exhibitionTime: number | null;
  /** スタート展示の実測ST。小さいほど速く、負値はフライング側。stt 未取得は null */
  readonly exhibitionStartTiming: number | null;
  /** 展示pt（偏差値）。index CSV 由来。古い JSON では undefined */
  readonly exhibitPt: number | undefined;
};

/** 1 艇ぶんの集計 */
export type ExhibitPtBoatAggregate = {
  readonly boatNumber: number;
  readonly exhibitionTime: number | null;
  /** 展示タイムの速い順の順位（1 が最速）。同値は同順位で、次の順位はその数だけ飛ぶ */
  readonly timeRank: number | null;
  /** 最速艇との展示タイム差 (秒)。最速艇は 0 */
  readonly gapToFastestTime: number | null;
  readonly exhibitionStartTiming: number | null;
  /** スタート展示ST の速い順の順位（1 が最速）*/
  readonly startTimingRank: number | null;
  readonly exhibitPt: number | undefined;
  /** 展示pt の高い順の順位（1 が最上位）*/
  readonly ptRank: number | null;
  /**
   * `ptRank − timeRank`。正なら「展示タイムの速さの割に展示pt が低い」、
   * 負なら「展示タイムほどではないのに展示pt が高い」ことを示す。
   * どちらか一方でも順位が付かない艇は null。
   */
  readonly rankGap: number | null;
};

/** レース 1 本ぶんの集計 */
export type ExhibitPtAggregate = {
  /** 艇番昇順 */
  readonly boats: readonly ExhibitPtBoatAggregate[];
  /** 展示タイムが計測できている艇数 */
  readonly measuredTimeCount: number;
  /** スタート展示ST が取れている艇数 */
  readonly measuredStartTimingCount: number;
  /** 展示pt が入っている艇数 */
  readonly ptCount: number;
  readonly fastestTime: number | null;
  readonly slowestTime: number | null;
  /** 最遅 − 最速 (秒)。展示タイムの開きが小さいレースは展示pt の差も付きにくい */
  readonly timeSpread: number | null;
  /**
   * 展示pt と展示タイムの順位相関（スピアマン、タイは平均順位）。
   * **+1 = 展示タイムが速い艇ほど展示pt が高い**、−1 はその逆になるよう符号を揃えてある。
   * 両方が揃った艇が 3 未満、またはどちらかが全艇同値のときは null。
   */
  readonly ptTimeAgreement: number | null;
};

/**
 * 展示pt と、同じ直前情報スナップショットの計測値を並べて集計する。
 *
 * 返すのは展示pt の内訳ではなく **参考値**。展示pt がどの計測値をどう重み付けして
 * いるかは開示されていないので、順位と順位相関で「見た目どおりの評価になっているか」を
 * 読み手が確かめられるようにするためのものである。
 */
export const computeExhibitPtAggregate = (
  inputs: readonly ExhibitPtInput[],
): ExhibitPtAggregate => {
  const sorted = [...inputs].sort((a, b) => a.boatNumber - b.boatNumber);

  const times = sorted.map((i) => i.exhibitionTime);
  const startTimings = sorted.map((i) => i.exhibitionStartTiming);
  // 展示pt は「大きいほど上位」なので符号を反転して同じ順位付けに載せる
  const ptForRank = sorted.map((i) => (i.exhibitPt === undefined ? null : -i.exhibitPt));

  const timeRanks = competitionRanks(times);
  const startTimingRanks = competitionRanks(startTimings);
  const ptRanks = competitionRanks(ptForRank);

  const measuredTimes = times.filter((v): v is number => v !== null);
  const fastestTime = measuredTimes.length > 0 ? Math.min(...measuredTimes) : null;
  const slowestTime = measuredTimes.length > 0 ? Math.max(...measuredTimes) : null;

  const boats: ExhibitPtBoatAggregate[] = sorted.map((input, i) => {
    const timeRank = timeRanks[i] ?? null;
    const ptRank = ptRanks[i] ?? null;
    return {
      boatNumber: input.boatNumber,
      exhibitionTime: input.exhibitionTime,
      timeRank,
      gapToFastestTime:
        input.exhibitionTime !== null && fastestTime !== null
          ? input.exhibitionTime - fastestTime
          : null,
      exhibitionStartTiming: input.exhibitionStartTiming,
      startTimingRank: startTimingRanks[i] ?? null,
      exhibitPt: input.exhibitPt,
      ptRank,
      rankGap: timeRank !== null && ptRank !== null ? ptRank - timeRank : null,
    };
  });

  // 展示pt と展示タイムの両方が揃った艇だけで相関を取る。展示タイムは
  // 小さいほど速いので、符号を反転して「+1 = 速い艇ほど展示pt が高い」に揃える。
  const paired = boats.filter(
    (b): b is ExhibitPtBoatAggregate & { exhibitPt: number; exhibitionTime: number } =>
      b.exhibitPt !== undefined && b.exhibitionTime !== null,
  );
  const rho = spearman(
    paired.map((b) => b.exhibitPt),
    paired.map((b) => b.exhibitionTime),
  );

  return {
    boats,
    measuredTimeCount: measuredTimes.length,
    measuredStartTimingCount: startTimings.filter((v) => v !== null).length,
    ptCount: sorted.filter((i) => i.exhibitPt !== undefined).length,
    fastestTime,
    slowestTime,
    timeSpread: fastestTime !== null && slowestTime !== null ? slowestTime - fastestTime : null,
    ptTimeAgreement: rho === null ? null : -rho,
  };
};
