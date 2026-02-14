import { toWinningTechnique } from "@fun-site/shared";
import type { AiPrediction, RacePrediction, WinningTechnique } from "@fun-site/shared";
import { z } from "zod";
import type { MergedRaceData } from "../fetcher/index.js";
import { generateText } from "./gemini-client.js";
import { buildAnalysisPrompt } from "./prompt-builder.js";

const TARGET_RACE_NUMBER = 12;
const MAX_TARGET_RACES = 3;

type RaceGrade = "SG" | "GI" | "GII" | "GIII" | "GENERAL";

const GRADE_PRIORITY: Record<RaceGrade, number> = {
  SG: 0,
  GI: 1,
  GII: 2,
  GIII: 3,
  GENERAL: 4,
};

/** titleからレースグレードを判定 */
export const detectGrade = (title: string): RaceGrade => {
  if (/ＳＧ|SG/.test(title)) return "SG";
  // GIII / ＧＩＩＩを先にチェック（GI, GII の誤マッチ防止）
  if (/ＧＩＩＩ|ＧⅢ|Ｇ３|GIII|G3/.test(title)) return "GIII";
  if (/ＧＩＩ|ＧⅡ|Ｇ２|GII|G2/.test(title)) return "GII";
  if (/ＧＩ|ＧⅠ|Ｇ１|GI|G1/.test(title)) return "GI";
  return "GENERAL";
};

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

/** 対象レースを選定（各場12R → グレード優先で最大3件） */
export const selectTargetRaces = (
  mergedData: readonly MergedRaceData[],
): readonly MergedRaceData[] => {
  const race12 = mergedData.filter((data) => data.program.raceNumber === TARGET_RACE_NUMBER);
  const sorted = [...race12].sort(
    (a, b) =>
      GRADE_PRIORITY[detectGrade(a.program.title)] - GRADE_PRIORITY[detectGrade(b.program.title)],
  );
  return sorted.slice(0, MAX_TARGET_RACES);
};

/** レスポンス文字列からJSON部分を抽出 */
const extractJson = (text: string): string => {
  // ```json ... ``` で囲まれている場合を処理
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }
  // 最初の { から最後の } までを抽出
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }
  return text;
};

/** Gemini 3 Pro の JSON 応答を AiPrediction 型に変換 */
const parseAiResponse = (responseText: string): AiPrediction => {
  const jsonStr = extractJson(responseText);
  return aiPredictionSchema.parse(JSON.parse(jsonStr));
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
