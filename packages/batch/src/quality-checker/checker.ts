import type { RacePrediction } from "@fun-site/shared";
import { z } from "zod";
import { MODEL_ID, ai } from "../lib/vertex-ai.js";
import { QUALITY_CRITERIA, QUALITY_THRESHOLD } from "./criteria.js";
import type { QualityCheckResult } from "./criteria.js";

const qualityResultSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  issues: z.array(z.string()),
  retry_instruction: z.string(),
});

const buildQualityCheckPrompt = (prediction: RacePrediction): string => {
  const criteriaList = QUALITY_CRITERIA.map((c, i) => `${i + 1}. ${c}`).join("\n");

  return `あなたはボートレース展開予想図の品質検査官です。
以下の画像が品質基準を満たしているか検証してください。

## 品質基準
${criteriaList}

## 合格基準
- スコア ${QUALITY_THRESHOLD} 以上で合格

## 展開予想テキスト（参照用）
- 会場: ${prediction.stadium}
- レース: ${prediction.raceNumber}R
- 予想着順: ${prediction.aiPrediction.predictedOrder.join("-")}
- 予想決まり手: ${prediction.aiPrediction.predictedTechnique}

## 出力形式（JSON）
{
  "passed": true/false,
  "score": 0-100,
  "issues": ["問題点1", "問題点2"],
  "retry_instruction": "修正指示（不合格時のみ、合格時は空文字列）"
}`;
};

/** Gemini 3 Pro マルチモーダルで画像品質をチェック */
export const checkImageQuality = async (
  prediction: RacePrediction,
  imageData: Buffer,
): Promise<QualityCheckResult> => {
  const prompt = buildQualityCheckPrompt(prediction);

  try {
    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents: [
        { text: prompt },
        {
          inlineData: {
            mimeType: "image/png",
            data: imageData.toString("base64"),
          },
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    });

    const text = response.text;
    if (!text) {
      return { passed: false, score: 0, issues: ["品質チェック応答が空"], retryInstruction: "" };
    }

    const parsed = qualityResultSchema.parse(JSON.parse(text));
    return {
      passed: parsed.score >= QUALITY_THRESHOLD,
      score: parsed.score,
      issues: parsed.issues,
      retryInstruction: parsed.retry_instruction,
    };
  } catch (error) {
    console.warn(`Quality check error: ${error instanceof Error ? error.message : error}`);
    return {
      passed: false,
      score: 0,
      issues: [`品質チェックエラー: ${error instanceof Error ? error.message : "unknown"}`],
      retryInstruction: "",
    };
  }
};
