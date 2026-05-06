import type { ResultPayouts, ResultPosition, ResultRow, TitleRow } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const BOAT_COUNT = 6;

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

// === Results CSV パーサー ===

const parseResultPosition = (row: Record<string, string>, pos: number): ResultPosition => {
  const p = (field: string) => row[`${pos}着_${field}`] ?? "";
  return {
    position: pos,
    boatNumber: toNumber(p("艇番")),
    registrationNumber: toNumber(p("登録番号")),
    racerName: p("選手名").replace(/\s+/g, ""),
    motorNumber: toNumber(p("モーター番号")),
    boatBodyNumber: toNumber(p("ボート番号")),
    exhibitionTime: toNumber(p("展示タイム")),
    courseNumber: toNumber(p("進入コース")),
    startTiming: toNumber(p("スタートタイミング")),
    raceTime: toNumber(p("レースタイム")),
  };
};

const parsePayouts = (row: Record<string, string>): ResultPayouts => ({
  win: {
    combination: row["単勝_艇番"] ?? "",
    payout: toNumber(row["単勝_払戻金"]),
  },
  place: [
    { combination: row["複勝_1着_艇番"] ?? "", payout: toNumber(row["複勝_1着_払戻金"]) },
    { combination: row["複勝_2着_艇番"] ?? "", payout: toNumber(row["複勝_2着_払戻金"]) },
  ],
  exacta: {
    combination: row["2連単_組番"] ?? "",
    payout: toNumber(row["2連単_払戻金"]),
  },
  quinella: {
    combination: row["2連複_組番"] ?? "",
    payout: toNumber(row["2連複_払戻金"]),
  },
  quinellaPlace: [
    { combination: row["拡連複_1-2着_組番"] ?? "", payout: toNumber(row["拡連複_1-2着_払戻金"]) },
    { combination: row["拡連複_1-3着_組番"] ?? "", payout: toNumber(row["拡連複_1-3着_払戻金"]) },
    { combination: row["拡連複_2-3着_組番"] ?? "", payout: toNumber(row["拡連複_2-3着_払戻金"]) },
  ],
  trifecta: {
    combination: row["3連単_組番"] ?? "",
    payout: toNumber(row["3連単_払戻金"]),
  },
  trio: {
    combination: row["3連複_組番"] ?? "",
    payout: toNumber(row["3連複_払戻金"]),
  },
});

const parseResultRow = (row: Record<string, string>): ResultRow => {
  const positions: ResultPosition[] = [];
  for (let i = 1; i <= BOAT_COUNT; i++) {
    positions.push(parseResultPosition(row, i));
  }

  return {
    raceCode: row["レースコード"] ?? "",
    title: row["タイトル"] ?? "",
    dayNumber: toNumber(row["日次"]?.replace(/[^0-9]/g, "")),
    raceDate: row["レース日"] ?? "",
    stadium: row["レース場"] ?? "",
    raceNumber: toNumber(row["レース回"]?.replace(/[^0-9]/g, "")),
    raceName: row["レース名"] ?? "",
    distance: toNumber(row["距離(m)"]),
    weather: row["天候"] ?? "",
    windDirection: row["風向"] ?? "",
    windSpeed: toNumber(row["風速(m)"]),
    waveHeight: toNumber(row["波の高さ(cm)"]),
    technique: row["決まり手"] ?? "",
    payouts: parsePayouts(row),
    positions,
  };
};

// === 公開パーサー関数 ===

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

export const parseTitles = (csvText: string): TitleRow[] => parseCsv(csvText).map(parseTitleRow);

export const parseResults = (csvText: string): ResultRow[] => parseCsv(csvText).map(parseResultRow);
