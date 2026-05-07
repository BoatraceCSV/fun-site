import type { TitleRow } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const toNumber = (v: string | undefined): number => {
  if (v === undefined || v === "") return 0;
  const num = Number(v);
  return Number.isNaN(num) ? 0 : num;
};

// === Programs/Title CSV パーサー ===

const parseTitleRow = (row: Record<string, string>): TitleRow => ({
  raceCode: row["レースコード"] ?? "",
  raceDate: row["レース日"] ?? "",
  stadiumId: row["レース場コード"] ?? "",
  stadium: row["レース場"] ?? "",
  raceNumber: toNumber(row["レース回"]?.replace(/[^0-9]/g, "")),
  title: row["タイトル"] ?? "",
  dayNumber: toNumber(row["日次"]?.replace(/[^0-9]/g, "")),
  grade: row["グレード"] ?? "",
  isNighter: (row["ナイター"] ?? "").trim() === "Y",
  raceName: row["レース名"] ?? "",
  votingDeadline: row["電話投票締切予定"] ?? "",
  cancellationStatus: row["中止状態"] ?? "",
});

// === 公開パーサー関数 ===

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

export const parseTitles = (csvText: string): TitleRow[] => parseCsv(csvText).map(parseTitleRow);
