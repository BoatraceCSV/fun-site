import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { type RacePrediction, toJSTDateString } from "@fun-site/shared";

const RACES_DIR = resolve(process.cwd(), "src/data/races");

/**
 * ビルド対象日（JST 当日）。
 *
 * `BUILD_TARGET_DATE` で明示指定可能（CI / バックフィル用）。
 * `BUILD_ALL_DATES=1` のときは過去日付も巻き込んでビルドする
 *  (`loadAvailableDates` 側で参照される)。
 */
const getBuildTargetDate = (): string => {
  const override = process.env["BUILD_TARGET_DATE"];
  return override && /^\d{4}-\d{2}-\d{2}$/.test(override)
    ? override
    : toJSTDateString(new Date());
};

/** 新スキーマか判定（旧 RacePrediction JSON を読み飛ばすガード） */
const isNewSchema = (json: unknown): json is RacePrediction => {
  if (!json || typeof json !== "object") return false;
  const obj = json as Record<string, unknown>;
  return (
    typeof obj.raceCode === "string" &&
    typeof obj.stadiumId === "string" &&
    obj.startPrediction !== undefined &&
    obj.aiEvaluation !== undefined &&
    Array.isArray(obj.racers)
  );
};

/** 指定日付の全予想データを読み込み */
export const loadPredictions = async (date: string): Promise<RacePrediction[]> => {
  const dir = resolve(RACES_DIR, date);
  try {
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const parsed = await Promise.all(
      jsonFiles.map(async (f) => {
        const content = await readFile(resolve(dir, f), "utf-8");
        try {
          return JSON.parse(content) as unknown;
        } catch {
          return undefined;
        }
      }),
    );
    const predictions = parsed.filter(isNewSchema);
    // 古い JSON 互換: dayLabel / grade が未設定の場合は空文字で埋める
    const normalized = predictions.map((p) => ({
      ...p,
      dayLabel: typeof p.dayLabel === "string" ? p.dayLabel : "",
      grade: typeof p.grade === "string" ? p.grade : "",
    }));
    return normalized.sort((a, b) => {
      if (a.stadiumId !== b.stadiumId) return a.stadiumId.localeCompare(b.stadiumId);
      return a.raceNumber - b.raceNumber;
    });
  } catch {
    return [];
  }
};

/**
 * ビルド対象の日付一覧を取得する。
 *
 * 既定では JST 当日 1 件のみを返す（preview-realtime 5 分サイクルでの再ビルドを
 * 当日分に絞り、Astro の getStaticPaths が過去日付の JSON まで読み込んで
 * ページ数が線形に肥大化するのを防ぐ）。
 *
 * 過去日付の HTML / アセットは `deploy.ts` 側で削除フィルタに引っかからない
 * ため GCS 上に残置され、ユーザは引き続き URL で参照可能。
 *
 * `BUILD_ALL_DATES=1` を設定するとローカル / 開発用に全日付を返す。
 */
export const loadAvailableDates = async (): Promise<string[]> => {
  try {
    const entries = await readdir(RACES_DIR);
    const all = entries
      .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e))
      .sort()
      .reverse();
    if (process.env["BUILD_ALL_DATES"] === "1") return all;
    const target = getBuildTargetDate();
    return all.filter((d) => d === target);
  } catch {
    return [];
  }
};
