import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AccuracyStats, ConfirmationRow, RacePrediction } from "@fun-site/shared";
import { parseRaceCode } from "@fun-site/shared";

const WEB_PACKAGE_DIR = resolve(import.meta.dirname, "../../../web");
const CONTENT_DIR = resolve(WEB_PACKAGE_DIR, "src/content/races");

/** 予想データを JSON として書き出し */
export const writePredictionData = async (
  predictions: readonly RacePrediction[],
): Promise<void> => {
  for (const prediction of predictions) {
    const parsed = parseRaceCode(prediction.raceCode);
    const filePath = resolve(CONTENT_DIR, parsed.date, `${prediction.raceCode}.json`);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(prediction, null, 2), "utf-8");
  }
  console.info(`Wrote ${predictions.length} prediction JSON files`);
};

/** 的中確認データを日付別 JSON として書き出し */
export const writeConfirmationsData = async (
  confirmations: readonly ConfirmationRow[],
): Promise<void> => {
  if (confirmations.length === 0) return;

  const byDate = new Map<string, ConfirmationRow[]>();
  for (const c of confirmations) {
    const parsed = parseRaceCode(c.raceCode);
    const group = byDate.get(parsed.date) ?? [];
    group.push(c);
    byDate.set(parsed.date, group);
  }

  const confirmDir = resolve(WEB_PACKAGE_DIR, "src/content/confirmations");
  await mkdir(confirmDir, { recursive: true });

  for (const [date, rows] of byDate) {
    await writeFile(resolve(confirmDir, `${date}.json`), JSON.stringify(rows, null, 2), "utf-8");
  }
  console.info(`Wrote confirmations for ${byDate.size} date(s)`);
};

/** AI予想の的中率を計算 */
const calcAiAccuracy = (
  predictions: readonly RacePrediction[],
  confirmations: readonly ConfirmationRow[],
): { hit1st: number; hitTrifecta: number; hitTechnique: number } => {
  const confirmMap = new Map(confirmations.map((c) => [c.raceCode, c]));
  let matched = 0;
  let aiHit1st = 0;
  let aiHitTrifecta = 0;
  let aiHitTechnique = 0;

  for (const pred of predictions) {
    const conf = confirmMap.get(pred.raceCode);
    if (!conf) continue;
    matched++;

    const aiOrder = pred.aiPrediction.predictedOrder;
    if (aiOrder[0] === conf.actual1st) aiHit1st++;
    if (
      aiOrder[0] === conf.actual1st &&
      aiOrder[1] === conf.actual2nd &&
      aiOrder[2] === conf.actual3rd
    ) {
      aiHitTrifecta++;
    }
    if (pred.aiPrediction.predictedTechnique === conf.actualTechnique) aiHitTechnique++;
  }

  if (matched === 0) return { hit1st: 0, hitTrifecta: 0, hitTechnique: 0 };
  return {
    hit1st: aiHit1st / matched,
    hitTrifecta: aiHitTrifecta / matched,
    hitTechnique: aiHitTechnique / matched,
  };
};

/** 的中実績を stats データとして書き出し */
export const writeStatsData = async (
  predictions: readonly RacePrediction[],
  confirmations: readonly ConfirmationRow[],
): Promise<void> => {
  if (confirmations.length === 0) return;

  const totalRaces = confirmations.length;
  const aiAccuracy = calcAiAccuracy(predictions, confirmations);
  const stats: AccuracyStats = {
    period: "daily",
    totalRaces,
    ml: {
      hit1st: confirmations.filter((c) => c.hit1st).length / totalRaces,
      hitAll: confirmations.filter((c) => c.hitAll).length / totalRaces,
      hitTechnique: confirmations.filter((c) => c.hitTechnique).length / totalRaces,
      avgCourseMatch: confirmations.reduce((sum, c) => sum + c.courseMatchCount, 0) / totalRaces,
      avgSTMAE: confirmations.reduce((sum, c) => sum + c.stMAE, 0) / totalRaces,
    },
    ai: aiAccuracy,
  };

  const statsDir = resolve(CONTENT_DIR, "../stats");
  await mkdir(statsDir, { recursive: true });
  await writeFile(resolve(statsDir, "accuracy.json"), JSON.stringify(stats, null, 2), "utf-8");
  console.info("Wrote stats data");
};
