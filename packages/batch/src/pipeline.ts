import { toJSTDateString } from "@fun-site/shared";
import { fetchAllCsvData } from "./fetcher/index.js";
import { buildAllRacePredictions, buildAndDeploy } from "./site-builder/index.js";

/**
 * パイプライン全体のオーケストレーション。
 *
 * 1. BoatraceCSV から title / race_cards / stt / index / results を取得
 * 2. レース単位の RacePrediction を生成
 * 3. JSON に書き出し → Astro ビルド → デプロイ
 *
 * stt は直前情報。AM 2:00 のバッチ時点では未取得のレースが多いため、
 * 進入コースは枠番フォールバック、ST は race_cards の全国平均ST で表示する。
 */
export const runPipeline = async (): Promise<void> => {
  const today = toJSTDateString(new Date());
  console.info(`Pipeline started for ${today}`);

  // Step 1: CSV データ取得
  console.info("Step 1: Fetching CSV data...");
  const csvData = await fetchAllCsvData(today);
  console.info(
    `Fetched: ${csvData.titles.length} titles, ${csvData.raceCards.length} race_cards, ${csvData.stt.length} stt, ${csvData.indexes.length} index, ${csvData.results.length} results`,
  );

  if (csvData.raceCards.length === 0) {
    console.warn("No race_cards found. Skipping pipeline.");
    return;
  }

  // Step 2: RacePrediction の組み立て
  console.info("Step 2: Building race predictions...");
  const generatedAt = new Date().toISOString();
  const predictions = buildAllRacePredictions(
    csvData.raceCards,
    csvData.stt,
    csvData.indexes,
    csvData.titles,
    generatedAt,
  );
  console.info(`Built ${predictions.length} predictions`);

  // Step 3: 書き出し → Astro ビルド → デプロイ
  console.info("Step 3: Writing data, building and deploying...");
  await buildAndDeploy(predictions);
  console.info("Pipeline completed successfully");
};
