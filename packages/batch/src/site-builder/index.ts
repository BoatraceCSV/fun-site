import type { RacePrediction } from "@fun-site/shared";
import { runAstroBuild } from "./build.js";
import { savePredictionDataToGcs, writePredictionData } from "./data-writer.js";
import { fetchDatesIndex, mergeDate, saveDatesIndex, writeLocalDatesIndex } from "./dates-index.js";
import { deployToStorage } from "./deploy.js";
import { buildSeriesSummary } from "./series-aggregator.js";

/**
 * データ書き出し → dates index 取得・マージ → 節集計 → Astro ビルド → デプロイ → dates index 書き戻し。
 *
 * `raceDate` は dates index に当日を含めるため、および節集計の基準日として必要。
 */
export const buildAndDeploy = async (
  predictions: readonly RacePrediction[],
  raceDate: string,
): Promise<void> => {
  // 当日分の予想 JSON をローカル (Astro が読む) + GCS data バケットの両方に書き出し。
  // GCS 保存は過去日参照用 (節集計の incremental キャッシュを生成するため)。
  await writePredictionData(predictions);
  try {
    await savePredictionDataToGcs(predictions);
  } catch (error) {
    console.warn(
      `Failed to upload predictions to GCS data bucket (non-fatal): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // dates index: GCS から取得 → 当日マージ → ローカルに書き出し (Astro が読む)
  // GCS 取得失敗時は空配列スタートで継続（過去日リストは空になるが致命的ではない）
  const existingDates = await fetchDatesIndex();
  const mergedDates = mergeDate(existingDates, raceDate);
  await writeLocalDatesIndex(mergedDates);

  // 節集計: state を読み込み → 当日分をマージ → 必要なら過去日 JSON を補完
  // → byStadium 集計 → series-summary.json をローカルに書き出し + state を GCS に書き戻し。
  // 失敗してもサイト本体は動くため、非致命扱いで継続する。
  try {
    await buildSeriesSummary(predictions, raceDate);
  } catch (error) {
    console.warn(
      `Failed to build series summary (non-fatal): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  await runAstroBuild();
  await deployToStorage();

  // GCS に書き戻し（デプロイ成功後）。失敗しても次回ビルドで追従するので非致命扱い。
  try {
    await saveDatesIndex(mergedDates);
  } catch (error) {
    console.warn(
      `Failed to save dates index (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export { runAstroBuild } from "./build.js";
export { savePredictionDataToGcs, writePredictionData } from "./data-writer.js";
export { deployToStorage } from "./deploy.js";
export {
  buildAllRacePredictions,
  buildRacePrediction,
} from "./prediction-builder.js";
export {
  buildSeriesSummary,
  SERIES_LOOKBACK_DAYS,
  type SeriesSummary,
} from "./series-aggregator.js";
