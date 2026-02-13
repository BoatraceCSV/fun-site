import type { ConfirmationRow, RacePrediction } from "@fun-site/shared";
import { runAstroBuild } from "./build.js";
import { writeConfirmationsData, writePredictionData, writeStatsData } from "./data-writer.js";
import { deployToStorage } from "./deploy.js";

/** データ書き出し → Astro ビルド → デプロイ */
export const buildAndDeploy = async (
  predictions: readonly RacePrediction[],
  confirmations: readonly ConfirmationRow[],
): Promise<void> => {
  await writePredictionData(predictions);
  await writeConfirmationsData(confirmations);
  await writeStatsData(predictions, confirmations);
  await runAstroBuild();
  await deployToStorage();
};

export { runAstroBuild } from "./build.js";
export { writeConfirmationsData, writePredictionData, writeStatsData } from "./data-writer.js";
export { deployToStorage } from "./deploy.js";
