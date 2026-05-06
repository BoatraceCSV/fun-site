import type { RacePrediction } from "@fun-site/shared";
import { runAstroBuild } from "./build.js";
import { writePredictionData } from "./data-writer.js";
import { deployToStorage } from "./deploy.js";

/** データ書き出し → Astro ビルド → デプロイ */
export const buildAndDeploy = async (predictions: readonly RacePrediction[]): Promise<void> => {
  await writePredictionData(predictions);
  await runAstroBuild();
  await deployToStorage();
};

export { runAstroBuild } from "./build.js";
export { writePredictionData } from "./data-writer.js";
export { deployToStorage } from "./deploy.js";
export {
  buildAllRacePredictions,
  buildRacePrediction,
} from "./prediction-builder.js";
