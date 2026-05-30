import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  type DailyBetPayoutSnapshot,
  type RacePrediction,
  type SeriesBetPayoutAggregate,
  type SeriesDayInfo,
  aggregateSeriesBetPayout,
  detectSeries,
  formatDate,
  getPreviousDate,
  parseDate,
} from "@fun-site/shared";
import { fetchHistoricalPredictions } from "./data-writer.js";
import {
  type SeriesState,
  type StadiumSeriesState,
  extractDailySnapshotsByStadium,
  loadSeriesState,
  mergeDailySnapshots,
  pruneSeriesState,
  saveSeriesState,
} from "./series-state-store.js";

/**
 * 節集計のさかのぼり上限 (日数)。
 *
 * SG / G1 の節は通常 6〜7 日。フェイルセーフとして 7 日を採用。
 * 8 日以上連続する超ロング節 (PG1 等) は直近 7 日でクリップされる。
 */
export const SERIES_LOOKBACK_DAYS = 7 as const;

/**
 * Web 側から読み込まれる節集計結果。`_meta/series-summary.json` として書き出す。
 *
 * `byStadium[stadiumId]` が undefined の場合、その会場は当日開催が無く、節集計対象外。
 */
export type SeriesSummary = {
  readonly updatedAt: string;
  readonly raceDate: string;
  readonly byStadium: Readonly<Record<string, SeriesBetPayoutAggregate>>;
};

const WEB_PACKAGE_DIR = resolve(import.meta.dirname, "../../../web");
const LOCAL_SUMMARY_PATH = resolve(WEB_PACKAGE_DIR, "src/data/_meta/series-summary.json");

/**
 * 当日分の予想 + キャッシュされた過去日スナップショットから、会場別の節集計を生成する。
 *
 * 流れ:
 * 1. GCS から `series-state.json` (過去日スナップショット + dayLabel) を読む
 * 2. 当日の predictions から会場別スナップショット + dayLabel を抽出 → state にマージ
 * 3. 必要な過去日 (= state に無い日 / lookback 上限の範囲) があれば GCS から
 *    予想 JSON を取得して追加でスナップショット化 → state にマージ
 * 4. state から会場ごとに `detectSeries` → `aggregateSeriesBetPayout`
 * 5. 結果を `series-summary.json` としてローカルに書き出し、state を GCS に書き戻し
 *
 * 戻り値の `SeriesSummary` は永続化と同じ内容を呼び出し側にも返す (テスト容易性のため)。
 */
export const buildSeriesSummary = async (
  predictions: readonly RacePrediction[],
  raceDate: string,
): Promise<SeriesSummary> => {
  // 1. 既存 state を取得 (失敗時は空 state)
  let state = await loadSeriesState();

  // 2. 当日分のスナップショットを抽出してマージ
  const todaySnapshots = extractDailySnapshotsByStadium(predictions, raceDate);
  state = mergeDailySnapshots(state, raceDate, todaySnapshots);

  // 3. lookback 範囲内で state に無い過去日を補完
  //    候補日 = [raceDate - 1, raceDate - 2, ..., raceDate - (LOOKBACK - 1)]
  const candidateDates: string[] = [];
  let cursor = raceDate;
  for (let i = 1; i < SERIES_LOOKBACK_DAYS; i++) {
    cursor = formatDate(getPreviousDate(parseDate(cursor)));
    candidateDates.push(cursor);
  }
  const oldestKeepDate = candidateDates[candidateDates.length - 1] ?? raceDate;

  // どの過去日が「どの stadium で穴か」を判定
  const missingDates = new Set<string>();
  for (const date of candidateDates) {
    for (const stadiumId of Object.keys(state.byStadium)) {
      if (!state.byStadium[stadiumId]?.perDay[date]) {
        // 不在は「会場で開催がなかった」or「キャッシュ未取得」のどちらか。
        // 区別するために GCS を 1 度だけ引きに行く。
        missingDates.add(date);
        break;
      }
    }
    // todaySnapshots に登場した会場で過去日が空のケースもカバー (新規会場)。
    for (const stadiumId of todaySnapshots.keys()) {
      if (!state.byStadium[stadiumId]?.perDay[date]) {
        missingDates.add(date);
      }
    }
  }

  // 必要な過去日のみ GCS から取得 (並列)
  if (missingDates.size > 0) {
    const fetched = await Promise.all(
      [...missingDates].map(async (date) => {
        const preds = await fetchHistoricalPredictions(date);
        return { date, predictions: preds };
      }),
    );
    for (const { date, predictions: preds } of fetched) {
      if (preds.length === 0) continue;
      const snaps = extractDailySnapshotsByStadium(preds, date);
      state = mergeDailySnapshots(state, date, snaps);
    }
  }

  // 4. 各会場で detectSeries -> aggregateSeriesBetPayout
  const byStadium: Record<string, SeriesBetPayoutAggregate> = {};
  for (const [stadiumId, stadiumState] of Object.entries(state.byStadium)) {
    // 当日の開催が無い会場は集計対象外
    if (!stadiumState.perDay[raceDate]) continue;
    const perDayInfo = buildPerDayInfo(stadiumState);
    const series = detectSeries(perDayInfo, raceDate, SERIES_LOOKBACK_DAYS);
    if (!series) continue;
    const snapshots: DailyBetPayoutSnapshot[] = series.dates
      .map((d) => stadiumState.perDay[d])
      .filter((s): s is DailyBetPayoutSnapshot => s !== undefined);
    const snapshotsByPredictor = extractSnapshotsByPredictor(stadiumState, series.dates);
    byStadium[stadiumId] = aggregateSeriesBetPayout(series, snapshots, snapshotsByPredictor);
  }

  // 5. 永続化: state を prune して GCS に書き戻し、summary をローカルに書き出し
  const prunedState = pruneSeriesState(state, oldestKeepDate);
  try {
    await saveSeriesState(prunedState);
  } catch (error) {
    console.warn(
      `Failed to save series state (non-fatal): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const summary: SeriesSummary = {
    updatedAt: new Date().toISOString(),
    raceDate,
    byStadium,
  };
  await writeLocalSeriesSummary(summary);
  return summary;
};

/** state から detectSeries 用の `Map<date, SeriesDayInfo>` を作る */
const buildPerDayInfo = (stadiumState: StadiumSeriesState): Map<string, SeriesDayInfo> => {
  const map = new Map<string, SeriesDayInfo>();
  for (const date of Object.keys(stadiumState.perDay)) {
    map.set(date, { date, dayLabel: stadiumState.dayLabels[date] ?? "" });
  }
  return map;
};

/**
 * 会場 state から「節 dates 内に存在する」予想者別 snapshot 配列を抽出。
 * 旧 state JSON (perDayByPredictor 未設定) では空 dict を返す。
 */
const extractSnapshotsByPredictor = (
  stadiumState: StadiumSeriesState,
  seriesDates: readonly string[],
): Readonly<Record<string, readonly DailyBetPayoutSnapshot[]>> => {
  const out: Record<string, DailyBetPayoutSnapshot[]> = {};
  for (const [predictorId, perDay] of Object.entries(stadiumState.perDayByPredictor ?? {})) {
    const snaps = seriesDates
      .map((d) => perDay[d])
      .filter((s): s is DailyBetPayoutSnapshot => s !== undefined);
    if (snaps.length > 0) out[predictorId] = snaps;
  }
  return out;
};

/** Astro が読む位置に summary を書き出す */
const writeLocalSeriesSummary = async (summary: SeriesSummary): Promise<void> => {
  await mkdir(dirname(LOCAL_SUMMARY_PATH), { recursive: true });
  await writeFile(LOCAL_SUMMARY_PATH, JSON.stringify(summary, null, 2), "utf-8");
};

/** 純関数版: state と当日 predictions から summary を計算する (テスト用) */
export const computeSeriesSummary = (
  state: SeriesState,
  predictions: readonly RacePrediction[],
  raceDate: string,
): SeriesSummary => {
  const todaySnapshots = extractDailySnapshotsByStadium(predictions, raceDate);
  const merged = mergeDailySnapshots(state, raceDate, todaySnapshots);
  const byStadium: Record<string, SeriesBetPayoutAggregate> = {};
  for (const [stadiumId, stadiumState] of Object.entries(merged.byStadium)) {
    if (!stadiumState.perDay[raceDate]) continue;
    const perDayInfo = buildPerDayInfo(stadiumState);
    const series = detectSeries(perDayInfo, raceDate, SERIES_LOOKBACK_DAYS);
    if (!series) continue;
    const snapshots = series.dates
      .map((d) => stadiumState.perDay[d])
      .filter((s): s is DailyBetPayoutSnapshot => s !== undefined);
    const snapshotsByPredictor = extractSnapshotsByPredictor(stadiumState, series.dates);
    byStadium[stadiumId] = aggregateSeriesBetPayout(series, snapshots, snapshotsByPredictor);
  }
  return {
    updatedAt: new Date().toISOString(),
    raceDate,
    byStadium,
  };
};
