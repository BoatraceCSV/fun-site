import { activePredictors } from "@fun-site/shared";
import { Storage } from "@google-cloud/storage";
import type { CsvType } from "./fetcher/csv-client.js";

/**
 * CSV 種別 + 予想者別 index の generation トラッキングキー。
 * 予想者別 index は `index:{predictor_id}` の形でキー化する
 * (boatrace.gcs_publisher の csv_type 命名と揃える)。
 */
export type CsvGenerationKey = CsvType | `index:${string}`;

/**
 * 直近のビルドメタデータ。
 * `gs://${WEB_BUCKET}/_meta/last-build.json` に保存し、
 * 次回ビルド時に CSV の generation を比較して早期 return の判定に使う。
 */
export type BuildState = {
  readonly lastBuildAt: string;
  readonly raceDate: string;
  /**
   * ビルド時に参照した GCS object の generation（unix ms）。CSV 種別 → generation 文字列。
   * 予想者別 index は `index:{predictor_id}` キー (例: `index:v1_basic`)。
   */
  readonly csvGenerations: Partial<Record<CsvGenerationKey, string>>;
};

const META_OBJECT_NAME = "_meta/last-build.json";

const WEB_BUCKET = process.env["GCS_WEB_BUCKET"] ?? "fun-site-web-boatrace-487212";

let storage: Storage | undefined;
const getStorage = (): Storage => {
  if (!storage) storage = new Storage();
  return storage;
};

/** last-build.json を読み込む。未存在/破損時は undefined */
export const loadBuildState = async (): Promise<BuildState | undefined> => {
  const file = getStorage().bucket(WEB_BUCKET).file(META_OBJECT_NAME);
  try {
    const [buffer] = await file.download();
    const parsed = JSON.parse(buffer.toString("utf-8")) as BuildState;
    return parsed;
  } catch (error) {
    const code = (error as { code?: number } | undefined)?.code;
    if (code === 404) return undefined;
    console.warn(
      `Failed to load build state: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
};

/** last-build.json を書き出す */
export const saveBuildState = async (state: BuildState): Promise<void> => {
  const file = getStorage().bucket(WEB_BUCKET).file(META_OBJECT_NAME);
  await file.save(JSON.stringify(state, null, 2), {
    contentType: "application/json; charset=utf-8",
    metadata: { cacheControl: "no-store" },
  });
};

/**
 * preview-realtime が書き込んだ CSV の現在の generation を取得する。
 * `CSV_SOURCE=gcs` 経路と同じバケット/パス構造を見る前提。
 */
const CSV_GCS_BUCKET = process.env["CSV_GCS_BUCKET"] ?? "boatrace-realtime-data";
const CSV_GCS_PATH_ROOT = process.env["CSV_GCS_PATH_ROOT"] ?? "data";

const CSV_PATH_PREFIX: Record<CsvType, string> = {
  title: "programs/title",
  race_cards: "programs/race_cards",
  stt: "previews/stt",
  tkz: "previews/tkz",
  sui: "previews/sui",
  results: "results/realtime",
  payouts: "results/payouts",
};

const buildCsvObjectName = (relativePath: string, date: string): string => {
  const dateSlash = date.replaceAll("-", "/");
  return `${CSV_GCS_PATH_ROOT}/${relativePath}/${dateSlash}.csv`;
};

/**
 * 監視対象のキーリスト (固定 CSV + active 予想者ごとの index)。
 * boatrace.gcs_publisher と同じ csv_type 命名 (`index:{predictor_id}`) を採用。
 */
const buildTrackedKeys = (): {
  key: CsvGenerationKey;
  relativePath: string;
}[] => {
  const keys: { key: CsvGenerationKey; relativePath: string }[] = (
    ["title", "race_cards", "stt", "tkz", "sui", "results", "payouts"] as const
  ).map((type) => ({ key: type, relativePath: CSV_PATH_PREFIX[type] }));
  for (const p of activePredictors()) {
    keys.push({
      key: `index:${p.id}` as const,
      relativePath: `estimate/${p.id}`,
    });
  }
  return keys;
};

/** 当日 CSV 群の generation を一括取得（不在は undefined） */
export const fetchCurrentCsvGenerations = async (
  date: string,
): Promise<Partial<Record<CsvGenerationKey, string>>> => {
  const tracked = buildTrackedKeys();
  const bucket = getStorage().bucket(CSV_GCS_BUCKET);

  const entries = await Promise.all(
    tracked.map(async ({ key, relativePath }): Promise<[CsvGenerationKey, string | undefined]> => {
      const file = bucket.file(buildCsvObjectName(relativePath, date));
      try {
        const [metadata] = await file.getMetadata();
        return [key, String(metadata.generation ?? "")];
      } catch (error) {
        const code = (error as { code?: number } | undefined)?.code;
        if (code === 404) return [key, undefined];
        console.warn(
          `Failed to stat ${key} CSV: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [key, undefined];
      }
    }),
  );

  const result: Partial<Record<CsvGenerationKey, string>> = {};
  for (const [key, gen] of entries) {
    if (gen) result[key] = gen;
  }
  return result;
};

/**
 * 前回ビルド時と同じ generation かを判定する。
 * 同一 raceDate かつ全 CSV の generation が一致 → true (=早期 return 可能)
 */
export const isUpToDate = (
  date: string,
  current: Partial<Record<CsvGenerationKey, string>>,
  previous: BuildState | undefined,
): boolean => {
  if (!previous) return false;
  if (previous.raceDate !== date) return false;
  for (const { key } of buildTrackedKeys()) {
    const cur = current[key];
    const prev = previous.csvGenerations[key];
    // どちらも未存在ならスキップせず（初回ビルド余地を残す）
    if (cur === undefined && prev === undefined) continue;
    if (cur !== prev) return false;
  }
  return true;
};
