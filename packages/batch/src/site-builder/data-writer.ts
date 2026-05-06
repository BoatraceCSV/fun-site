import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RacePrediction } from "@fun-site/shared";
import { parseRaceCode } from "@fun-site/shared";

const WEB_PACKAGE_DIR = resolve(import.meta.dirname, "../../../web");
const RACES_DIR = resolve(WEB_PACKAGE_DIR, "src/data/races");

/** 予想データを JSON として書き出し */
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
