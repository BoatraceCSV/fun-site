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
  | "recent_national"
  | "recent_local"
  | "motor_stats"
  | "results"
  | "payouts";

const CSV_PATH_PREFIX: Record<CsvType, string> = {
  title: "programs/title",
  race_cards: "programs/race_cards",
  stt: "previews/stt",
  tkz: "previews/tkz",
  sui: "previews/sui",
  recent_national: "programs/recent_national",
  recent_local: "programs/recent_local",
  motor_stats: "programs/motor_stats",
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

const buildHttpUrl = (relativePath: string, date: string): string => {
  // date は "YYYY-MM-DD" 形式なので、直接文字列操作でスラッシュ区切りに変換
  // new Date(date) を使うとタイムゾーン依存のバグが発生する
  const dateSlash = date.replaceAll("-", "/");
  return `${HTTP_BASE_URL}/${relativePath}/${dateSlash}.csv`;
};

const buildGcsObjectName = (relativePath: string, date: string): string => {
  const dateSlash = date.replaceAll("-", "/");
  return `${GCS_PATH_ROOT}/${relativePath}/${dateSlash}.csv`;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fetchHttp = async (relativePath: string, date: string): Promise<string> => {
  const url = buildHttpUrl(relativePath, date);
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = INITIAL_DELAY_MS * 2 ** attempt;
        console.warn(`Retry ${attempt + 1}/${MAX_RETRIES} for ${url}: ${lastError.message}`);
        await delay(backoffMs);
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${MAX_RETRIES} attempts: ${lastError?.message}`);
};

const fetchGcs = async (relativePath: string, date: string): Promise<string> => {
  const objectName = buildGcsObjectName(relativePath, date);
  const bucket = getStorage().bucket(GCS_BUCKET);
  const file = bucket.file(objectName);

  let lastError: Error | undefined;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = INITIAL_DELAY_MS * 2 ** attempt;
        console.warn(
          `Retry ${attempt + 1}/${MAX_RETRIES} for gs://${GCS_BUCKET}/${objectName}: ${lastError.message}`,
        );
        await delay(backoffMs);
      }
    }
  }

  throw new Error(
    `Failed to fetch gs://${GCS_BUCKET}/${objectName} after ${MAX_RETRIES} attempts: ${lastError?.message}`,
  );
};

const fetchAt = async (relativePath: string, date: string): Promise<string> => {
  const source = getCsvSource();
  return source === "gcs" ? fetchGcs(relativePath, date) : fetchHttp(relativePath, date);
};

/**
 * CSV テキストを取得（指数バックオフリトライ付き）。
 *
 * `CSV_SOURCE` 環境変数でソースを切り替える:
 * - `gcs` → Cloud Storage `gs://${CSV_GCS_BUCKET}/${CSV_GCS_PATH_ROOT}/...` (既定本番)
 * - `http` (default) → GitHub Pages `https://boatracecsv.github.io/data/...`
 */
export const fetchCsvText = async (type: CsvType, date: string): Promise<string> =>
  fetchAt(CSV_PATH_PREFIX[type], date);

/**
 * 予想者 `predictor` の index CSV テキストを取得する。パスは
 * `data/estimate/{predictor.id}/YYYY/MM/DD.csv`。リトライ / ソース切り替え
 * 動作は `fetchCsvText` と同じ。
 */
export const fetchIndexCsvText = async (predictor: PredictorSpec, date: string): Promise<string> =>
  fetchAt(predictorIndexRelativePath(predictor), date);
