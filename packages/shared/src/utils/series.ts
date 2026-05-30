import type { BetPayoutResult, DailyBetPayoutAggregate } from "./bet-payout.js";
import { aggregateDailyBetPayout } from "./bet-payout.js";
import { formatDate, getPreviousDate, parseDate } from "./date.js";

/**
 * 1 開催日分の `BetPayoutResult` を round 集計したスナップショット。
 *
 * 節 (series) 集計のキャッシュ単位として利用する。
 * 既存の `DailyBetPayoutAggregate` は `hitRate` / `recoveryRate` を持つが、
 * スナップショットは「合計値のみ」を保持し、節全体の比率は再計算する
 * (一日ずつの比率を平均してはならないため)。
 */
export type DailyBetPayoutSnapshot = {
  readonly date: string;
  readonly settledRaceCount: number;
  readonly hitCount: number;
  readonly totalBetCostYen: number;
  readonly totalPayoutYen: number;
};

/**
 * `DailyBetPayoutAggregate` をスナップショットに畳む。
 *
 * GCS 上の `_meta/series-state.json` に保存する形式に合わせるためのヘルパ。
 */
export const toDailySnapshot = (
  date: string,
  agg: DailyBetPayoutAggregate,
): DailyBetPayoutSnapshot => ({
  date,
  settledRaceCount: agg.settledRaceCount,
  hitCount: agg.hitCount,
  totalBetCostYen: agg.totalBetCostYen,
  totalPayoutYen: agg.totalPayoutYen,
});

/**
 * 1 日分の `BetPayoutResult[]` をスナップショットへ畳むユーティリティ。
 *
 * `aggregateDailyBetPayout` -> `toDailySnapshot` のショートカット。
 */
export const buildDailySnapshot = (
  date: string,
  results: readonly BetPayoutResult[],
): DailyBetPayoutSnapshot => toDailySnapshot(date, aggregateDailyBetPayout(results));

/** 節判定の入力。`dayLabel` は上流 CSV の生文字列（"初日" / "1日目" / "最終日" など） */
export type SeriesDayInfo = {
  readonly date: string;
  readonly dayLabel: string;
};

/** 検出された節の範囲 */
export type DetectedSeries = {
  /** 節の初日 (含む) */
  readonly startDate: string;
  /** 節の最終日 = `currentDate` (含む) */
  readonly endDate: string;
  /** 日数 (= `dates.length`) */
  readonly dayCount: number;
  /** 節に含まれる日付一覧 (昇順) */
  readonly dates: readonly string[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" 文字列の前日を返すヘルパ (JST カレンダー想定) */
const previousDateString = (date: string): string => formatDate(getPreviousDate(parseDate(date)));

/**
 * 「節」(連続した開催日) を検出する。
 *
 * アルゴリズム:
 * 1. `currentDate` が `perDay` に無ければ null を返す
 *    (= その日にこの会場の開催がなければ集計対象なし)
 * 2. `currentDate` から 1 日ずつ過去に向かって遡る
 * 3. その日が `perDay` に存在しなければ「会場が休み」とみなして遡りを停止
 * 4. `dayLabel === "初日"` を見つけたらその日を含めて停止 (節境界の明示マーカー)
 * 5. `lookbackDays` を超えたら強制的に停止 (フェイルセーフ)
 *
 * 戻り値の `dates` は昇順。`startDate` = `dates[0]`、`endDate` = `currentDate`。
 */
export const detectSeries = (
  perDay: ReadonlyMap<string, SeriesDayInfo>,
  currentDate: string,
  lookbackDays: number,
): DetectedSeries | null => {
  if (!DATE_RE.test(currentDate)) {
    throw new Error(`Invalid date format (expected YYYY-MM-DD): ${currentDate}`);
  }
  if (lookbackDays < 1) {
    throw new Error(`lookbackDays must be >= 1, got ${lookbackDays}`);
  }
  const todayInfo = perDay.get(currentDate);
  if (!todayInfo) return null;

  const dates: string[] = [currentDate];
  // 当日自身が初日ならその場で確定。
  if (todayInfo.dayLabel === "初日") {
    return {
      startDate: currentDate,
      endDate: currentDate,
      dayCount: 1,
      dates,
    };
  }
  let cursor = currentDate;
  for (let i = 1; i < lookbackDays; i++) {
    const prev = previousDateString(cursor);
    const info = perDay.get(prev);
    if (!info) break; // 会場の中休み / 節境界 (前日に開催無し)
    dates.unshift(prev);
    cursor = prev;
    if (info.dayLabel === "初日") break;
  }
  return {
    startDate: dates[0] ?? currentDate,
    endDate: currentDate,
    dayCount: dates.length,
    dates,
  };
};

/** 予想者ごとの節集計 (合計値と派生比率) */
export type PredictorSeriesAggregate = {
  readonly settledRaceCount: number;
  readonly hitCount: number;
  readonly totalBetCostYen: number;
  readonly totalPayoutYen: number;
  /** 的中率 = `hitCount / settledRaceCount` (0-1)。母数 0 のときは 0。 */
  readonly hitRate: number;
  /** 回収率 = `totalPayoutYen / totalBetCostYen` (0 ~ ∞)。母数 0 のときは 0。 */
  readonly recoveryRate: number;
};

/** 節 (= 連続した開催日) の集計結果 */
export type SeriesBetPayoutAggregate = {
  readonly seriesStartDate: string;
  readonly seriesEndDate: string;
  readonly dayCount: number;
  /** 節に含まれる日付一覧 (昇順)。 */
  readonly dates: readonly string[];
  readonly settledRaceCount: number;
  readonly hitCount: number;
  readonly totalBetCostYen: number;
  readonly totalPayoutYen: number;
  /** 的中率 = `hitCount / settledRaceCount` (0-1)。母数 0 のときは 0。 */
  readonly hitRate: number;
  /** 回収率 = `totalPayoutYen / totalBetCostYen` (0 ~ ∞)。母数 0 のときは 0。 */
  readonly recoveryRate: number;
  /**
   * 予想者別の節集計 (`predictor_id` → 集計)。
   * 旧 JSON ではこのフィールドが無いため UI 側は undefined フォールバックすること。
   * トップフィールド (settledRaceCount, hitRate, recoveryRate, ...) は
   * **primary predictor (slot=1)** の集計と一致するように埋める (後方互換)。
   */
  readonly byPredictor?: Readonly<Record<string, PredictorSeriesAggregate>>;
};

/**
 * 1 つの DailyBetPayoutSnapshot 集合を「合計値 + 比率」に畳むヘルパ。
 * `PredictorSeriesAggregate` 形式で返す (`SeriesBetPayoutAggregate.byPredictor`
 * の各要素と同じ形)。`series.dates` に含まれない日付は無視する。
 */
const aggregateSnapshots = (
  series: DetectedSeries,
  snapshots: readonly DailyBetPayoutSnapshot[],
): PredictorSeriesAggregate => {
  const allowed = new Set(series.dates);
  let settled = 0;
  let hits = 0;
  let cost = 0;
  let payout = 0;
  for (const s of snapshots) {
    if (!allowed.has(s.date)) continue;
    settled += s.settledRaceCount;
    hits += s.hitCount;
    cost += s.totalBetCostYen;
    payout += s.totalPayoutYen;
  }
  return {
    settledRaceCount: settled,
    hitCount: hits,
    totalBetCostYen: cost,
    totalPayoutYen: payout,
    hitRate: settled > 0 ? hits / settled : 0,
    recoveryRate: cost > 0 ? payout / cost : 0,
  };
};

/**
 * 節範囲内の日次スナップショットを合算して節集計を生成する。
 *
 * `snapshots` は `series.dates` の各日付に対応するものだけを渡せばよい。
 * 余分な日付のスナップショットが含まれていても、`series.dates` に含まれない
 * 日付は無視される。
 *
 * `hitRate` / `recoveryRate` は合算値から再計算する。日次平均では不正確。
 *
 * `snapshotsByPredictor` を渡すと、`SeriesBetPayoutAggregate.byPredictor` に
 * 予想者別の集計を埋める。primary predictor (`primaryPredictorId`) の集計は
 * トップフィールド (`settledRaceCount`, `hitRate`, ...) と同一視され、
 * `byPredictor[primaryPredictorId]` にも展開される。
 */
export const aggregateSeriesBetPayout = (
  series: DetectedSeries,
  snapshots: readonly DailyBetPayoutSnapshot[],
  snapshotsByPredictor?: Readonly<Record<string, readonly DailyBetPayoutSnapshot[]>>,
): SeriesBetPayoutAggregate => {
  const primary = aggregateSnapshots(series, snapshots);
  const byPredictor: Record<string, PredictorSeriesAggregate> | undefined = snapshotsByPredictor
    ? Object.fromEntries(
        Object.entries(snapshotsByPredictor).map(([predictorId, snaps]) => [
          predictorId,
          aggregateSnapshots(series, snaps),
        ]),
      )
    : undefined;
  return {
    seriesStartDate: series.startDate,
    seriesEndDate: series.endDate,
    dayCount: series.dayCount,
    dates: series.dates,
    settledRaceCount: primary.settledRaceCount,
    hitCount: primary.hitCount,
    totalBetCostYen: primary.totalBetCostYen,
    totalPayoutYen: primary.totalPayoutYen,
    hitRate: primary.hitRate,
    recoveryRate: primary.recoveryRate,
    ...(byPredictor !== undefined ? { byPredictor } : {}),
  };
};
