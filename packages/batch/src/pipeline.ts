import { toJSTDateString } from "@fun-site/shared";
import { fetchAllCsvData, mergeRaceData } from "./fetcher/index.js";
import { generateAndUploadImages } from "./image-generator/index.js";
import { analyzePredictions } from "./predictor/index.js";
import { buildAndDeploy } from "./site-builder/index.js";

/** パイプライン全体のオーケストレーション */
export const runPipeline = async (): Promise<void> => {
  const today = toJSTDateString(new Date());
  console.info(`Pipeline started for ${today}`);

  // Step 1: CSV データ取得
  console.info("Step 1: Fetching CSV data...");
  const csvData = await fetchAllCsvData(today);
  console.info(
    `Fetched: ${csvData.programs.length} programs, ${csvData.estimates.length} estimates`,
  );

  if (csvData.programs.length === 0) {
    console.warn("No programs found. Skipping pipeline.");
    return;
  }

  // Step 2: データ結合
  const mergedData = mergeRaceData(csvData);
  console.info(`Merged ${mergedData.length} races`);

  // Step 3: 予想分析（Gemini 3 Pro）
  console.info("Step 3: Analyzing predictions...");
  const predictions = await analyzePredictions(mergedData);
  console.info(`Generated ${predictions.length} predictions`);

  // Step 4: 画像生成 + 品質チェック
  console.info("Step 4: Generating images...");
  const predictionsWithImages = await generateAndUploadImages(predictions);
  console.info("Image generation completed");

  // Step 5: サイトビルド + デプロイ
  console.info("Step 5: Building and deploying...");
  await buildAndDeploy(predictionsWithImages, csvData.confirmations);
  console.info("Pipeline completed successfully");
};
