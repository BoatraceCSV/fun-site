import type {
  IndexRow,
  RaceCardRow,
  RacePayoutRow,
  RaceResultRow,
  SttRow,
  TitleRow,
} from "@fun-site/shared";
import { fetchCsvText } from "./csv-client.js";
import { parsePayouts } from "./payout-schemas.js";
import { parseIndex, parseRaceCards, parseStt } from "./race-card-schemas.js";
import { parseResults } from "./result-schemas.js";
import { parseTitles } from "./schemas.js";

/** 全CSVデータの取得結果 */
export type FetchedCsvData = {
  readonly titles: readonly TitleRow[];
  readonly raceCards: readonly RaceCardRow[];
  readonly stt: readonly SttRow[];
  readonly indexes: readonly IndexRow[];
  /**
   * realtime 結果 CSV。締切前 / 未確定のレースは含まれない（部分集合）。
   * CSV 自体が当日まだ生成されていない場合は空配列。
   */
  readonly results: readonly RaceResultRow[];
  /**
   * realtime 払戻 CSV。`results` と独立に追記されるため、results にあって
   * payouts に無い（その逆も）レースが過渡的に存在し得る。最終的には数分
   * 以内に揃う。CSV 自体が当日まだ生成されていない場合は空配列。
   */
  readonly payouts: readonly RacePayoutRow[];
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
 * - 当日分: programs/title / programs/race_cards / previews/stt / estimate/index
 * - 確定済みレース: results/realtime / results/payouts（preview-realtime が
 *   当日確定直後に追記）
 *
 * `programs/title` はレース名・タイトル・締切時刻などのメタ情報。
 * 出走表本体（選手・モーター情報）は `programs/race_cards` から取得する。
 *
 * `results/realtime` は当日確定直後に bc_rs1_2 をパースして追記される
 * 当日結果 CSV (着順 / ST / 気象)。`results/payouts` は bc_rs2 由来の
 * 当日払戻 CSV (単勝 / 複勝 / 2連単 / 2連複 / 拡連複 / 3連単 / 3連複)。
 * K-file 由来の翌日確定 (`data/results/daily/...`) は対象外。
 * 旧 `programs/YYYY/MM/DD.csv` および prediction-preview / estimate / confirm は
 * 上流での生成停止に伴い fetcher から完全に削除済み。
 */
export const fetchAllCsvData = async (date: string): Promise<FetchedCsvData> => {
  const [titles, raceCards, stt, indexes, results, payouts] = await Promise.all([
    fetchAndParse("title", date, parseTitles),
    fetchAndParse("race_cards", date, parseRaceCards),
    fetchAndParse("stt", date, parseStt),
    fetchAndParse("index", date, parseIndex),
    fetchAndParse("results", date, parseResults),
    fetchAndParse("payouts", date, parsePayouts),
  ]);

  return { titles, raceCards, stt, indexes, results, payouts };
};

export { fetchCsvText } from "./csv-client.js";
export { parsePayouts } from "./payout-schemas.js";
export { parseIndex, parseRaceCards, parseStt } from "./race-card-schemas.js";
export { parseResults } from "./result-schemas.js";
export { parseTitles } from "./schemas.js";
