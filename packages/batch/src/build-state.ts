import { Storage } from "@google-cloud/storage";
import type { CsvType } from "./fetcher/csv-client.js";

/**
 * 直近のビルドメタデータ。
 * `gs://${WEB_BUCKET}/_meta/last-build.json` に保存し、
 * 次回ビルド時に CSV の generation を比較して早期 return の判定に使う。
 */
export type BuildState = {
  readonly lastBuildAt: string;
  readonly raceDate: string;
  /** ビルド時に参照した GCS object の generation（unix ms）。CSV 種別 → generation 文字列 */
  readonly csvGenerations: Partial<Record<CsvType, string>>;
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
  // boatracecsv.github.io リポジトリの実体パスに合わせて `data/estimate/index/...` を使う。
  index: "estimate/index",
  results: "results/realtime",
};

const buildCsvObjectName = (type: CsvType, date: string): string => {
  const dateSlash = date.replaceAll("-", "/");
  return `${CSV_GCS_PATH_ROOT}/${CSV_PATH_PREFIX[type]}/${dateSlash}.csv`;
};

/** 当日 CSV 群の generation を一括取得（不在は undefined） */
export const fetchCurrentCsvGenerations = async (
  date: string,
): Promise<Partial<Record<CsvType, string>>> => {
  const types: CsvType[] = ["title", "race_cards", "stt", "index", "results"];
  const bucket = getStorage().bucket(CSV_GCS_BUCKET);

  const entries = await Promise.all(
    types.map(async (type): Promise<[CsvType, string | undefined]> => {
      const file = bucket.file(buildCsvObjectName(type, date));
      try {
        const [metadata] = await file.getMetadata();
        return [type, String(metadata.generation ?? "")];
      } catch (error) {
        const code = (error as { code?: number } | undefined)?.code;
        if (code === 404) return [type, undefined];
        console.warn(
          `Failed to stat ${type} CSV: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [type, undefined];
      }
    }),
  );

  const result: Partial<Record<CsvType, string>> = {};
  for (const [type, gen] of entries) {
    if (gen) result[type] = gen;
  }
  return result;
};

/**
 * 前回ビルド時と同じ generation かを判定する。
 * 同一 raceDate かつ全 CSV の generation が一致 → true (=早期 return 可能)
 */
export const isUpToDate = (
  date: string,
  current: Partial<Record<CsvType, string>>,
  previous: BuildState | undefined,
): boolean => {
  if (!previous) return false;
  if (previous.raceDate !== date) return false;
  const types: CsvType[] = ["title", "race_cards", "stt", "index", "results"];
  for (const type of types) {
    const cur = current[type];
    const prev = previous.csvGenerations[type];
    // どちらも未存在ならスキップせず（初回ビルド余地を残す）
    if (cur === undefined && prev === undefined) continue;
    if (cur !== prev) return false;
  }
  return true;
};
