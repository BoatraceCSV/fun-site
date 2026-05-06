import type {
  EstimateRow,
  IndexRow,
  PredictionPreviewRow,
  ProgramRow,
  RaceCardRow,
  ResultRow,
  SttRow,
  TitleRow,
} from "@fun-site/shared";
import { formatDate, getPreviousDate, parseDate } from "@fun-site/shared";
import { fetchCsvText } from "./csv-client.js";
import { parseIndex, parseRaceCards, parseStt } from "./race-card-schemas.js";
import { parsePrograms, parseResults, parseTitles } from "./schemas.js";

/** 全CSVデータの取得結果 */
export type FetchedCsvData = {
  readonly programs: readonly ProgramRow[];
  readonly titles: readonly TitleRow[];
  readonly raceCards: readonly RaceCardRow[];
  readonly stt: readonly SttRow[];
  readonly indexes: readonly IndexRow[];
  readonly results: readonly ResultRow[];
};

/**
 * レガシー: programs + prediction-preview + estimate をレースコードで結合した型。
 * prediction-preview / estimate は CSV 生成停止のため、実行時は常に undefined。
 */
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

/**
 * 当日分 + 前日分の CSV データを取得・パースする。
 *
 * 取得するのは BoatraceCSV で現在生成されている CSV:
 * - 当日分: programs / programs/title / race_cards / stt / index
 * - 前日分: results
 *
 * `programs/title` はレース名・タイトル・締切時刻などのメタ情報専用。
 * 出走表メタの取得は title CSV を優先し、programs CSV は AI predictor が
 * 必要とする選手データ (boats) のために併せて取得する。
 *
 * 旧 prediction-preview / estimate / confirm は 2026-05 以降生成停止のため
 * fetcher からは外している（型は残置）。
 */
export const fetchAllCsvData = async (date: string): Promise<FetchedCsvData> => {
  const previousDate = formatDate(getPreviousDate(parseDate(date)));

  const [programs, titles, raceCards, stt, indexes, results] = await Promise.all([
    fetchAndParse("programs", date, parsePrograms),
    fetchAndParse("title", date, parseTitles),
    fetchAndParse("race_cards", date, parseRaceCards),
    fetchAndParse("stt", date, parseStt),
    fetchAndParse("index", date, parseIndex),
    fetchAndParse("results", previousDate, parseResults),
  ]);

  return { programs, titles, raceCards, stt, indexes, results };
};

/** Programs を MergedRaceData にマップする（レガシー API 互換用） */
export const mergeRaceData = (data: FetchedCsvData): readonly MergedRaceData[] =>
  data.programs.map((program) => ({
    program,
    predictionPreview: undefined,
    estimate: undefined,
  }));

export { fetchCsvText } from "./csv-client.js";
export { parseIndex, parseRaceCards, parseStt } from "./race-card-schemas.js";
export {
  parseConfirmations,
  parseEstimates,
  parsePredictionPreviews,
  parsePrograms,
  parseResults,
  parseTitles,
} from "./schemas.js";
