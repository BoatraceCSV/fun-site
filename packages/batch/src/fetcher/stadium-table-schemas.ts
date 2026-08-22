import type {
  CourseCoefs,
  CourseRates,
  StadiumComponentWeightsRow,
  StadiumWeightsComponent,
  SuiParamsRow,
  WakuSeason,
  WakuTableRow,
  WeatherFeatureKey,
} from "@fun-site/shared";
import { WAKU_SEASONS, WEATHER_FEATURE_KEYS } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

/** 空欄・非数は null。テーブル値は 0 と未取得を混同できないので null で落とす */
const toNumberOrNull = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const num = Number(v);
  return Number.isNaN(num) ? null : num;
};

const isWakuSeason = (v: string): v is WakuSeason =>
  (WAKU_SEASONS as readonly string[]).includes(v);

// === win_rate CSV (estimate/stadium/win_rate.csv) ===

/**
 * 場 × 季節 × コース勝率テーブルをパースする。24 場 × 4 季節 = 96 行。
 *
 * 列は `場コード,季節,1コース勝率,...,6コース勝率`。6 コースのどれか 1 つでも
 * 欠けている行は枠番pt を再現できないので落とす（テーブル欠損を 0 として
 * 表示すると「このコースは超不利」という嘘になるため）。
 */
export const parseWakuTable = (csvText: string): WakuTableRow[] => {
  const rows: WakuTableRow[] = [];
  for (const row of parseCsv(csvText)) {
    const stadiumId = (row["場コード"] ?? "").trim().padStart(2, "0");
    const season = (row["季節"] ?? "").trim();
    if (stadiumId === "" || !isWakuSeason(season)) continue;

    const rates = [1, 2, 3, 4, 5, 6].map((c) => toNumberOrNull(row[`${c}コース勝率`]));
    if (rates.some((r) => r === null)) continue;

    rows.push({ stadiumId, season, rates: rates as unknown as CourseRates });
  }
  return rows;
};

// === sui_params CSV (estimate/stadium/sui_params.csv) ===

/** 特徴量キー → sui_params.csv の列名プリフィックス（上流 `PARAM_FEATURES`） */
const SUI_PARAMS_COLUMN: Readonly<Record<WeatherFeatureKey, string>> = {
  waveCm: "wave_cm",
  tempDiffC: "temp_diff",
  windTailMs: "wind_tail_ms",
  windHeadMs: "wind_head_ms",
  isCloudy: "is_cloudy",
  isRainy: "is_rainy",
};

/**
 * 場別の気象回帰係数テーブルをパースする。24 場 = 24 行。
 *
 * 列は `stadium,base_c1..base_c6,{feature}_c1..{feature}_c6`（特徴量 6 種）。
 * `base_c{course}` 切片は上流 `weather_advantage()` が意図的に使わない
 * （枠番pt と重複するため）ので読み飛ばす。
 *
 * 6 特徴量 × 6 コース = 36 個のどれか 1 つでも欠けている行は 気象pt を再現
 * できないので落とす（欠損を 0 として扱うと「この気象は効かない」という嘘に
 * なるため）。
 */
export const parseSuiParams = (csvText: string): SuiParamsRow[] => {
  const rows: SuiParamsRow[] = [];
  for (const row of parseCsv(csvText)) {
    const stadiumName = (row["stadium"] ?? "").trim();
    if (stadiumName === "") continue;

    const coefs = {} as Record<WeatherFeatureKey, CourseCoefs>;
    let complete = true;
    for (const key of WEATHER_FEATURE_KEYS) {
      const values = [1, 2, 3, 4, 5, 6].map((c) =>
        toNumberOrNull(row[`${SUI_PARAMS_COLUMN[key]}_c${c}`]),
      );
      if (values.some((v) => v === null)) {
        complete = false;
        break;
      }
      coefs[key] = values as unknown as CourseCoefs;
    }
    if (!complete) continue;

    rows.push({ stadiumName, coefs });
  }
  return rows;
};

// === weights CSV (estimate/stadium/weights/{predictor_id}/YYYY-MM.csv) ===

/**
 * 場別重み CSV から 1 成分ぶんの μ / σ / w を取り出す。24 場 = 24 行。
 *
 * 列は `stadium,n_samples,mu_waku,sigma_waku,...,w_waku,...` のように
 * `{mu,sigma,w}_{component}` が成分ごとに並ぶ。その成分を持たない予想者の
 * weights ファイルには当該列が無いので、その行は落とす。
 */
export const parseStadiumComponentWeights = (
  csvText: string,
  component: StadiumWeightsComponent,
): StadiumComponentWeightsRow[] => {
  const rows: StadiumComponentWeightsRow[] = [];
  for (const row of parseCsv(csvText)) {
    const stadiumName = (row["stadium"] ?? "").trim();
    const mu = toNumberOrNull(row[`mu_${component}`]);
    const sigma = toNumberOrNull(row[`sigma_${component}`]);
    const weight = toNumberOrNull(row[`w_${component}`]);
    if (stadiumName === "" || mu === null || sigma === null || weight === null) continue;

    rows.push({ stadiumName, mu, sigma, weight });
  }
  return rows;
};
