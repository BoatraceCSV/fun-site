import type { MotorStatsRow } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

const toNumber = (v: string | undefined): number => {
  if (v === undefined || v === "") return 0;
  const num = Number(v);
  return Number.isNaN(num) ? 0 : num;
};

/** 空欄・非数を null にする（平均ラップ等、未算出と 0 を区別したい列向け） */
const toNumberOrNull = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const num = Number(v);
  return Number.isNaN(num) ? null : num;
};

// === motor_stats CSV (programs/motor_stats) ===

const parseMotorStatsRow = (row: Record<string, string>): MotorStatsRow => ({
  recordDate: (row["記録日"] ?? "").trim(),
  periodStartDate: (row["モーター期起算日"] ?? "").trim(),
  stadiumCode: (row["場コード"] ?? "").trim(),
  motorNumber: toNumber(row["モーター番号"]),
  winRate: toNumber(row["勝率"]),
  top2Rate: toNumber(row["2連対率"]),
  top3Rate: toNumber(row["3連対率"]),
  top3Rank: toNumber(row["3連対率順位"]),
  firstCount: toNumber(row["1着回数"]),
  starts: toNumber(row["出走数"]),
  championCount: toNumber(row["優勝回数"]),
  finalAppearances: toNumber(row["優出回数"]),
  avgLapSec: toNumberOrNull(row["平均ラップ秒"]),
  avgLapRank: toNumberOrNull(row["平均ラップ順位"]),
});

export const parseMotorStats = (csvText: string): MotorStatsRow[] =>
  parseCsv(csvText).map(parseMotorStatsRow);
