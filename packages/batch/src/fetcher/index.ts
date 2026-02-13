import type {
  ConfirmationRow,
  EstimateRow,
  PredictionPreviewRow,
  ProgramRow,
  ResultRow,
} from "@fun-site/shared";
import { formatDate, getPreviousDate, parseDate } from "@fun-site/shared";
import { fetchCsvText } from "./csv-client.js";
import {
  parseConfirmations,
  parseEstimates,
  parsePredictionPreviews,
  parsePrograms,
  parseResults,
} from "./schemas.js";

/** 全CSVデータの取得結果 */
export type FetchedCsvData = {
  readonly programs: readonly ProgramRow[];
  readonly predictionPreviews: readonly PredictionPreviewRow[];
  readonly estimates: readonly EstimateRow[];
  readonly results: readonly ResultRow[];
  readonly confirmations: readonly ConfirmationRow[];
};

/** レース単位の統合データ */
export type MergedRaceData = {
  readonly program: ProgramRow;
  readonly predictionPreview: PredictionPreviewRow | undefined;
  readonly estimate: EstimateRow | undefined;
};

const fetchAndParse = async <T>(
  type: Parameters<typeof fetchCsvText>[0],
  date: string,
  parser: (text: string) => T[],
): Promise<T[]> => {
  try {
    const text = await fetchCsvText(type, date);
    return parser(text);
  } catch (error) {
    console.warn(
      `Failed to fetch ${type} for ${date}: ${error instanceof Error ? error.message : error}`,
    );
    return [];
  }
};

/** 当日分 + 前日分の全CSVデータを取得・パース */
export const fetchAllCsvData = async (date: string): Promise<FetchedCsvData> => {
  const previousDate = formatDate(getPreviousDate(parseDate(date)));

  const [programs, predictionPreviews, estimates, results, confirmations] = await Promise.all([
    fetchAndParse("programs", date, parsePrograms),
    fetchAndParse("prediction-preview", date, parsePredictionPreviews),
    fetchAndParse("estimate", date, parseEstimates),
    fetchAndParse("results", previousDate, parseResults),
    fetchAndParse("confirm", previousDate, parseConfirmations),
  ]);

  return { programs, predictionPreviews, estimates, results, confirmations };
};

/** Programs + PredictionPreviews + Estimates をレースコードで結合 */
export const mergeRaceData = (data: FetchedCsvData): readonly MergedRaceData[] =>
  data.programs.map((program) => ({
    program,
    predictionPreview: data.predictionPreviews.find((pp) => pp.raceCode === program.raceCode),
    estimate: data.estimates.find((e) => e.raceCode === program.raceCode),
  }));

export { fetchCsvText } from "./csv-client.js";
export {
  parseConfirmations,
  parseEstimates,
  parsePredictionPreviews,
  parsePrograms,
  parseResults,
} from "./schemas.js";
