import { toWinningTechnique } from "@fun-site/shared";
import type { AiPrediction, RacePrediction, WinningTechnique } from "@fun-site/shared";
import { z } from "zod";
import type { MergedRaceData } from "../fetcher/index.js";
import { generateText } from "./gemini-client.js";
import { buildAnalysisPrompt } from "./prompt-builder.js";

const TARGET_RACE_NUMBER = 12;

const startFormationEntrySchema = z.object({
  boatNumber: z.number().int().min(1).max(6),
  courseNumber: z.number().int().min(1).max(6),
  predictedST: z.number().min(-1).max(1),
});

const winningTechniqueSchema = z.enum([
  "nige",
  "sashi",
  "makuri",
  "makuri-sashi",
  "nuki",
  "megumare",
]);

const formationPatternSchema = z.enum(["flat", "inner-late", "middle-late", "outer-late"]);

const aiPredictionSchema = z.object({
  startFormation: z.object({
    entries: z.array(startFormationEntrySchema).length(6),
    pattern: formationPatternSchema,
  }),
  firstTurnScenario: z.string().max(500),
  predictedTechnique: winningTechniqueSchema,
  predictedOrder: z.array(z.number().int().min(1).max(6)).min(3).max(6),
  confidence: z.number().min(0).max(1),
  narrative: z.string().max(2000),
  suggestedBets: z.array(z.string().max(20)).max(10),
});

/** 対象レースを選定（各場12Rのみ） */
export const selectTargetRaces = (
  mergedData: readonly MergedRaceData[],
): readonly MergedRaceData[] =>
  mergedData.filter((data) => data.program.raceNumber === TARGET_RACE_NUMBER);

/** Gemini 3 Pro の JSON 応答を AiPrediction 型に変換 */
const parseAiResponse = (responseText: string): AiPrediction => {
  return aiPredictionSchema.parse(JSON.parse(responseText));
};

/** 1レース分の展開予想を生成 */
export const analyzeRace = async (data: MergedRaceData): Promise<RacePrediction> => {
  const { program, predictionPreview, estimate } = data;
  const prompt = buildAnalysisPrompt(program, predictionPreview, estimate);

  const responseText = await generateText(prompt);
  const aiPrediction = parseAiResponse(responseText);

  return {
    raceCode: program.raceCode,
    raceDate: program.raceDate,
    stadium: program.stadium,
    raceNumber: program.raceNumber,
    boats: program.boats,
    mlPrediction: {
      first: estimate?.predicted1st ?? 0,
      second: estimate?.predicted2nd ?? 0,
      third: estimate?.predicted3rd ?? 0,
      technique: estimate?.predictedTechnique ?? "",
    },
    aiPrediction,
    imageUrl: "",
    ogImageUrl: "",
    imageType: "svg-fallback",
    createdAt: new Date().toISOString(),
  };
};

/** ML予測のみでフォールバック用の簡易 RacePrediction を生成 */
export const createFallbackPrediction = (data: MergedRaceData): RacePrediction => {
  const { program, estimate } = data;
  const technique: WinningTechnique =
    (estimate?.predictedTechnique ? toWinningTechnique(estimate.predictedTechnique) : undefined) ??
    "nige";

  return {
    raceCode: program.raceCode,
    raceDate: program.raceDate,
    stadium: program.stadium,
    raceNumber: program.raceNumber,
    boats: program.boats,
    mlPrediction: {
      first: estimate?.predicted1st ?? 0,
      second: estimate?.predicted2nd ?? 0,
      third: estimate?.predicted3rd ?? 0,
      technique: estimate?.predictedTechnique ?? "",
    },
    aiPrediction: {
      startFormation: {
        entries: program.boats.map((boat, idx) => ({
          boatNumber: boat.boatNumber,
          courseNumber: estimate?.boats[idx]?.predictedCourse ?? boat.boatNumber,
          predictedST: estimate?.boats[idx]?.predictedST ?? 0,
        })),
        pattern: "flat",
      },
      firstTurnScenario: "ML予測のみ（AI分析は利用不可）",
      predictedTechnique: technique,
      predictedOrder: [
        estimate?.predicted1st ?? 1,
        estimate?.predicted2nd ?? 2,
        estimate?.predicted3rd ?? 3,
      ],
      confidence: 0.3,
      narrative: "AI分析が利用できなかったため、ML予測結果のみを表示しています。",
      suggestedBets: [],
    },
    imageUrl: "",
    ogImageUrl: "",
    imageType: "svg-fallback",
    createdAt: new Date().toISOString(),
  };
};
