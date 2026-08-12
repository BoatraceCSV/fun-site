import type {
  AnaPicksRow,
  IndexRow,
  KimariteRow,
  MotorStatsRow,
  OriginalExhibitionRow,
  PredictorSpec,
  RaceCardRow,
  RacePayoutRow,
  RaceResultRow,
  RacerStRow,
  RecentFormRow,
  SttRow,
  SuiRow,
  TitleRow,
  TkzRow,
  TokutenHayamiRow,
  Waku10Row,
} from "@fun-site/shared";
import { activePredictors } from "@fun-site/shared";
import { parseAnaPicks } from "./ana-picks-schemas.js";
import { fetchCsvText, fetchIndexCsvText } from "./csv-client.js";
import { parseKimarite } from "./kimarite-schemas.js";
import { parseMotorStats } from "./motor-stats-schemas.js";
import { parsePayouts } from "./payout-schemas.js";
import { parseOriginalExhibition, parseSui, parseTkz } from "./preview-schemas.js";
import { parseIndex, parseRaceCards, parseStt } from "./race-card-schemas.js";
import { parseRacerSt } from "./racer-st-schemas.js";
import { parseRecentForm } from "./recent-form-schemas.js";
import { parseResults } from "./result-schemas.js";
import { parseTitles } from "./schemas.js";
import { parseTokutenHayami } from "./tokuten-hayami-schemas.js";
import { parseWaku10 } from "./waku10-schemas.js";

/**
 * 1 予想者ぶんの index 取得結果。
 * Pub/Sub `csv_type=index:{predictor_id}` でアップロードされた CSV を
 * 予想者単位で保持する。
 */
export type PredictorIndexFetch = {
  readonly predictor: PredictorSpec;
  /** その予想者の daily / realtime 両状態を含む 1 CSV の全行。 */
  readonly rows: readonly IndexRow[];
};

/** 全CSVデータの取得結果 */
export type FetchedCsvData = {
  readonly titles: readonly TitleRow[];
  readonly raceCards: readonly RaceCardRow[];
  readonly stt: readonly SttRow[];
  /** 直前情報: 体重・展示タイム・チルト (previews/tkz)。未生成時は空配列。 */
  readonly tkz: readonly TkzRow[];
  /** 直前情報: 水面気象 (previews/sui)。未生成時は空配列。 */
  readonly sui: readonly SuiRow[];
  /** 直前情報: 場別オリジナル展示 (previews/original_exhibition)。未生成時は空配列。 */
  readonly originalExhibition: readonly OriginalExhibitionRow[];
  /**
   * 得点率早見 (previews/tokuten_hayami)。1 レース 1 行。予選最終日を過ぎた節・
   * 得点率早見を出さない節では行が存在しない。未生成時は空配列。
   */
  readonly tokutenHayami: readonly TokutenHayamiRow[];
  /** 近況5節: 全国 (programs/recent_national)。未生成時は空配列。 */
  readonly recentNational: readonly RecentFormRow[];
  /** 近況5節: 当地 (programs/recent_local)。未生成時は空配列。 */
  readonly recentLocal: readonly RecentFormRow[];
  /** 枠番別過去10走 (programs/waku10)。1 レース 1 行。未生成時は空配列。 */
  readonly waku10: readonly Waku10Row[];
  /** モーター期成績 (programs/motor_stats)。1 モーター 1 行。未生成時は空配列。 */
  readonly motorStats: readonly MotorStatsRow[];
  /**
   * 穴予想 A案 v9_suji の買い目 (estimate/suji)。レース × 状態 で 1 行。
   * fun-site は買い目を計算せず、この CSV の出目をそのまま使う
   * (boatracecsv docs/design/ana_prediction.md §13)。未生成時は空配列
   */
  readonly suji: readonly AnaPicksRow[];
  /**
   * 穴予想 B案 v10_kimarite の買い目 (estimate/kimarite/picks)。suji と同じ
   * スキーマだが、1 レースの 5 点に複数の 1着艇が混ざる。未生成時は空配列
   */
  readonly kimaritePicks: readonly AnaPicksRow[];
  /**
   * 荒れ度メーター (estimate/kimarite)。レース × 状態 で 1 行。
   * 予想者に紐づかないレース単位の指標。未生成時は空配列
   */
  readonly kimarite: readonly KimariteRow[];
  /**
   * 選手別 推定ST (estimate/racer_st)。1 レース 1 行。未生成時は空配列
   * (その場合スタート予想・1マーク距離は全国平均 ST にフォールバックする)。
   */
  readonly racerSt: readonly RacerStRow[];
  /** Active な全予想者の index CSV (失敗した予想者は空 rows で含まれる)。 */
  readonly indexesByPredictor: readonly PredictorIndexFetch[];
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

const fetchAndParseIndex = async (
  predictor: PredictorSpec,
  date: string,
): Promise<PredictorIndexFetch> => {
  try {
    const text = await fetchIndexCsvText(predictor, date);
    return { predictor, rows: parseIndex(text, predictor) };
  } catch (error) {
    console.warn(
      `Failed to fetch index for predictor ${predictor.id} on ${date}: ${
        error instanceof Error ? error.message : error
      }`,
    );
    return { predictor, rows: [] };
  }
};

/**
 * 当日分の CSV データを取得・パースする。
 *
 * 取得するのは BoatraceCSV で現在生成されている CSV:
 * - 当日分: programs/title / programs/race_cards / previews/stt
 * - 各 active 予想者の index: `data/estimate/{predictor_id}/YYYY/MM/DD.csv`
 *   (`activePredictors()` をループし、各 predictor の componentKeys に
 *   基づいてスキーマを動的にパースする)
 * - 確定済みレース: results/realtime / results/payouts（preview-realtime が
 *   当日確定直後に追記)
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
  const predictors = activePredictors();
  const [
    titles,
    raceCards,
    stt,
    tkz,
    sui,
    originalExhibition,
    tokutenHayami,
    recentNational,
    recentLocal,
    waku10,
    motorStats,
    racerSt,
    suji,
    kimaritePicks,
    kimarite,
    indexesByPredictor,
    results,
    payouts,
  ] = await Promise.all([
    fetchAndParse("title", date, parseTitles),
    fetchAndParse("race_cards", date, parseRaceCards),
    fetchAndParse("stt", date, parseStt),
    fetchAndParse("tkz", date, parseTkz),
    fetchAndParse("sui", date, parseSui),
    fetchAndParse("original_exhibition", date, parseOriginalExhibition),
    fetchAndParse("tokuten_hayami", date, parseTokutenHayami),
    fetchAndParse("recent_national", date, parseRecentForm),
    fetchAndParse("recent_local", date, parseRecentForm),
    fetchAndParse("waku10", date, parseWaku10),
    fetchAndParse("motor_stats", date, parseMotorStats),
    fetchAndParse("racer_st", date, parseRacerSt),
    fetchAndParse("suji", date, parseAnaPicks),
    fetchAndParse("kimarite_picks", date, parseAnaPicks),
    fetchAndParse("kimarite", date, parseKimarite),
    Promise.all(predictors.map((p) => fetchAndParseIndex(p, date))),
    fetchAndParse("results", date, parseResults),
    fetchAndParse("payouts", date, parsePayouts),
  ]);

  return {
    titles,
    raceCards,
    stt,
    tkz,
    sui,
    originalExhibition,
    tokutenHayami,
    recentNational,
    recentLocal,
    waku10,
    motorStats,
    racerSt,
    suji,
    kimaritePicks,
    kimarite,
    indexesByPredictor,
    results,
    payouts,
  };
};

export { fetchCsvText, fetchIndexCsvText } from "./csv-client.js";
export { parsePayouts } from "./payout-schemas.js";
export { parseMotorStats } from "./motor-stats-schemas.js";
export { parseRacerSt } from "./racer-st-schemas.js";
export { parseAnaPicks } from "./ana-picks-schemas.js";
export { parseKimarite } from "./kimarite-schemas.js";
export { parseOriginalExhibition, parseSui, parseTkz } from "./preview-schemas.js";
export { parseIndex, parseRaceCards, parseStt } from "./race-card-schemas.js";
export { parseRecentForm } from "./recent-form-schemas.js";
export { parseTokutenHayami } from "./tokuten-hayami-schemas.js";
export { parseWaku10 } from "./waku10-schemas.js";
export { parseResults } from "./result-schemas.js";
export { parseTitles } from "./schemas.js";

// `IndexRow` は型エクスポートとして利用される (predictor-stats 集計バッチ等)。
export type { IndexRow };
