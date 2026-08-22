import type {
  CourseRates,
  StadiumWakuWeightsRow,
  WakuSeason,
  WakuTableRow,
} from "@fun-site/shared";
import { WAKU_SEASONS } from "@fun-site/shared";
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

// === weights CSV (estimate/stadium/weights/{predictor_id}/YYYY-MM.csv) ===

/**
 * 場別重み CSV から 枠番pt (`waku` 成分) ぶんだけを取り出す。24 場 = 24 行。
 *
 * 列は `stadium,n_samples,mu_waku,sigma_waku,...,w_waku,...`。`waku` 成分を
 * 持たない予想者の weights ファイルには `mu_waku` 等が無いので、その行は落とす。
 */
export const parseStadiumWakuWeights = (csvText: string): StadiumWakuWeightsRow[] => {
  const rows: StadiumWakuWeightsRow[] = [];
  for (const row of parseCsv(csvText)) {
    const stadiumName = (row["stadium"] ?? "").trim();
    const mu = toNumberOrNull(row["mu_waku"]);
    const sigma = toNumberOrNull(row["sigma_waku"]);
    const weight = toNumberOrNull(row["w_waku"]);
    if (stadiumName === "" || mu === null || sigma === null || weight === null) continue;

    rows.push({ stadiumName, mu, sigma, weight });
  }
  return rows;
};
