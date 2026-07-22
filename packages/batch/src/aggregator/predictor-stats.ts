import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PredictorSpec, RacePrediction } from "@fun-site/shared";
import { activePredictors, allPredictors, isSettledResult } from "@fun-site/shared";
import { fetchHistoricalPredictions } from "../site-builder/data-writer.js";

/**
 * 1 予想者ぶんの 1 ヶ月集計。回収率 = payoutYen / betCostYen (betCostYen=0 のときは null)。
 */
export type PredictorMonthlyStats = {
  readonly month: string; // "YYYY-MM"
  readonly raceCount: number; // 集計対象になったレース数 (買い目が組めたもののみ)
  readonly hitCount: number; // 当日 / 直前 いずれかが的中したレース数
  readonly dailyHitCount: number;
  readonly realtimeHitCount: number;
  readonly betCostYen: number; // 当日 + 直前 の合算購入額
  readonly payoutYen: number; // 当日 + 直前 の合算払戻額
  /** 回収率。`betCostYen === 0` のときは `null` (集計母数なし)。 */
  readonly recoveryRate: number | null;
};

export type PredictorOverallStats = {
  readonly predictorId: string;
  readonly predictorName: string;
  readonly slot: number;
  readonly status: PredictorSpec["status"];
  readonly startedAt: string;
  readonly componentKeys: readonly string[];
  /** 月次推移 (古→新)。 */
  readonly monthly: readonly PredictorMonthlyStats[];
  /** 通算合計。 */
  readonly total: PredictorMonthlyStats;
};

export type PredictorStatsReport = {
  readonly updatedAt: string;
  readonly predictors: readonly PredictorOverallStats[];
};

const WEB_PACKAGE_DIR = resolve(import.meta.dirname, "../../../web");
const LOCAL_STATS_PATH = resolve(WEB_PACKAGE_DIR, "src/data/predictors/stats.json");

const monthOf = (date: string): string => date.slice(0, 7); // YYYY-MM

const emptyMonthStats = (month: string): PredictorMonthlyStats => ({
  month,
  raceCount: 0,
  hitCount: 0,
  dailyHitCount: 0,
  realtimeHitCount: 0,
  betCostYen: 0,
  payoutYen: 0,
  recoveryRate: null,
});

const accumulate = (
  acc: PredictorMonthlyStats,
  betCostYen: number,
  payoutYen: number,
  dailyHit: boolean,
  realtimeHit: boolean,
): PredictorMonthlyStats => ({
  ...acc,
  raceCount: acc.raceCount + 1,
  hitCount: acc.hitCount + (dailyHit || realtimeHit ? 1 : 0),
  dailyHitCount: acc.dailyHitCount + (dailyHit ? 1 : 0),
  realtimeHitCount: acc.realtimeHitCount + (realtimeHit ? 1 : 0),
  betCostYen: acc.betCostYen + betCostYen,
  payoutYen: acc.payoutYen + payoutYen,
  recoveryRate:
    acc.betCostYen + betCostYen > 0
      ? (acc.payoutYen + payoutYen) / (acc.betCostYen + betCostYen)
      : null,
});

/**
 * `predictions` (= 任意の日数ぶんの RacePrediction) を予想者 × 月でグループ化し、
 * 各予想者の月次・通算統計を返す。
 *
 * 当日 / 直前を「どちらかでも買い目が組めていれば 1 レース」としてカウントし、
 * 購入額・払戻額・的中数は当日 + 直前を合算する (= 2 通り買った前提)。
 *
 * 純関数で副作用なし。テストはこの関数に対して書く。
 */
export const aggregatePredictorStats = (
  predictions: readonly RacePrediction[],
): PredictorStatsReport => {
  // predictorId → month → stats のバケット
  const byPredictor = new Map<string, Map<string, PredictorMonthlyStats>>();

  // active + retired 全予想者を初期化 (履歴ページで retired も表示するため)
  for (const p of allPredictors()) {
    byPredictor.set(p.id, new Map());
  }

  for (const pred of predictions) {
    // 未確定レース（結果未着・中止・不成立）は母数・購入額・分子から一括除外。
    if (!isSettledResult(pred.raceResult)) continue;
    const month = monthOf(pred.raceDate);
    const perPredictor = pred.predictions ?? [];
    for (const pp of perPredictor) {
      let perMonth = byPredictor.get(pp.predictorId);
      if (!perMonth) {
        // レジストリに無い (退役済みで registry からも削除された)
        // 予想者の過去 JSON が来た場合のフォールバック。
        perMonth = new Map();
        byPredictor.set(pp.predictorId, perMonth);
      }
      const current = perMonth.get(month) ?? emptyMonthStats(month);
      const totalCost = pp.betPayout.daily.betCostYen + pp.betPayout.realtime.betCostYen;
      // 集計対象は「買い目が組めた」レース (betCostYen > 0) のみ。
      if (totalCost === 0) continue;
      const totalPayout = pp.betPayout.daily.payoutYen + pp.betPayout.realtime.payoutYen;
      perMonth.set(
        month,
        accumulate(
          current,
          totalCost,
          totalPayout,
          pp.betHitStatus.dailyHit,
          pp.betHitStatus.realtimeHit,
        ),
      );
    }
  }

  // PredictorOverallStats のリストに整形 (slot 昇順、retired は末尾)
  const known = allPredictors();
  const knownIds = new Set(known.map((p) => p.id));
  const overall: PredictorOverallStats[] = [];

  const buildOverall = (
    predictorId: string,
    predictorName: string,
    slot: number,
    status: PredictorSpec["status"],
    startedAt: string,
    componentKeys: readonly string[],
  ): PredictorOverallStats => {
    const perMonth = byPredictor.get(predictorId) ?? new Map();
    const monthly = Array.from(perMonth.values()).toSorted((a, b) =>
      a.month.localeCompare(b.month),
    );
    let totalCost = 0;
    let totalPayout = 0;
    let total: PredictorMonthlyStats = emptyMonthStats("total");
    for (const m of monthly) {
      total = {
        ...total,
        raceCount: total.raceCount + m.raceCount,
        hitCount: total.hitCount + m.hitCount,
        dailyHitCount: total.dailyHitCount + m.dailyHitCount,
        realtimeHitCount: total.realtimeHitCount + m.realtimeHitCount,
      };
      totalCost += m.betCostYen;
      totalPayout += m.payoutYen;
    }
    total = {
      ...total,
      betCostYen: totalCost,
      payoutYen: totalPayout,
      recoveryRate: totalCost > 0 ? totalPayout / totalCost : null,
    };
    return {
      predictorId,
      predictorName,
      slot,
      status,
      startedAt,
      componentKeys,
      monthly,
      total,
    };
  };

  // レジストリに居る予想者 (active + retired)
  for (const p of known) {
    overall.push(buildOverall(p.id, p.displayName, p.slot, p.status, p.startedAt, p.componentKeys));
  }
  // レジストリから消えた (= 完全に削除された) ID で過去 JSON だけ残るケースに対応。
  // 通常運用では発生しないが、ID リネーム時の安全網。
  for (const id of byPredictor.keys()) {
    if (knownIds.has(id)) continue;
    overall.push(buildOverall(id, id, Number.MAX_SAFE_INTEGER, "retired", "", []));
  }
  // active が先頭・slot 昇順、retired はその後ろ・slot 昇順。
  overall.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return a.slot - b.slot;
  });

  return {
    updatedAt: new Date().toISOString(),
    predictors: overall,
  };
};

/**
 * `data/predictions/{date}/{raceCode}.json` を GCS から日付範囲ぶん引いてきて
 * 予想者統計レポートを生成し、`packages/web/src/data/predictors/stats.json` に保存する。
 *
 * 呼び出し側は対象日付リストを与える。Phase 1 では Web ビルド時に
 * 「`activePredictors()` の最古 `startedAt` から当日まで」を毎回フル集計する想定
 * (件数が少ないので問題ない)。Phase 3 で increment 化を検討。
 */
export const buildPredictorStats = async (
  dates: readonly string[],
): Promise<PredictorStatsReport> => {
  const all: RacePrediction[] = [];
  for (const date of dates) {
    try {
      const day = await fetchHistoricalPredictions(date);
      all.push(...day);
    } catch (error) {
      console.warn(
        `Failed to fetch predictions for ${date}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const report = aggregatePredictorStats(all);
  await mkdir(dirname(LOCAL_STATS_PATH), { recursive: true });
  await writeFile(LOCAL_STATS_PATH, JSON.stringify(report, null, 2), "utf-8");
  console.info(
    `Wrote predictor stats for ${report.predictors.length} predictors to ${LOCAL_STATS_PATH}`,
  );
  return report;
};

/**
 * `activePredictors()` の中で最古の `startedAt` から `endDate` までの日付配列を
 * 文字列 (YYYY-MM-DD) で返す。`endDate` は inclusive。
 */
export const datesForActivePredictors = (endDate: string): string[] => {
  const actives = activePredictors();
  if (actives.length === 0) return [];
  const startDates = actives.map((p) => p.startedAt).toSorted();
  const start = startDates[0];
  if (!start) return [];
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cursor.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
};
