import type { IndexRow, RaceCardRow, SttRow, TitleRow } from "@fun-site/shared";
import { fetchCsvText } from "./csv-client.js";
import { parseIndex, parseRaceCards, parseStt } from "./race-card-schemas.js";
import { parseTitles } from "./schemas.js";

/** 全CSVデータの取得結果 */
export type FetchedCsvData = {
  readonly titles: readonly TitleRow[];
  readonly raceCards: readonly RaceCardRow[];
  readonly stt: readonly SttRow[];
  readonly indexes: readonly IndexRow[];
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
 * 当日分の CSV データを取得・パースする。
 *
 * 取得するのは BoatraceCSV で現在生成されている CSV:
 * - 当日分: programs/title / programs/race_cards / previews/stt / index
 *
 * `programs/title` はレース名・タイトル・締切時刻などのメタ情報。
 * 出走表本体（選手・モーター情報）は `programs/race_cards` から取得する。
 *
 * results CSV は的中実績ページ廃止に伴い取得対象から除外済み。
 * 旧 `programs/YYYY/MM/DD.csv` および prediction-preview / estimate / confirm は
 * 上流での生成停止に伴い fetcher から完全に削除済み。
 */
export const fetchAllCsvData = async (date: string): Promise<FetchedCsvData> => {
  const [titles, raceCards, stt, indexes] = await Promise.all([
    fetchAndParse("title", date, parseTitles),
    fetchAndParse("race_cards", date, parseRaceCards),
    fetchAndParse("stt", date, parseStt),
    fetchAndParse("index", date, parseIndex),
  ]);

  return { titles, raceCards, stt, indexes };
};

export { fetchCsvText } from "./csv-client.js";
export { parseIndex, parseRaceCards, parseStt } from "./race-card-schemas.js";
export { parseTitles } from "./schemas.js";
