import type { RacePrediction } from "@fun-site/shared";
import { runAstroBuild } from "./build.js";
import { writePredictionData } from "./data-writer.js";
import { fetchDatesIndex, mergeDate, saveDatesIndex, writeLocalDatesIndex } from "./dates-index.js";
import { deployToStorage } from "./deploy.js";

/**
 * データ書き出し → dates index 取得・マージ → Astro ビルド → デプロイ → dates index 書き戻し。
 *
 * `raceDate` は dates index に当日を含めるために必要。
 */
export const buildAndDeploy = async (
  predictions: readonly RacePrediction[],
  raceDate: string,
): Promise<void> => {
  await writePredictionData(predictions);

  // dates index: GCS から取得 → 当日マージ → ローカルに書き出し (Astro が読む)
  // GCS 取得失敗時は空配列スタートで継続（過去日リストは空になるが致命的ではない）
  const existingDates = await fetchDatesIndex();
  const mergedDates = mergeDate(existingDates, raceDate);
  await writeLocalDatesIndex(mergedDates);

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
export { writePredictionData } from "./data-writer.js";
export { deployToStorage } from "./deploy.js";
export {
  buildAllRacePredictions,
  buildRacePrediction,
} from "./prediction-builder.js";
