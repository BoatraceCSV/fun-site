import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { RacePrediction } from "@fun-site/shared";

const RACES_DIR = resolve(process.cwd(), "src/data/races");

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
    return predictions.sort((a, b) => {
      if (a.stadiumId !== b.stadiumId) return a.stadiumId.localeCompare(b.stadiumId);
      return a.raceNumber - b.raceNumber;
    });
  } catch {
    return [];
  }
};

/** 利用可能な日付一覧を取得 */
export const loadAvailableDates = async (): Promise<string[]> => {
  try {
    const entries = await readdir(RACES_DIR);
    return entries
      .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e))
      .sort()
      .reverse();
  } catch {
    return [];
  }
};
