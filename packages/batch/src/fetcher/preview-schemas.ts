import type { SuiRow, TkzBoat, TkzRow } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const BOAT_COUNT = 6;

const toNumber = (v: string | undefined): number => {
  if (v === undefined || v === "") return 0;
  const num = Number(v);
  return Number.isNaN(num) ? 0 : num;
};

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

const stripRSuffix = (raw: string | undefined): number => {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9]/g, "");
  return cleaned ? Number(cleaned) : 0;
};

// === tkz CSV (previews/tkz) — 体重・展示タイム・チルト ===

const parseTkzBoat = (row: Record<string, string>, slot: number): TkzBoat => ({
  boatNumber: slot,
  weightKg: toNumber(row[`艇${slot}_体重(kg)`]),
  weightAdjustKg: toNumber(row[`艇${slot}_体重調整(kg)`]),
  exhibitionTime: toNumber(row[`艇${slot}_展示タイム`]),
  tilt: toNumber(row[`艇${slot}_チルト`]),
});

const parseTkzRow = (row: Record<string, string>): TkzRow => {
  const boats: TkzBoat[] = [];
  for (let i = 1; i <= BOAT_COUNT; i++) {
    boats.push(parseTkzBoat(row, i));
  }
  return {
    raceCode: row["レースコード"] ?? "",
    raceDate: row["レース日"] ?? "",
    stadiumId: row["レース場"] ?? "",
    raceNumber: stripRSuffix(row["レース回"]),
    votingDeadline: row["締切時刻"] ?? "",
    fetchedAt: row["取得日時"] ?? "",
    boats,
  };
};

export const parseTkz = (csvText: string): TkzRow[] => parseCsv(csvText).map(parseTkzRow);

// === sui CSV (previews/sui) — 水面気象スナップショット ===

const parseSuiRow = (row: Record<string, string>): SuiRow => ({
  raceCode: row["レースコード"] ?? "",
  raceDate: row["レース日"] ?? "",
  stadiumId: row["レース場"] ?? "",
  raceNumber: stripRSuffix(row["レース回"]),
  votingDeadline: row["締切時刻"] ?? "",
  fetchedAt: row["取得日時"] ?? "",
  observedAt: (row["気象観測時刻"] ?? "").trim(),
  windSpeed: toNumber(row["風速(m)"]),
  windDirection: (row["風向"] ?? "").trim(),
  waveHeight: toNumber(row["波の高さ(cm)"]),
  weather: (row["天候"] ?? "").trim(),
  airTemperature: toNumber(row["気温(℃)"]),
  waterTemperature: toNumber(row["水温(℃)"]),
});

export const parseSui = (csvText: string): SuiRow[] => parseCsv(csvText).map(parseSuiRow);
