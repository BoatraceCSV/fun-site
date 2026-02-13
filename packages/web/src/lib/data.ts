import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ConfirmationRow, RacePrediction } from "@fun-site/shared";

const CONTENT_DIR = resolve(import.meta.dirname, "../content/races");
const CONFIRMATIONS_DIR = resolve(import.meta.dirname, "../content/confirmations");

/** 指定日付の全予想データを読み込み */
export const loadPredictions = async (date: string): Promise<RacePrediction[]> => {
  const dir = resolve(CONTENT_DIR, date);
  try {
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const predictions = await Promise.all(
      jsonFiles.map(async (f) => {
        const content = await readFile(resolve(dir, f), "utf-8");
        return JSON.parse(content) as RacePrediction;
      }),
    );
    return predictions.sort((a, b) => {
      if (a.stadium !== b.stadium) return a.stadium.localeCompare(b.stadium);
      return a.raceNumber - b.raceNumber;
    });
  } catch {
    return [];
  }
};

/** 指定日付の的中確認データを読み込み */
export const loadConfirmations = async (date: string): Promise<ConfirmationRow[]> => {
  try {
    const content = await readFile(resolve(CONFIRMATIONS_DIR, `${date}.json`), "utf-8");
    return JSON.parse(content) as ConfirmationRow[];
  } catch {
    return [];
  }
};

/** 利用可能な日付一覧を取得 */
export const loadAvailableDates = async (): Promise<string[]> => {
  try {
    const entries = await readdir(CONTENT_DIR);
    return entries
      .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e))
      .sort()
      .reverse();
  } catch {
    return [];
  }
};
