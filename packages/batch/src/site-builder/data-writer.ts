import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RacePrediction } from "@fun-site/shared";
import { parseRaceCode } from "@fun-site/shared";
import { type File, Storage } from "@google-cloud/storage";

const WEB_PACKAGE_DIR = resolve(import.meta.dirname, "../../../web");
const RACES_DIR = resolve(WEB_PACKAGE_DIR, "src/data/races");

/**
 * 予想 JSON を保管する GCS データバケット。
 *
 * 過去日の予想を後から参照するため (節集計の incremental キャッシュ生成等)、
 * `last-build.json` と同じ `GCS_DATA_BUCKET` の `predictions/{date}/{raceCode}.json`
 * に書き出す。Web バケット (`GCS_WEB_BUCKET`) ではなく Data バケットを使うのは、
 * Astro ビルド成果物には含まれない (= ユーザに公開しない) 内部データだから。
 */
const DATA_BUCKET = process.env["GCS_DATA_BUCKET"] ?? "fun-site-data-boatrace-487212";

/** GCS 上での予想 JSON の object name */
const buildPredictionObjectName = (date: string, raceCode: string): string =>
  `predictions/${date}/${raceCode}.json`;

let storage: Storage | undefined;
const getStorage = (): Storage => {
  if (!storage) storage = new Storage();
  return storage;
};

/**
 * 予想データをローカル (`packages/web/src/data/races/{date}/`) に JSON で書き出す。
 *
 * Astro ビルドが直接読む位置。
 */
export const writePredictionData = async (
  predictions: readonly RacePrediction[],
): Promise<void> => {
  for (const prediction of predictions) {
    const parsed = parseRaceCode(prediction.raceCode);
    const filePath = resolve(RACES_DIR, parsed.date, `${prediction.raceCode}.json`);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(prediction, null, 2), "utf-8");
  }
  console.info(`Wrote ${predictions.length} prediction JSON files`);
};

/**
 * 予想データを GCS Data バケットへも保存する。
 *
 * 失敗してもパイプライン全体は止めず (非致命)、警告ログのみ。
 * 次回ビルド時の節集計が「過去日の JSON がキャッシュされていない」状態に
 * 縮退するだけで、当日サイトのレンダリングには影響しない。
 *
 * パス: `gs://${GCS_DATA_BUCKET}/predictions/{YYYY-MM-DD}/{raceCode}.json`
 */
export const savePredictionDataToGcs = async (
  predictions: readonly RacePrediction[],
): Promise<void> => {
  if (predictions.length === 0) return;
  const bucket = getStorage().bucket(DATA_BUCKET);

  // 並列度を抑えめにして GCS API のレート制限を避ける。
  const CONCURRENCY = 16;
  let cursor = 0;
  let failed = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, predictions.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= predictions.length) return;
      const prediction = predictions[i];
      if (!prediction) return;
      const parsed = parseRaceCode(prediction.raceCode);
      const objectName = buildPredictionObjectName(parsed.date, prediction.raceCode);
      try {
        await bucket.file(objectName).save(JSON.stringify(prediction, null, 2), {
          contentType: "application/json; charset=utf-8",
          metadata: { cacheControl: "no-store" },
        });
      } catch (error) {
        failed += 1;
        console.warn(
          `Failed to upload prediction to gs://${DATA_BUCKET}/${objectName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  });
  await Promise.all(workers);
  console.info(
    `Uploaded ${predictions.length - failed} prediction JSON files to gs://${DATA_BUCKET}/ (${failed} failed)`,
  );
};

/**
 * 過去日の予想 JSON を GCS Data バケットから取得する。
 *
 * 節集計のため、節候補の各日 × 24 会場 × 12 レースを引きに行く。
 * 取得失敗 (404 含む) は静かに空配列扱いとし、節集計は「キャッシュ未ヒット」
 * として扱う (後続フローで埋まる)。
 *
 * 戻り値は `RacePrediction[]`。各 JSON のパースに失敗したものは除外する。
 */
export const fetchHistoricalPredictions = async (date: string): Promise<RacePrediction[]> => {
  const bucket = getStorage().bucket(DATA_BUCKET);
  let files: File[];
  try {
    const [listed] = await bucket.getFiles({ prefix: `predictions/${date}/` });
    files = listed;
  } catch (error) {
    console.warn(
      `Failed to list predictions for ${date}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }

  if (files.length === 0) return [];

  const CONCURRENCY = 16;
  let cursor = 0;
  const results: RacePrediction[] = [];
  const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= files.length) return;
      const file = files[i];
      if (!file) return;
      try {
        const [buffer] = await file.download();
        const parsed = JSON.parse(buffer.toString("utf-8")) as RacePrediction;
        results.push(parsed);
      } catch (error) {
        console.warn(
          `Failed to download/parse ${file.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  });
  await Promise.all(workers);
  return results;
};
