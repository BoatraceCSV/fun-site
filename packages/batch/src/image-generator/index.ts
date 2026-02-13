import type { RacePrediction } from "@fun-site/shared";
import pMap from "p-map";
import { MAX_RETRY_COUNT, checkImageQuality } from "../quality-checker/index.js";
import { generateImage } from "./gemini-image.js";
import { buildImagePrompt } from "./prompt-builder.js";
import { buildImageUrl, uploadImage } from "./storage.js";
import { generateSvg } from "./svg-generator.js";

const CONCURRENCY = 3;

const FALLBACK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect fill="#1a2980" width="800" height="450"/><text x="400" y="225" text-anchor="middle" fill="white" font-size="24">画像生成に失敗しました</text></svg>';

/** 1レース分の画像を生成し、品質チェック + リトライ */
const generateWithQualityCheck = async (
  prediction: RacePrediction,
): Promise<Buffer | undefined> => {
  const imagePrompt = buildImagePrompt(prediction);

  for (let attempt = 0; attempt <= MAX_RETRY_COUNT; attempt++) {
    try {
      const imageData = await generateImage(imagePrompt);
      const quality = await checkImageQuality(prediction, imageData);

      if (quality.passed) {
        if (attempt > 0) {
          console.info(
            `Quality check passed on retry ${attempt}: ${prediction.stadium} ${prediction.raceNumber}R (score: ${quality.score})`,
          );
        }
        return imageData;
      }

      console.warn(
        `Quality check failed (attempt ${attempt + 1}/${MAX_RETRY_COUNT + 1}): ${prediction.stadium} ${prediction.raceNumber}R - score: ${quality.score}, issues: ${quality.issues.join(", ")}`,
      );
    } catch (error) {
      console.warn(
        `Image generation attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return undefined;
};

/** 全予想レースの画像を生成してアップロード */
export const generateAndUploadImages = async (
  predictions: readonly RacePrediction[],
): Promise<readonly RacePrediction[]> => {
  const results = await pMap(
    predictions,
    async (prediction) => {
      try {
        // SVG フォールバックと画像生成を並列実行
        const [svgResult, imageData] = await Promise.allSettled([
          generateSvg(prediction),
          generateWithQualityCheck(prediction),
        ]);

        const svgData = svgResult.status === "fulfilled" ? svgResult.value : FALLBACK_SVG;

        const svgUrl = await uploadImage(
          prediction.raceCode,
          "prediction.svg",
          svgData,
          "image/svg+xml",
        );

        let imageUrl = svgUrl;
        let imageType: "generated" | "svg-fallback" = "svg-fallback";

        const resolvedImageData = imageData.status === "fulfilled" ? imageData.value : undefined;

        if (resolvedImageData) {
          imageUrl = await uploadImage(
            prediction.raceCode,
            "prediction.png",
            resolvedImageData,
            "image/png",
          );
          imageType = "generated";
        }

        // OG 画像は生成画像と同一なので URL だけ構築（二重アップロード回避）
        const ogImageUrl = resolvedImageData
          ? buildImageUrl(prediction.raceCode, "prediction.png")
          : svgUrl;

        console.info(
          `Images uploaded: ${prediction.stadium} ${prediction.raceNumber}R (${imageType})`,
        );

        return { ...prediction, imageUrl, ogImageUrl, imageType } satisfies RacePrediction;
      } catch (error) {
        console.warn(
          `Image generation failed for ${prediction.stadium} ${prediction.raceNumber}R: ${error instanceof Error ? error.message : error}`,
        );
        return prediction;
      }
    },
    { concurrency: CONCURRENCY },
  );

  return results;
};

export { generateImage } from "./gemini-image.js";
export { buildImagePrompt, buildSvgPrompt } from "./prompt-builder.js";
export { buildImageUrl, uploadImage } from "./storage.js";
export { generateSvg } from "./svg-generator.js";
