const BASE_URL = "https://boatracecsv.github.io/data";

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

export type CsvType = "programs" | "prediction-preview" | "estimate" | "results" | "confirm";

const buildCsvUrl = (type: CsvType, date: string): string => {
  // date は "YYYY-MM-DD" 形式なので、直接文字列操作でスラッシュ区切りに変換
  // new Date(date) を使うとタイムゾーン依存のバグが発生する
  const dateSlash = date.replaceAll("-", "/");
  return `${BASE_URL}/${type}/${dateSlash}.csv`;
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** BoatraceCSV から CSV テキストを取得（指数バックオフリトライ付き） */
export const fetchCsvText = async (type: CsvType, date: string): Promise<string> => {
  const url = buildCsvUrl(type, date);
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
