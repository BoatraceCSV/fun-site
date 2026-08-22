import type { PredictorSpec } from "@fun-site/shared";
import { Storage } from "@google-cloud/storage";

const HTTP_BASE_URL = "https://boatracecsv.github.io/data";

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

// BoatraceCSV で現在 fun-site が利用する非予想者依存 CSV を列挙する。
// 旧 programs / prediction-preview / estimate / confirm は上流で生成停止に伴い廃止済み。
// `results` は preview-realtime が当日確定直後に追記する realtime 結果 CSV
// (`data/results/realtime/YYYY/MM/DD.csv`)。`payouts` は同じく当日確定直後に
// bc_rs2 から追記する払戻 CSV (`data/results/payouts/YYYY/MM/DD.csv`)。
// K-file 由来の翌日確定 (`data/results/daily/...`) は対象外。
//
// 予想者ごとの index CSV (`data/estimate/{predictor_id}/...`) は `fetchIndexCsvText`
// が PredictorSpec を引数に取って動的にパスを組み立てる。
export type CsvType =
  | "title"
  | "race_cards"
  | "stt"
  | "tkz"
  | "sui"
  | "original_exhibition"
  | "tokuten_hayami"
  | "recent_national"
  | "recent_local"
  | "waku10"
  | "motor_stats"
  | "racer_st"
  | "suji"
  | "kimarite"
  | "kimarite_picks"
  | "results"
  | "payouts";

const CSV_PATH_PREFIX: Record<CsvType, string> = {
  title: "programs/title",
  race_cards: "programs/race_cards",
  stt: "previews/stt",
  tkz: "previews/tkz",
  sui: "previews/sui",
  original_exhibition: "previews/original_exhibition",
  tokuten_hayami: "previews/tokuten_hayami",
  recent_national: "programs/recent_national",
  recent_local: "programs/recent_local",
  waku10: "programs/waku10",
  motor_stats: "programs/motor_stats",
  racer_st: "estimate/racer_st",
  suji: "estimate/suji",
  kimarite: "estimate/kimarite",
  kimarite_picks: "estimate/kimarite/picks",
  results: "results/realtime",
  payouts: "results/payouts",
};

/**
 * Predictor `predictor` の index CSV のリポジトリ相対パス
 * (HTTP / GCS 両ソースで共通の `data/` 直下のディレクトリ部分)。
 */
const predictorIndexRelativePath = (predictor: PredictorSpec): string => `estimate/${predictor.id}`;

/**
 * CSV のソース。
 * - `http`: GitHub Pages (https://boatracecsv.github.io/data/...) から取得（旧経路、開発時の fallback）
 * - `gcs`: Cloud Storage `gs://${BUCKET}/data/...` から取得（preview-realtime が直接書き込む経路、本番）
 */
type CsvSource = "http" | "gcs";

const getCsvSource = (): CsvSource => {
  const v = process.env["CSV_SOURCE"]?.toLowerCase();
  return v === "gcs" ? "gcs" : "http";
};

// GCS バケット名。preview-realtime と fun-site が共有する CSV ミラー用。
// 環境変数 `CSV_GCS_BUCKET` で上書き可能。
const GCS_BUCKET = process.env["CSV_GCS_BUCKET"] ?? "boatrace-realtime-data";

// GCS バケット内のプレフィックス。GitHub Pages と同じパス構造を採用するため、
// `data/programs/title/YYYY/MM/DD.csv` のように配置される。
const GCS_PATH_ROOT = process.env["CSV_GCS_PATH_ROOT"] ?? "data";

// GCS Storage クライアントは初回利用時に lazy 初期化する（http 経路のみで使う場合に
// ADC が無くても動かせるように）。
let storage: Storage | undefined;
const getStorage = (): Storage => {
  if (!storage) storage = new Storage();
  return storage;
};

/**
 * `data/` 直下からの相対パス（末尾 `.csv` まで）。
 *
 * 日付パーティションを持つ CSV は `{prefix}/YYYY/MM/DD.csv`、静的テーブル
 * (`estimate/stadium/...`) は日付を含まない固定パスになる。HTTP / GCS の
 * どちらの経路もこの文字列に base を付けるだけで URL / object name になる。
 */
type CsvObjectPath = string;

/** 日付パーティション付きのパスを組み立てる */
const datedPath = (relativePath: string, date: string): CsvObjectPath => {
  // date は "YYYY-MM-DD" 形式なので、直接文字列操作でスラッシュ区切りに変換
  // new Date(date) を使うとタイムゾーン依存のバグが発生する
  const dateSlash = date.replaceAll("-", "/");
  return `${relativePath}/${dateSlash}.csv`;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fetchHttp = async (path: CsvObjectPath, maxRetries: number): Promise<string> => {
  const url = `${HTTP_BASE_URL}/${path}`;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        const backoffMs = INITIAL_DELAY_MS * 2 ** attempt;
        console.warn(`Retry ${attempt + 1}/${maxRetries} for ${url}: ${lastError.message}`);
        await delay(backoffMs);
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${maxRetries} attempts: ${lastError?.message}`);
};

const fetchGcs = async (path: CsvObjectPath, maxRetries: number): Promise<string> => {
  const objectName = `${GCS_PATH_ROOT}/${path}`;
  const bucket = getStorage().bucket(GCS_BUCKET);
  const file = bucket.file(objectName);

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const [buffer] = await file.download();
      return buffer.toString("utf-8");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // 404 は object 不在＝当該 CSV がまだ書き込まれていない状態。リトライしても無駄なので即時失敗。
      const status = (error as { code?: number } | undefined)?.code;
      if (status === 404) {
        throw new Error(`GCS object not found: gs://${GCS_BUCKET}/${objectName} (status 404)`);
      }
      if (attempt < maxRetries - 1) {
        const backoffMs = INITIAL_DELAY_MS * 2 ** attempt;
        console.warn(
          `Retry ${attempt + 1}/${maxRetries} for gs://${GCS_BUCKET}/${objectName}: ${lastError.message}`,
        );
        await delay(backoffMs);
      }
    }
  }

  throw new Error(
    `Failed to fetch gs://${GCS_BUCKET}/${objectName} after ${maxRetries} attempts: ${lastError?.message}`,
  );
};

const fetchAt = async (path: CsvObjectPath, maxRetries = MAX_RETRIES): Promise<string> => {
  const source = getCsvSource();
  return source === "gcs" ? fetchGcs(path, maxRetries) : fetchHttp(path, maxRetries);
};

/**
 * CSV テキストを取得（指数バックオフリトライ付き）。
 *
 * `CSV_SOURCE` 環境変数でソースを切り替える:
 * - `gcs` → Cloud Storage `gs://${CSV_GCS_BUCKET}/${CSV_GCS_PATH_ROOT}/...` (既定本番)
 * - `http` (default) → GitHub Pages `https://boatracecsv.github.io/data/...`
 */
export const fetchCsvText = async (type: CsvType, date: string): Promise<string> =>
  fetchAt(datedPath(CSV_PATH_PREFIX[type], date));

/**
 * 予想者 `predictor` の index CSV テキストを取得する。パスは
 * `data/estimate/{predictor.id}/YYYY/MM/DD.csv`。リトライ / ソース切り替え
 * 動作は `fetchCsvText` と同じ。
 */
export const fetchIndexCsvText = async (predictor: PredictorSpec, date: string): Promise<string> =>
  fetchAt(datedPath(predictorIndexRelativePath(predictor), date));

/**
 * 場 × 季節 × コース勝率テーブル (`data/estimate/stadium/win_rate.csv`)。
 * 枠番pt の生値ソースで、日付パーティションを持たない静的テーブル。
 */
export const WAKU_TABLE_CSV_PATH = "estimate/stadium/win_rate.csv";

export const fetchWakuTableCsvText = async (): Promise<string> => fetchAt(WAKU_TABLE_CSV_PATH);

/**
 * 場別の気象線形回帰係数 (`data/estimate/stadium/sui_params.csv`)。
 * 気象pt の生値ソースで、win_rate.csv と同じく日付パーティションを持たない
 * 静的テーブル (24 場 = 24 行, 約 12KB)。
 */
export const SUI_PARAMS_CSV_PATH = "estimate/stadium/sui_params.csv";

export const fetchSuiParamsCsvText = async (): Promise<string> => fetchAt(SUI_PARAMS_CSV_PATH);

/** 月をまたいで遡る上限。これを超えて古い weights しか無い状態は異常とみなす */
const WEIGHTS_LOOKBACK_MONTHS = 12;

/** "YYYY-MM-DD" → "YYYY-MM" を `n` ヶ月戻したもの */
const monthTagBefore = (date: string, n: number): string => {
  const [y, m] = date.split("-").map(Number);
  // Date を使わず素の算術で戻す（タイムゾーン非依存にするため）
  const total = (y ?? 0) * 12 + ((m ?? 1) - 1) - n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
};

/** 場別重み CSV の取得結果。どの月のファイルを引けたかを添える */
export type WeightsCsvFetch = {
  /** "YYYY-MM"。上流の monthly-weights が生成した月 */
  readonly month: string;
  readonly text: string;
};

/**
 * 予想者 `predictorId` の場別重み CSV
 * (`data/estimate/stadium/weights/{predictorId}/YYYY-MM.csv`) を取得する。
 *
 * 上流 `build_index.py` は **対象日の月以下で最新** のファイルを使うので、
 * こちらも対象月から 1 ヶ月ずつ遡って最初に見つかったものを採用する
 * (monthly-weights が当月ぶんをまだ生成していない月初のため)。
 *
 * 遡りの各試行はリトライ無し (存在しない月の 404 を待つのは無駄)。全ての月が
 * 空振りしたときだけ、通信エラーと取り違えていないかを対象月へのリトライ付き
 * 再取得で確かめる。
 */
export const fetchWeightsCsv = async (
  predictorId: string,
  date: string,
): Promise<WeightsCsvFetch | undefined> => {
  const pathFor = (month: string) => `estimate/stadium/weights/${predictorId}/${month}.csv`;

  for (let back = 0; back < WEIGHTS_LOOKBACK_MONTHS; back++) {
    const month = monthTagBefore(date, back);
    try {
      return { month, text: await fetchAt(pathFor(month), 1) };
    } catch {
      // 次の月へ
    }
  }

  const month = monthTagBefore(date, 0);
  try {
    return { month, text: await fetchAt(pathFor(month)) };
  } catch (error) {
    console.warn(
      `Failed to fetch weights CSV for ${predictorId} (${date}): ${
        error instanceof Error ? error.message : error
      }`,
    );
    return undefined;
  }
};
