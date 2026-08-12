import type { Waku10Boat, Waku10Row, Waku10Run } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const BOAT_COUNT = 6;
const RUN_COUNT = 10;

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

// === waku10 CSV (programs/waku10) ===

/**
 * `艇N_過去{k}走_{着順,進入,グレード}` を 1 走分に詰める。
 * 進入は空欄 = 枠なり進入なので 0 のままにして、表示側で枠番に読み替える。
 */
const parseRun = (row: Record<string, string>, slot: number, k: number): Waku10Run => {
  const p = `艇${slot}_過去${k}走_`;
  return {
    rank: (row[`${p}着順`] ?? "").trim(),
    entryCourse: toNumber((row[`${p}進入`] ?? "").trim()),
    grade: (row[`${p}グレード`] ?? "").trim(),
  };
};

const parseWaku10Boat = (row: Record<string, string>, slot: number): Waku10Boat => {
  const runs: Waku10Run[] = [];
  for (let k = 1; k <= RUN_COUNT; k++) {
    runs.push(parseRun(row, slot, k));
  }
  return {
    boatNumber: slot,
    racerName: (row[`艇${slot}_選手名`] ?? "").trim(),
    winRate: toNumber(row[`艇${slot}_枠番別勝率`]),
    avgST: toNumber(row[`艇${slot}_枠番別平均ST`]),
    avgStartOrder: toNumber(row[`艇${slot}_枠番別平均スタート順`]),
    runs,
  };
};

const parseWaku10Row = (row: Record<string, string>): Waku10Row => {
  const boats: Waku10Boat[] = [];
  for (let i = 1; i <= BOAT_COUNT; i++) {
    boats.push(parseWaku10Boat(row, i));
  }
  return {
    raceCode: row["レースコード"] ?? "",
    raceDate: row["レース日"] ?? "",
    stadiumId: row["レース場コード"] ?? "",
    raceNumber: stripRSuffix(row["レース回"]),
    boats,
  };
};

/** waku10 CSV (programs/waku10) をパースする。 */
export const parseWaku10 = (csvText: string): Waku10Row[] => parseCsv(csvText).map(parseWaku10Row);
