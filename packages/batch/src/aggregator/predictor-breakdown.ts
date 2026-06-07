import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  AiEvaluation,
  Bucket,
  Metrics,
  PredictorBreakdown,
  PredictorBreakdownReport,
  PredictorSpec,
  RacePrediction,
  TimeseriesPoint,
} from "@fun-site/shared";
import { STADIUMS, allPredictors } from "@fun-site/shared";
import { fetchHistoricalPredictions } from "../site-builder/data-writer.js";

/**
 * 統計ページ (`/stats`) 用の分析軸別集計。
 *
 * 既存の `predictor-stats.ts` (予想者 × 月、当日 + 直前合算) とは別に、
 * **直前 (realtime) のみ** を対象に 7 軸 (時系列 / 場別 / グレード別 /
 * 買い目点数別 / 本命枠番別 / 配当帯別 / 風速別) で回収率・的中率を集計する。
 *
 * 集計対象レースの条件は `betPayout.realtime.betCostYen > 0` (= 直前買い目が
 * 組めた)。1 レースは各軸へちょうど 1 回だけ加算される。
 */

const WEB_PACKAGE_DIR = resolve(import.meta.dirname, "../../../web");
const LOCAL_BREAKDOWN_PATH = resolve(WEB_PACKAGE_DIR, "src/data/predictors/breakdown.json");

const STADIUM_NAME = new Map(STADIUMS.map((s) => [s.id, s.name] as const));
const UNKNOWN_KEY = "unknown";
const UNKNOWN_LABEL = "不明";

/** グレードコード → 表示ラベル。固定の表示順を兼ねる。 */
const GRADE_ORDER: readonly (readonly [string, string])[] = [
  ["SG", "SG"],
  ["PG1", "PG1"],
  ["G1", "G1"],
  ["G2", "G2"],
  ["G3", "G3"],
  ["IP", "一般"],
];
const GRADE_LABEL = new Map(GRADE_ORDER);

/** 買い目点数のビン定義。境界は実データ分布を見て調整可能。 */
const BET_COUNT_BINS: readonly { key: string; label: string; max: number }[] = [
  { key: "p1_4", label: "1〜4点", max: 4 },
  { key: "p5_9", label: "5〜9点", max: 9 },
  { key: "p10_19", label: "10〜19点", max: 19 },
  { key: "p20_", label: "20点〜", max: Number.POSITIVE_INFINITY },
];

/** 配当帯のビン定義 (確定 3連単 配当・円)。 */
const PAYOUT_BANDS: readonly { key: string; label: string; max: number }[] = [
  { key: "band_lt1000", label: "〜999円", max: 999 },
  { key: "band_1000_2999", label: "1,000〜2,999円", max: 2999 },
  { key: "band_3000_9999", label: "3,000〜9,999円", max: 9999 },
  { key: "band_10000_", label: "1万円〜", max: Number.POSITIVE_INFINITY },
];

/** 風速のビン定義 (m/s)。 */
const WIND_BINS: readonly { key: string; label: string; max: number }[] = [
  { key: "w0_1", label: "0〜1m/s", max: 1 },
  { key: "w2_3", label: "2〜3m/s", max: 3 },
  { key: "w4_5", label: "4〜5m/s", max: 5 },
  { key: "w6_7", label: "6〜7m/s", max: 7 },
  { key: "w8_", label: "8m/s〜", max: Number.POSITIVE_INFINITY },
];

/** 内部集計用の可変アキュムレータ。 */
type Acc = {
  raceCount: number;
  hitCount: number;
  betCostYen: number;
  payoutYen: number;
};

const emptyAcc = (): Acc => ({ raceCount: 0, hitCount: 0, betCostYen: 0, payoutYen: 0 });

const addToAcc = (acc: Acc, hit: boolean, betCostYen: number, payoutYen: number): void => {
  acc.raceCount += 1;
  acc.hitCount += hit ? 1 : 0;
  acc.betCostYen += betCostYen;
  acc.payoutYen += payoutYen;
};

const finalize = (acc: Acc): Metrics => ({
  raceCount: acc.raceCount,
  hitCount: acc.hitCount,
  hitRate: acc.raceCount > 0 ? acc.hitCount / acc.raceCount : null,
  betCostYen: acc.betCostYen,
  payoutYen: acc.payoutYen,
  recoveryRate: acc.betCostYen > 0 ? acc.payoutYen / acc.betCostYen : null,
});

/** ビン定義配列から、値以上の最小 `max` を持つビンの key を返す。 */
const binKeyOf = (bins: readonly { key: string; max: number }[], value: number): string =>
  bins.find((b) => value <= b.max)?.key ?? bins[bins.length - 1]!.key;

/** 直前 AI 評価の strengthPt 最大艇 (= 本命) の枠番。同 pt は若い枠番優先。 */
const honmeiWaku = (evaluation: AiEvaluation | undefined): number | undefined => {
  if (!evaluation || evaluation.entries.length === 0) return undefined;
  let best = evaluation.entries[0]!;
  for (const e of evaluation.entries) {
    if (e.strengthPt > best.strengthPt) best = e;
  }
  return best.boatNumber;
};

/**
 * 1 軸ぶんのバケット集計器。`order` で表示順 (key → 順序) を制御し、
 * 未知 key は末尾に回す。`raceCount === 0` のバケットは出力しない。
 */
class AxisAggregator {
  private readonly buckets = new Map<string, Acc>();

  constructor(
    private readonly labelOf: (key: string) => string,
    private readonly orderKeys: readonly string[],
  ) {}

  add(key: string, hit: boolean, betCostYen: number, payoutYen: number): void {
    let acc = this.buckets.get(key);
    if (!acc) {
      acc = emptyAcc();
      this.buckets.set(key, acc);
    }
    addToAcc(acc, hit, betCostYen, payoutYen);
  }

  toBuckets(): Bucket[] {
    const orderIndex = new Map(this.orderKeys.map((k, i) => [k, i] as const));
    const rank = (key: string): number =>
      orderIndex.get(key) ??
      (key === UNKNOWN_KEY ? Number.MAX_SAFE_INTEGER : this.orderKeys.length);
    return Array.from(this.buckets.entries())
      .filter(([, acc]) => acc.raceCount > 0)
      .toSorted(([a], [b]) => {
        const ra = rank(a);
        const rb = rank(b);
        return ra !== rb ? ra - rb : a.localeCompare(b);
      })
      .map(([key, acc]) => ({ key, label: this.labelOf(key), metrics: finalize(acc) }));
  }
}

/**
 * `predictions` (= 任意の日数ぶんの RacePrediction) を予想者ごとに直前のみ集計し、
 * 7 軸の分析レポートを返す。純関数で副作用なし。テストはこの関数に対して書く。
 */
export const aggregatePredictorBreakdown = (
  predictions: readonly RacePrediction[],
): PredictorBreakdownReport => {
  const known = allPredictors();
  const specById = new Map<string, PredictorSpec>(known.map((p) => [p.id, p]));

  // 予想者 ID → 各軸アキュムレータ。
  type PredictorAcc = {
    total: Acc;
    byDate: Map<string, Acc>;
    byStadium: AxisAggregator;
    byGrade: AxisAggregator;
    byBetCount: AxisAggregator;
    byHonmeiWaku: AxisAggregator;
    byPayoutBand: AxisAggregator;
    byWindSpeed: AxisAggregator;
  };

  const newPredictorAcc = (): PredictorAcc => ({
    total: emptyAcc(),
    byDate: new Map(),
    byStadium: new AxisAggregator(
      (k) => STADIUM_NAME.get(k) ?? k,
      STADIUMS.map((s) => s.id),
    ),
    byGrade: new AxisAggregator(
      (k) => GRADE_LABEL.get(k) ?? UNKNOWN_LABEL,
      GRADE_ORDER.map(([k]) => k),
    ),
    byBetCount: new AxisAggregator(
      (k) => BET_COUNT_BINS.find((b) => b.key === k)?.label ?? k,
      BET_COUNT_BINS.map((b) => b.key),
    ),
    byHonmeiWaku: new AxisAggregator(
      (k) => (k === UNKNOWN_KEY ? UNKNOWN_LABEL : `${k}号艇`),
      ["1", "2", "3", "4", "5", "6"],
    ),
    byPayoutBand: new AxisAggregator(
      (k) =>
        k === UNKNOWN_KEY ? UNKNOWN_LABEL : (PAYOUT_BANDS.find((b) => b.key === k)?.label ?? k),
      PAYOUT_BANDS.map((b) => b.key),
    ),
    byWindSpeed: new AxisAggregator(
      (k) => (k === UNKNOWN_KEY ? UNKNOWN_LABEL : (WIND_BINS.find((b) => b.key === k)?.label ?? k)),
      WIND_BINS.map((b) => b.key),
    ),
  });

  const accById = new Map<string, PredictorAcc>();
  for (const p of known) accById.set(p.id, newPredictorAcc());

  for (const pred of predictions) {
    const windSpeed = pred.raceResult?.weather.windSpeed;
    const grade = pred.grade?.trim() ? pred.grade.trim() : UNKNOWN_KEY;
    for (const pp of pred.predictions ?? []) {
      const realtime = pp.betPayout.realtime;
      // 集計対象は直前買い目が組めたレースのみ。
      if (realtime.betCostYen <= 0) continue;

      let acc = accById.get(pp.predictorId);
      if (!acc) {
        // レジストリに無い ID (退役後に削除等) の過去 JSON フォールバック。
        acc = newPredictorAcc();
        accById.set(pp.predictorId, acc);
      }

      const hit = pp.betHitStatus.realtimeHit;
      const cost = realtime.betCostYen;
      const payout = realtime.payoutYen;

      addToAcc(acc.total, hit, cost, payout);

      // 時系列 (日次)。
      let dayAcc = acc.byDate.get(pred.raceDate);
      if (!dayAcc) {
        dayAcc = emptyAcc();
        acc.byDate.set(pred.raceDate, dayAcc);
      }
      addToAcc(dayAcc, hit, cost, payout);

      // 場別 / グレード別。
      acc.byStadium.add(pred.stadiumId, hit, cost, payout);
      acc.byGrade.add(grade, hit, cost, payout);

      // 買い目点数別。
      acc.byBetCount.add(binKeyOf(BET_COUNT_BINS, realtime.betCount), hit, cost, payout);

      // 本命枠番別。
      const waku = honmeiWaku(pp.aiEvaluationRealtime);
      acc.byHonmeiWaku.add(waku === undefined ? UNKNOWN_KEY : String(waku), hit, cost, payout);

      // 配当帯別 (確定 3連単 配当。欠損は不明)。
      const sanrentanPayout = realtime.actualSanrentan?.payout;
      acc.byPayoutBand.add(
        sanrentanPayout === undefined ? UNKNOWN_KEY : binKeyOf(PAYOUT_BANDS, sanrentanPayout),
        hit,
        cost,
        payout,
      );

      // 風速別 (確定結果の風速。欠損は不明)。
      acc.byWindSpeed.add(
        windSpeed === undefined ? UNKNOWN_KEY : binKeyOf(WIND_BINS, windSpeed),
        hit,
        cost,
        payout,
      );
    }
  }

  const buildTimeseries = (byDate: Map<string, Acc>): TimeseriesPoint[] => {
    const dates = Array.from(byDate.keys()).toSorted((a, b) => a.localeCompare(b));
    const cumulative = emptyAcc();
    return dates.map((date) => {
      const day = byDate.get(date)!;
      cumulative.raceCount += day.raceCount;
      cumulative.hitCount += day.hitCount;
      cumulative.betCostYen += day.betCostYen;
      cumulative.payoutYen += day.payoutYen;
      return {
        date,
        metrics: finalize(day),
        cumulative: finalize({ ...cumulative }),
      };
    });
  };

  const buildBreakdown = (predictorId: string, acc: PredictorAcc): PredictorBreakdown => {
    const spec = specById.get(predictorId);
    return {
      predictorId,
      predictorName: spec?.displayName ?? predictorId,
      slot: spec?.slot ?? Number.MAX_SAFE_INTEGER,
      status: spec?.status ?? "retired",
      startedAt: spec?.startedAt ?? "",
      total: finalize(acc.total),
      timeseries: buildTimeseries(acc.byDate),
      byStadium: acc.byStadium.toBuckets(),
      byGrade: acc.byGrade.toBuckets(),
      byBetCount: acc.byBetCount.toBuckets(),
      byHonmeiWaku: acc.byHonmeiWaku.toBuckets(),
      byPayoutBand: acc.byPayoutBand.toBuckets(),
      byWindSpeed: acc.byWindSpeed.toBuckets(),
    };
  };

  const predictors: PredictorBreakdown[] = [];
  for (const [id, acc] of accById) predictors.push(buildBreakdown(id, acc));
  // active が先頭・slot 昇順、retired は末尾。
  predictors.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return a.slot - b.slot;
  });

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    metric: "realtime",
    predictors,
  };
};

/**
 * `data/predictions/{date}/{raceCode}.json` を GCS から日付範囲ぶん引いてきて
 * 分析軸別レポートを生成し、`packages/web/src/data/predictors/breakdown.json`
 * に保存する。`buildPredictorStats` と同じ日付リストを与える想定。
 */
export const buildPredictorBreakdown = async (
  dates: readonly string[],
): Promise<PredictorBreakdownReport> => {
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
  const report = aggregatePredictorBreakdown(all);
  await mkdir(dirname(LOCAL_BREAKDOWN_PATH), { recursive: true });
  await writeFile(LOCAL_BREAKDOWN_PATH, JSON.stringify(report, null, 2), "utf-8");
  console.info(
    `Wrote predictor breakdown for ${report.predictors.length} predictors to ${LOCAL_BREAKDOWN_PATH}`,
  );
  return report;
};
