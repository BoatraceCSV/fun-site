import type { RacePrediction } from "@fun-site/shared";
import pMap from "p-map";
import type { MergedRaceData } from "../fetcher/index.js";
import { analyzeRace, createFallbackPrediction, selectTargetRaces } from "./analyze.js";

const CONCURRENCY = 3;

/** 対象レースの展開予想を生成 */
export const analyzePredictions = async (
  mergedData: readonly MergedRaceData[],
): Promise<readonly RacePrediction[]> => {
  const targetRaces = selectTargetRaces(mergedData);
  console.info(`Analyzing ${targetRaces.length} races (12R from each stadium)`);

  const predictions = await pMap(
    targetRaces,
    async (data) => {
      try {
        const prediction = await analyzeRace(data);
        console.info(`Analyzed: ${data.program.stadium} ${data.program.raceNumber}R`);
        return prediction;
      } catch (error) {
        console.warn(
          `AI analysis failed for ${data.program.stadium} ${data.program.raceNumber}R: ${error instanceof Error ? error.message : error}. Using fallback.`,
        );
        return createFallbackPrediction(data);
      }
    },
    { concurrency: CONCURRENCY },
  );

  return predictions;
};

export { analyzeRace, createFallbackPrediction, selectTargetRaces } from "./analyze.js";
export { generateText } from "./gemini-client.js";
export { buildAnalysisPrompt } from "./prompt-builder.js";
