import { createHash } from "node:crypto";
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
export const buildPredictionObjectName = (date: string, raceCode: string): string =>
  `predictions/${date}/${raceCode}.json`;

/**
 * 差分アップロード判定用の内容ハッシュを載せるカスタムメタデータのキー。
 *
 * `generatedAt` はビルドごとに必ず変わるので、オブジェクト本体の md5 では
 * 「内容が同じ」を判定できない。`generatedAt` を除いた JSON のハッシュを
 * オブジェクトのカスタムメタデータに持たせ、次回ビルドはそれと比較する。
 */
export const CONTENT_HASH_METADATA_KEY = "predictionContentHash";

/** `generatedAt` を除いた `RacePrediction` の内容ハッシュ (sha256 hex)。 */
export const predictionContentHash = (prediction: RacePrediction): string => {
  const { generatedAt: _generatedAt, ...content } = prediction;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
};

export type PredictionUploadPlan = {
  /** アップロードが必要な予想と、そのオブジェクト名・内容ハッシュ */
  readonly toUpload: readonly {
    readonly prediction: RacePrediction;
    readonly objectName: string;
    readonly contentHash: string;
  }[];
  /** 内容ハッシュが一致してスキップした件数 */
  readonly unchanged: number;
};

/**
 * GCS 上の既存オブジェクトの内容ハッシュ (`objectName` → hash) と突き合わせ、
 * 内容が変わった予想だけをアップロード対象にする (pure)。
 *
 * `remoteHashes` に無い (= 未アップロード、またはハッシュ無しの旧オブジェクト、
 * または一覧取得に失敗した日) はアップロード対象になる。
 */
export const planPredictionUploads = (
  predictions: readonly RacePrediction[],
  remoteHashes: ReadonlyMap<string, string | undefined>,
): PredictionUploadPlan => {
  const toUpload: PredictionUploadPlan["toUpload"][number][] = [];
  let unchanged = 0;
  for (const prediction of predictions) {
    const parsed = parseRaceCode(prediction.raceCode);
    const objectName = buildPredictionObjectName(parsed.date, prediction.raceCode);
    const contentHash = predictionContentHash(prediction);
    if (remoteHashes.get(objectName) === contentHash) {
      unchanged += 1;
      continue;
    }
    toUpload.push({ prediction, objectName, contentHash });
  }
  return { toUpload, unchanged };
};

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
 *
 * 差分アップロード: 日付ごとに 1 回だけ `predictions/{date}/` を一覧して既存
 * オブジェクトのカスタムメタデータ (`CONTENT_HASH_METADATA_KEY`) を読み、
 * `generatedAt` を除いた内容ハッシュが一致するレースは書かない。2 分サイクルの
 * ビルドで実際に変わるのは数レースなので、Class A 操作 (書込) を全件分から
 * 差分分に減らせる。一覧取得に失敗した日は安全側に倒して全件アップロードする。
 */
export const savePredictionDataToGcs = async (
  predictions: readonly RacePrediction[],
): Promise<void> => {
  if (predictions.length === 0) return;
  const bucket = getStorage().bucket(DATA_BUCKET);

  const dates = [...new Set(predictions.map((p) => parseRaceCode(p.raceCode).date))];
  const remoteHashes = new Map<string, string | undefined>();
  for (const date of dates) {
    try {
      const [files] = await bucket.getFiles({ prefix: `predictions/${date}/` });
      for (const file of files) {
        const hash = file.metadata.metadata?.[CONTENT_HASH_METADATA_KEY];
        remoteHashes.set(file.name, typeof hash === "string" ? hash : undefined);
      }
    } catch (error) {
      console.warn(
        `Failed to list existing predictions for ${date} (uploading all): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const { toUpload, unchanged } = planPredictionUploads(predictions, remoteHashes);

  // 並列度を抑えめにして GCS API のレート制限を避ける。
  const CONCURRENCY = 16;
  let cursor = 0;
  let failed = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, toUpload.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= toUpload.length) return;
      const entry = toUpload[i];
      if (!entry) return;
      try {
        await bucket.file(entry.objectName).save(JSON.stringify(entry.prediction, null, 2), {
          contentType: "application/json; charset=utf-8",
          metadata: {
            cacheControl: "no-store",
            metadata: { [CONTENT_HASH_METADATA_KEY]: entry.contentHash },
          },
        });
      } catch (error) {
        failed += 1;
        console.warn(
          `Failed to upload prediction to gs://${DATA_BUCKET}/${entry.objectName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  });
  await Promise.all(workers);
  console.info(
    `Uploaded ${toUpload.length - failed} changed prediction JSON files to gs://${DATA_BUCKET}/ (skipped ${unchanged} unchanged, ${failed} failed)`,
  );
};

/**
 * 過去日の予想 JSON を GCS Data バケットから 1 件ずつ読み、`project` で変換した
 * 結果だけを集めて返す。
 *
 * パース済みの `RacePrediction` は `project` に渡した直後に捨てるので、
 * 1 日ぶんの全レースを同時にメモリへ載せない。集計器が使う数項目だけを
 * 抜く用途 (`aggregator/prediction-digest.ts`) はこちらを使う。
 *
 * 取得失敗 (404 含む) は静かに空配列扱いとし、各 JSON のパースに失敗したものは除外する。
 */
export const mapHistoricalPredictions = async <T>(
  date: string,
  project: (prediction: RacePrediction) => T,
): Promise<T[]> => {
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
  const results: T[] = [];
  const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= files.length) return;
      const file = files[i];
      if (!file) return;
      try {
        const [buffer] = await file.download();
        const parsed = JSON.parse(buffer.toString("utf-8")) as RacePrediction;
        results.push(project(parsed));
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

/**
 * 過去日の予想 JSON を GCS Data バケットから取得する。
 *
 * 節集計のため、節候補の各日 × 24 会場 × 12 レースを引きに行く。
 * 取得失敗 (404 含む) は静かに空配列扱いとし、節集計は「キャッシュ未ヒット」
 * として扱う (後続フローで埋まる)。
 *
 * 戻り値は `RacePrediction[]`。各 JSON のパースに失敗したものは除外する。
 * 1 日ぶんの `RacePrediction` を丸ごと保持するので、数か月分を読む用途には
 * `mapHistoricalPredictions` で射影しながら読むこと。
 */
export const fetchHistoricalPredictions = (date: string): Promise<RacePrediction[]> =>
  mapHistoricalPredictions(date, (prediction) => prediction);
