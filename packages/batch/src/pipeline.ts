import { toJSTDateString } from "@fun-site/shared";
import { buildPredictorBreakdown } from "./aggregator/predictor-breakdown.js";
import { buildPredictorStats, datesForActivePredictors } from "./aggregator/predictor-stats.js";
import {
  fetchCurrentCsvGenerations,
  isUpToDate,
  loadBuildState,
  saveBuildState,
} from "./build-state.js";
import { parseTriggerEvent } from "./event-parser.js";
import { fetchAllCsvData } from "./fetcher/index.js";
import { buildAllRacePredictions, buildAndDeploy } from "./site-builder/index.js";

/**
 * パイプライン全体のオーケストレーション。
 *
 * 0. 起動契機の判定（Pub/Sub event があれば updatedRaces で早期 return / generation 比較）
 * 1. BoatraceCSV から title / race_cards / stt / index を取得
 * 2. レース単位の RacePrediction を生成
 * 3. JSON に書き出し → Astro ビルド → デプロイ
 * 4. last-build.json を GCS に保存
 *
 * stt は直前情報。preview-realtime 経由で 5 分毎に更新される CSV を読み込むため、
 * 当日 08:00 以降は順次 stt が埋まり、進入コースとスタート展示が反映されていく。
 * stt が未公開のレースは枠番をフォールバックとして表示する。
 */
export const runPipeline = async (): Promise<void> => {
  const event = parseTriggerEvent();

  // event があれば raceDate を採用、無ければ当日 JST
  const raceDate = event.kind === "pubsub" ? event.message.raceDate : toJSTDateString(new Date());

  console.info(
    `Pipeline started for ${raceDate} (trigger=${
      event.kind === "pubsub" ? (event.message.trigger ?? "pubsub") : "manual"
    })`,
  );

  // Step 0a: Pub/Sub event の updatedRaces が空ならスキップ（preview-realtime が空回りした回）
  if (event.kind === "pubsub" && event.message.updatedRaces.length === 0) {
    console.info("Skipping build: updatedRaces is empty");
    return;
  }

  // Step 0b: GCS の CSV generation を確認し、前回ビルドから変化が無ければスキップ。
  //          early-return 用のショートカット。CSV_SOURCE=gcs の前提で動く。
  if (process.env["CSV_SOURCE"] === "gcs" && process.env["FORCE_REBUILD"] !== "1") {
    try {
      const [previous, current] = await Promise.all([
        loadBuildState(),
        fetchCurrentCsvGenerations(raceDate),
      ]);
      if (isUpToDate(raceDate, current, previous)) {
        console.info(
          `Skipping build: CSV generations unchanged since last build at ${previous?.lastBuildAt}`,
        );
        return;
      }
    } catch (error) {
      console.warn(
        `Build state check failed (continuing with full build): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Step 1: CSV データ取得
  console.info("Step 1: Fetching CSV data...");
  const csvData = await fetchAllCsvData(raceDate);
  const indexSummary = csvData.indexesByPredictor
    .map((p) => `${p.predictor.id}=${p.rows.length}`)
    .join(",");
  console.info(
    `Fetched: ${csvData.titles.length} titles, ${csvData.raceCards.length} race_cards, ${csvData.stt.length} stt, ${csvData.tkz.length} tkz, ${csvData.sui.length} sui, ${csvData.originalExhibition.length} orig_exhibition, ${csvData.recentNational.length} recent_national, ${csvData.recentLocal.length} recent_local, ${csvData.motorStats.length} motor_stats, ${csvData.racerSt.length} racer_st, index[${indexSummary}], ${csvData.results.length} results, ${csvData.payouts.length} payouts`,
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
    csvData.racerSt,
    csvData.tkz,
    csvData.sui,
    csvData.originalExhibition,
    csvData.recentNational,
    csvData.recentLocal,
    csvData.motorStats,
    csvData.indexesByPredictor,
    csvData.titles,
    csvData.results,
    csvData.payouts,
    generatedAt,
  );
  console.info(`Built ${predictions.length} predictions`);

  // Step 2.5: 予想者統計集計 (active 予想者の startedAt 〜 当日)。
  // 書き出し先は packages/web/src/data/predictors/stats.json で、Astro が
  // /predictors ページを描画する際に読み込む。失敗は非致命 (集計データ無しで
  // /predictors が空状態になるだけ)。
  try {
    const dates = datesForActivePredictors(raceDate);
    console.info(`Step 2.5: Aggregating predictor stats over ${dates.length} day(s)...`);
    await buildPredictorStats(dates);
  } catch (error) {
    console.warn(
      `Failed to build predictor stats (non-fatal): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Step 2.6: 統計ページ用の分析軸別集計 (直前のみ・7 軸)。書き出し先は
  // packages/web/src/data/predictors/breakdown.json で、Astro が /stats ページを
  // 描画する際に読み込む。失敗は非致命 (集計データ無しで /stats が空状態になるだけ)。
  try {
    const dates = datesForActivePredictors(raceDate);
    console.info(`Step 2.6: Aggregating predictor breakdown over ${dates.length} day(s)...`);
    await buildPredictorBreakdown(dates);
  } catch (error) {
    console.warn(
      `Failed to build predictor breakdown (non-fatal): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Step 3: 書き出し → Astro ビルド → デプロイ
  console.info("Step 3: Writing data, building and deploying...");
  await buildAndDeploy(predictions, raceDate);

  // Step 4: last-build.json を GCS に保存（次回ビルド時の早期 return 比較用）
  if (process.env["CSV_SOURCE"] === "gcs") {
    try {
      const generations = await fetchCurrentCsvGenerations(raceDate);
      await saveBuildState({
        lastBuildAt: new Date().toISOString(),
        raceDate,
        csvGenerations: generations,
      });
    } catch (error) {
      console.warn(
        `Failed to save build state (non-fatal): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  console.info("Pipeline completed successfully");
};
