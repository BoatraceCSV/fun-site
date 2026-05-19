import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Storage } from "@google-cloud/storage";

/**
 * 過去日付インデックス。
 *
 * `gs://${GCS_WEB_BUCKET}/_meta/dates.json` に保存し、
 * フロントエンドの /archive/ インデックスページ・archive/[date] の
 * 「他の日付」セクションでの過去日リスト表示に使う。
 *
 * 形式:
 *
 * ```json
 * { "dates": ["2024-01-01", "2024-01-02", ...] }
 * ```
 *
 * 配置先は `last-build.json` と同じ Web バケット `_meta/` プレフィックス。
 * deploy.ts の削除フィルタが `_meta/` を除外するため、毎ビルドで消えない。
 */
export type DatesIndex = {
  readonly dates: readonly string[];
};

const META_OBJECT_NAME = "_meta/dates.json";

const WEB_BUCKET = process.env["GCS_WEB_BUCKET"] ?? "fun-site-web-boatrace-487212";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const WEB_PACKAGE_DIR = resolve(import.meta.dirname, "../../../web");
const LOCAL_DATES_INDEX_PATH = resolve(WEB_PACKAGE_DIR, "src/data/_meta/dates.json");

let storage: Storage | undefined;
const getStorage = (): Storage => {
  if (!storage) storage = new Storage();
  return storage;
};

/** dates 配列を正規化（型チェック + 重複除去 + 昇順ソート） */
const normalizeDates = (dates: readonly unknown[]): string[] => {
  const set = new Set<string>();
  for (const d of dates) {
    if (typeof d === "string" && DATE_RE.test(d)) set.add(d);
  }
  return [...set].sort();
};

/** GCS から dates.json を読み込む。未存在/破損時は空配列 */
export const fetchDatesIndex = async (): Promise<string[]> => {
  const file = getStorage().bucket(WEB_BUCKET).file(META_OBJECT_NAME);
  try {
    const [buffer] = await file.download();
    const parsed = JSON.parse(buffer.toString("utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const dates = (parsed as { dates?: unknown }).dates;
    if (!Array.isArray(dates)) return [];
    return normalizeDates(dates);
  } catch (error) {
    const code = (error as { code?: number } | undefined)?.code;
    if (code === 404) return [];
    console.warn(
      `Failed to load dates index: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
};

/** GCS に dates.json を書き出す */
export const saveDatesIndex = async (dates: readonly string[]): Promise<void> => {
  const file = getStorage().bucket(WEB_BUCKET).file(META_OBJECT_NAME);
  const payload: DatesIndex = { dates: normalizeDates(dates) };
  await file.save(JSON.stringify(payload, null, 2), {
    contentType: "application/json; charset=utf-8",
    metadata: { cacheControl: "no-store" },
  });
};

/** ローカル(Astro が読む位置)に dates.json を書き出す */
export const writeLocalDatesIndex = async (dates: readonly string[]): Promise<void> => {
  const payload: DatesIndex = { dates: normalizeDates(dates) };
  await mkdir(dirname(LOCAL_DATES_INDEX_PATH), { recursive: true });
  await writeFile(LOCAL_DATES_INDEX_PATH, JSON.stringify(payload, null, 2), "utf-8");
};

/**
 * 既存リストに当日を追加して正規化したリストを返す。
 *
 * 純関数。GCS への保存は呼び出し側で `saveDatesIndex` を使う。
 */
export const mergeDate = (existing: readonly string[], date: string): string[] => {
  if (!DATE_RE.test(date)) {
    throw new Error(`Invalid date format (expected YYYY-MM-DD): ${date}`);
  }
  return normalizeDates([...existing, date]);
};
