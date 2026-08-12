import type { TokutenHayamiIfRank, TokutenHayamiRacer, TokutenHayamiRow } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const BOAT_COUNT = 6;
const RANK_COUNT = 6;

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

const stripRSuffix = (raw: string | undefined): number => {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9]/g, "");
  return cleaned ? Number(cleaned) : 0;
};

/** 数値セル。空欄・非数値（賞除 / 欠場 など）は null */
const toNumberOrNull = (v: string | undefined): number | null => {
  const raw = (v ?? "").trim();
  if (raw === "") return null;
  const num = Number(raw);
  return Number.isNaN(num) ? null : num;
};

const toNumber = (v: string | undefined): number => toNumberOrNull(v) ?? 0;

// === tokuten_hayami CSV (previews/tokuten_hayami) ===

const parseIfRank = (
  row: Record<string, string>,
  slot: number,
  k: number,
): TokutenHayamiIfRank => ({
  rank: k,
  scoreRate: toNumberOrNull(row[`艇${slot}_${k}着時得点率`]),
  status: toNumberOrNull(row[`艇${slot}_${k}着時状態`]),
});

const parseRacer = (row: Record<string, string>, slot: number): TokutenHayamiRacer => {
  const ifRanks: TokutenHayamiIfRank[] = [];
  for (let k = 1; k <= RANK_COUNT; k++) {
    ifRanks.push(parseIfRank(row, slot, k));
  }
  const scoreRateLabel = (row[`艇${slot}_得点率`] ?? "").trim();
  // ボーダー状態は "00" / "01"。末尾が 1 のとき 順位 <= ボーダー順位。
  const borderStatus = (row[`艇${slot}_ボーダー状態`] ?? "").trim();
  return {
    boatNumber: slot,
    classGrade: (row[`艇${slot}_級別`] ?? "").trim(),
    registrationNumber: toNumber(row[`艇${slot}_登録番号`]),
    racerName: (row[`艇${slot}_選手名`] ?? "").trim(),
    // 賞除 / 欠場 / 帰郷 / 追配 は数値にならないので null + ラベルで持つ
    scoreRate: toNumberOrNull(scoreRateLabel),
    scoreRateLabel,
    rank: toNumberOrNull(row[`艇${slot}_順位`]),
    withinBorder: borderStatus.endsWith("1"),
    otherRaceNumber: toNumberOrNull(row[`艇${slot}_早見`]),
    ifRanks,
  };
};

const parseTokutenHayamiRow = (row: Record<string, string>): TokutenHayamiRow => {
  const racers: TokutenHayamiRacer[] = [];
  for (let i = 1; i <= BOAT_COUNT; i++) {
    racers.push(parseRacer(row, i));
  }
  const rankPoints: (number | null)[] = [];
  for (let k = 1; k <= RANK_COUNT; k++) {
    rankPoints.push(toNumberOrNull(row[`${k}着点`]));
  }
  return {
    raceCode: row["レースコード"] ?? "",
    raceDate: row["レース日"] ?? "",
    stadiumId: row["レース場"] ?? "",
    raceNumber: stripRSuffix(row["レース回"]),
    borderRank: toNumberOrNull(row["ボーダー順位"]),
    rankPoints,
    racers,
  };
};

/** tokuten_hayami CSV (previews/tokuten_hayami) をパースする。 */
export const parseTokutenHayami = (csvText: string): TokutenHayamiRow[] =>
  parseCsv(csvText).map(parseTokutenHayamiRow);
