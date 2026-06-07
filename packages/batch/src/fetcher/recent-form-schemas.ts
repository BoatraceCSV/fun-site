import type { RecentFormBoat, RecentFormRow, RecentFormSession } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const BOAT_COUNT = 6;
const SESSION_COUNT = 5;

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

const stripRSuffix = (raw: string | undefined): number => {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9]/g, "");
  return cleaned ? Number(cleaned) : 0;
};

const toNumber = (v: string | undefined): number => {
  if (v === undefined || v === "") return 0;
  const num = Number(v);
  return Number.isNaN(num) ? 0 : num;
};

// === recent_national / recent_local CSV（同一スキーマ） ===

const parseSession = (row: Record<string, string>, slot: number, k: number): RecentFormSession => {
  const p = `艇${slot}_前${k}節_`;
  return {
    startDate: (row[`${p}開始日`] ?? "").trim(),
    endDate: (row[`${p}終了日`] ?? "").trim(),
    stadiumCode: (row[`${p}場コード`] ?? "").trim(),
    stadiumName: (row[`${p}場名`] ?? "").trim(),
    grade: (row[`${p}グレード`] ?? "").trim(),
    ranks: (row[`${p}着順列`] ?? "").trim(),
  };
};

const parseRecentFormBoat = (row: Record<string, string>, slot: number): RecentFormBoat => {
  const sessions: RecentFormSession[] = [];
  for (let k = 1; k <= SESSION_COUNT; k++) {
    sessions.push(parseSession(row, slot, k));
  }
  return {
    boatNumber: slot,
    registrationNumber: toNumber(row[`艇${slot}_登録番号`]),
    racerName: (row[`艇${slot}_選手名`] ?? "").trim(),
    sessions,
  };
};

const parseRecentFormRow = (row: Record<string, string>): RecentFormRow => {
  const boats: RecentFormBoat[] = [];
  for (let i = 1; i <= BOAT_COUNT; i++) {
    boats.push(parseRecentFormBoat(row, i));
  }
  return {
    raceCode: row["レースコード"] ?? "",
    raceDate: row["レース日"] ?? "",
    stadiumId: row["レース場コード"] ?? "",
    raceNumber: stripRSuffix(row["レース回"]),
    boats,
  };
};

/**
 * recent_national / recent_local CSV をパースする。
 * 両 CSV はスキーマが完全一致するため同一関数を共用する。
 */
export const parseRecentForm = (csvText: string): RecentFormRow[] =>
  parseCsv(csvText).map(parseRecentFormRow);
