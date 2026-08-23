/**
 * 展示pt（直前情報の展示走行の出来）の計算・解説用ユーティリティ。
 *
 * 展示pt は index CSV (`N枠_展示pt` / `N枠_寄与_展示pt`) の成分で、**preview 由来**である。
 * 朝バッチ (`state=daily`) の時点では展示が行われていないため中立値 50 が入る。
 * 締切5分前の直前情報が反映された `state=realtime` の行で初めて実測が入る。
 *
 * **枠番pt (`waku-pt.ts`) / 気象pt (`weather-pt.ts`) と同じく fun-site 側で再現できる**
 * （2026-08-23 まではできず「再現不可」と出していた）。3 段階で決まる:
 *
 *   1. 生値 = 展示タイム + オリジナル展示 1〜3 を **レース内で偏差値化して等重み平均**
 *      ← レース JSON の `preview`（`previews/tkz` + `previews/original_exhibition` 由来）
 *   2. 展示pt = 50 + 10 × z（生値の場内偏差値）  ← index CSV (`N枠_展示pt`)
 *   3. 寄与   = w_場 × 展示pt                     ← index CSV (`N枠_寄与_展示pt`)
 *
 * 枠番pt / 気象pt と違い **引く静的テーブルが無い**（生値がレース内で閉じている）ので、
 * 外から要るのは場別の μ / σ / w だけである。それは weights CSV に元から入っており、
 * batch が `exhibitPtBasis` としてレース JSON に焼き込んでいる。
 *
 * **項目別の重みは存在しない** — 4 系列は等重みの単純平均で、この点は「オリジナル展示に
 * 重みを掛けて足す」という直感とは違う。上流仕様は BoatraceCSV
 * `docs/data/estimate.md#展示pt-の算出手順fun-site-再現用`。
 *
 * このファイルが持つのは
 *
 *   - 生値 → 展示pt → 寄与 を再現する {@link computeExhibitPtStepsByBoat}
 *   - 展示pt のスケールと daily / realtime の違いを説明するための定数
 *   - **展示pt の入力ではない参考値**（スタート展示ST）を展示pt と並べて順位で
 *     見比べる {@link computeExhibitPtAggregate}
 *
 * の 3 つ。スタート展示ST は展示pt の入力ではない（`previews/stt` から上流が読むのは
 * 進入コースだけで、それを使うのは 枠番pt / 気象pt のほう）。
 */

import type { OriginalExhibition } from "../types/prediction.js";
import type { ExhibitPtBasis } from "../types/stadium-table.js";
import { competitionRanks, spearman } from "./ranking.js";

/**
 * 展示pt の偏差値スケール。BoatraceCSV 側が全成分共通で使う。
 * 平均 50 / 標準偏差 10 で、`z = (pt − 50) ÷ 10`。
 */
export const EXHIBIT_PT_SCALE = { mean: 50, sd: 10 } as const;

/**
 * `state=daily` の行に入る展示pt。展示が行われる前の中立値
 * （`COMPONENT_MISSING_FALLBACK_DEFAULT` と同値）。**寄与は 0 にはならず**
 * `w_場 × 50` が入る（全艇同じ値なので艇間の差が消えるだけ）。
 * 展示が欠測した realtime 行も同じ 50 になる。
 */
export const EXHIBIT_PT_DAILY_NEUTRAL = 50;

/**
 * 展示pt の生値になる直前情報の一次ソース。`previews/stt`（スタート展示）は
 * **入っていない** — 展示ST は上流のどの成分の入力にもなっていない。
 */
export const EXHIBIT_PT_SOURCES: readonly string[] = [
  "previews/tkz",
  "previews/original_exhibition",
];

/** 展示pt と並べて見る直前情報の一次ソース（参考値の `previews/stt` を含む）。説明用 */
export const EXHIBIT_PREVIEW_SOURCES: readonly string[] = [
  "previews/tkz",
  "previews/stt",
  "previews/original_exhibition",
];

/** 展示pt の生値で使う 系列 の出所 */
export type ExhibitPtSeriesSource = "exhibitionTime" | "original";

/** 展示pt の生値になる 1 系列（6 艇ぶん）。系列内でレース内偏差値を取る */
export type ExhibitPtSeries = {
  /** 表示ラベル。展示タイム系列は "展示タイム"、オリジナル展示は場別の計測項目名 */
  readonly label: string;
  readonly source: ExhibitPtSeriesSource;
  /** `boatNumbers` と同順の生値（秒）。未計測は null。小さいほど速い */
  readonly values: readonly (number | null)[];
};

/** 展示タイム系列のラベル。オリジナル展示のラベルは場ごとに CSV から来る */
export const EXHIBIT_TIME_SERIES_LABEL = "展示タイム";

/**
 * レース内偏差値。上流 `index_features.py` の `hensachi()` と同じ式。
 *
 * **符号が逆向き**であることに注意 — 4 系列とも「小さいほど速い」タイムなので、
 * 平均より小さい値ほど高い偏差値になる。σ は **母標準偏差**（ddof=0）で、
 * 有効値が 2 未満の系列は全艇 null、σ が 0 の系列は全艇 50 とする。
 */
export const raceHensachi = (values: readonly (number | null)[]): (number | null)[] => {
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (valid.length < 2) return values.map(() => null);

  const mean = valid.reduce((sum, v) => sum + v, 0) / valid.length;
  const sd = Math.sqrt(valid.reduce((sum, v) => sum + (v - mean) ** 2, 0) / valid.length);

  return values.map((v) => {
    if (v === null || !Number.isFinite(v)) return null;
    if (sd === 0) return EXHIBIT_PT_SCALE.mean;
    return EXHIBIT_PT_SCALE.mean + (EXHIBIT_PT_SCALE.sd * (mean - v)) / sd;
  });
};

/**
 * 展示pt の生値になる 4 系列を組み立てる。
 *
 * 順番は上流 `compute_features_for_day` と同じ 展示タイム → 値1 → 値2 → 値3。
 * オリジナル展示が無い場（江戸川）は 1 系列、`計測数=2` の場（住之江 / 尼崎 / 徳山）は
 * 3 系列になる。等重み平均なので **系列数が少ない場ほど 1 項目の影響が大きい**。
 */
export const buildExhibitPtSeries = (
  boatNumbers: readonly number[],
  exhibitionTimeByBoat: ReadonlyMap<number, number | null>,
  original: OriginalExhibition | null,
): ExhibitPtSeries[] => {
  const series: ExhibitPtSeries[] = [
    {
      label: EXHIBIT_TIME_SERIES_LABEL,
      source: "exhibitionTime",
      values: boatNumbers.map((n) => exhibitionTimeByBoat.get(n) ?? null),
    },
  ];
  if (original === null) return series;

  const valuesByBoat = new Map(original.boats.map((b) => [b.boatNumber, b.values]));
  original.labels.forEach((label, i) => {
    series.push({
      label,
      source: "original",
      values: boatNumbers.map((n) => valuesByBoat.get(n)?.[i] ?? null),
    });
  });
  return series;
};

/** 展示pt の計算過程のうち、1 艇 × 1 系列ぶん */
export type ExhibitPtTerm = {
  readonly label: string;
  readonly source: ExhibitPtSeriesSource;
  /** この艇の生値（秒）。未計測は null */
  readonly value: number | null;
  /** レース内偏差値。この艇が未計測、または系列ごと使えないときは null */
  readonly hensachi: number | null;
  /** この系列の 6 艇内の速い順の順位（1 が最速）。同値は同順位 */
  readonly rank: number | null;
};

/** 展示pt の生値まで（場別 μ/σ/w が無くてもここまでは出せる）1 艇ぶん */
export type ExhibitPtRaw = {
  readonly boatNumber: number;
  /** 系列ごとの内訳。使えなかった系列も `hensachi: null` で残す */
  readonly terms: readonly ExhibitPtTerm[];
  /** 平均に使えた系列数 */
  readonly usedCount: number;
  /**
   * 生値 = 使えた系列のレース内偏差値の等重み平均（小数第 2 位に丸めたもの）。
   * 上流が特徴量列に載せる時点で `round(v, 2)` するので、ここでも丸めてから
   * 偏差値に載せる（丸めないと 展示pt が最大 0.01 ずれる）。
   * 使える系列が 1 つも無い艇は null で、このとき展示pt は 50 補完になる。
   */
  readonly raw: number | null;
};

/** 展示pt の計算過程 1 艇ぶん。画面はこの順に「系列 → 平均 → 偏差値 → 寄与」を出す */
export type ExhibitPtSteps = ExhibitPtRaw & {
  /** 場内 z 値 = (raw − μ) ÷ σ。50 補完の艇は 0 */
  readonly z: number;
  /** 展示pt = 50 + 10 × z（50 補完の艇は 50） */
  readonly pt: number;
  /** 寄与 = w × 展示pt */
  readonly contribution: number;
};

/**
 * 6 艇ぶんの直前情報から 展示pt の **生値まで** を計算する。
 *
 * レース内偏差値は 6 艇まとめてでないと出せないので、艇ごとではなく
 * **レース単位**で計算して艇番のマップで返す。場別 μ/σ/w を必要としないので、
 * `exhibitPtBasis` が取れていないビルドでもここまでは画面に出せる。
 */
export const computeExhibitPtRawByBoat = (
  boatNumbers: readonly number[],
  series: readonly ExhibitPtSeries[],
): Map<number, ExhibitPtRaw> => {
  const hensachiBySeries = series.map((s) => raceHensachi(s.values));
  // 4 系列とも「小さいほど速い」タイムなので、昇順の順位付け（1 が最速）でよい
  const ranksBySeries = series.map((s) => competitionRanks(s.values));

  const out = new Map<number, ExhibitPtRaw>();
  boatNumbers.forEach((boatNumber, i) => {
    const terms: ExhibitPtTerm[] = series.map((s, k) => ({
      label: s.label,
      source: s.source,
      value: s.values[i] ?? null,
      hensachi: hensachiBySeries[k]?.[i] ?? null,
      rank: ranksBySeries[k]?.[i] ?? null,
    }));

    const used = terms
      .map((t) => t.hensachi)
      .filter((v): v is number => v !== null && Number.isFinite(v));

    // 上流は特徴量列に載せる時点で小数第 2 位に丸める (index_features.py の `ept`)。
    // `x * 100` を挟むと浮動小数点誤差で境界がずれるので toFixed で丸める。
    const raw =
      used.length > 0
        ? Number((used.reduce((sum, v) => sum + v, 0) / used.length).toFixed(2))
        : null;

    out.set(boatNumber, { boatNumber, terms, usedCount: used.length, raw });
  });
  return out;
};

/**
 * `exhibitPtBasis` と 6 艇ぶんの直前情報から 展示pt を再計算する。
 *
 * 上流 `compute_features_for_day` + `build_index.py` と同じ式なので、index CSV の
 * `N枠_展示pt` と小数第 2 位まで一致する（上流は出力時に `round(x, 2)`）。σ が 0 の
 * 場は上流と同じく z=0（= 偏差値 50）に倒す。
 *
 * ここで再現できるのは **`state=realtime` の行だけ**。daily の行は展示前なので、
 * 上流が成分を中立値 50 に固定している（計算式の外）。
 */
export const computeExhibitPtStepsByBoat = (
  basis: ExhibitPtBasis,
  boatNumbers: readonly number[],
  series: readonly ExhibitPtSeries[],
): Map<number, ExhibitPtSteps> => {
  const out = new Map<number, ExhibitPtSteps>();
  for (const [boatNumber, base] of computeExhibitPtRawByBoat(boatNumbers, series)) {
    // 生値が取れない艇は上流が 50 補完する (COMPONENT_MISSING_FALLBACK_DEFAULT)。
    // 偏差値変換を通さないので z は 0 相当。
    const z = base.raw === null ? 0 : basis.sigma > 0 ? (base.raw - basis.mu) / basis.sigma : 0;
    const pt = EXHIBIT_PT_SCALE.mean + EXHIBIT_PT_SCALE.sd * z;
    out.set(boatNumber, { ...base, z, pt, contribution: basis.weight * pt });
  }
  return out;
};

/**
 * 再現値が index CSV の表示値と一致しているか（小数第 2 位まで）。
 *
 * 重みは月次で動くうえ、直前情報 CSV も上流が index を作った後に差し替わりうるので、
 * 過去日の再ビルドではずれうる。画面は一致したときだけ「表示値と一致」と出し、
 * ずれたときは黙って両方を出す。
 */
export const exhibitPtMatchesIndex = (
  computed: number | undefined,
  indexPt: number | undefined,
): boolean =>
  computed !== undefined && indexPt !== undefined && Math.abs(computed - indexPt) < 0.005;

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
 * 内訳そのものは {@link computeExhibitPtStepsByBoat} が出す。こちらが返すのは
 * 「展示タイム 1 本の順位と展示pt の順位がどれだけ揃っているか」の要約で、
 * 展示pt が展示タイムだけの数字ではない（オリジナル展示 3 項目と等重み）ことを
 * 読み手が体感できるようにするためのものである。`exhibitionStartTiming`
 * （スタート展示ST）は **展示pt の入力ではない** 純粋な参考値。
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
