import type {
  ComponentKey,
  IndexEntry,
  IndexRow,
  IndexState,
  PredictorSpec,
  RaceCardRacer,
  RaceCardRow,
  SttBoat,
  SttRow,
} from "@fun-site/shared";
import { COMPONENT_LABELS } from "@fun-site/shared";
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

// === race_cards CSV ===

const parseRaceCardRacer = (row: Record<string, string>, slot: number): RaceCardRacer => {
  const f = (field: string) => row[`艇${slot}_${field}`] ?? "";
  return {
    boatNumber: slot,
    registrationNumber: toNumber(f("登録番号")),
    racerName: f("選手名").trim(),
    age: toNumber(f("年齢")),
    branch: f("支部").trim(),
    hometown: f("出身地").trim(),
    classGrade: f("級別").trim(),
    nationalAvgST: toNumber(f("全国平均ST")),
    nationalWinRate: toNumber(f("全国勝率")),
    nationalTop2Rate: toNumber(f("全国2連対率")),
    nationalTop3Rate: toNumber(f("全国3連対率")),
    localWinRate: toNumber(f("当地勝率")),
    localTop2Rate: toNumber(f("当地2連対率")),
    localTop3Rate: toNumber(f("当地3連対率")),
    motorNumber: toNumber(f("モーター番号")),
    motorTop2Rate: toNumber(f("モーター2連対率")),
    motorTop3Rate: toNumber(f("モーター3連対率")),
    boatBodyNumber: toNumber(f("ボート番号")),
    boatTop2Rate: toNumber(f("ボート2連対率")),
    boatTop3Rate: toNumber(f("ボート3連対率")),
  };
};

const parseRaceCardRow = (row: Record<string, string>): RaceCardRow => {
  const racers: RaceCardRacer[] = [];
  for (let i = 1; i <= BOAT_COUNT; i++) {
    racers.push(parseRaceCardRacer(row, i));
  }
  return {
    raceCode: row["レースコード"] ?? "",
    raceDate: row["レース日"] ?? "",
    stadiumId: row["レース場コード"] ?? "",
    raceNumber: stripRSuffix(row["レース回"]),
    racers,
  };
};

export const parseRaceCards = (csvText: string): RaceCardRow[] =>
  parseCsv(csvText).map(parseRaceCardRow);

// === stt CSV (previews/stt) ===

const parseSttBoat = (row: Record<string, string>, slot: number): SttBoat => ({
  boatNumber: slot,
  courseNumber: toNumber(row[`艇${slot}_コース`]),
  exhibitionStartTiming: toNumber(row[`艇${slot}_スタート展示`]),
});

const parseSttRow = (row: Record<string, string>): SttRow => {
  const boats: SttBoat[] = [];
  for (let i = 1; i <= BOAT_COUNT; i++) {
    boats.push(parseSttBoat(row, i));
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

export const parseStt = (csvText: string): SttRow[] => parseCsv(csvText).map(parseSttRow);

// === index CSV ===
//
// Index CSV のスキーマは predictor の componentKeys に依存する。
// 列名規約は boatracecsv 側 `index_columns()` と同じ:
//   - `{N}枠_{label}`        (素点)
//   - `{N}枠_寄与_{label}`    (寄与)
//   - `{N}枠_強さpt`         (合計)
// `label` は `COMPONENT_LABELS[key]` で解決。

const parseIndexEntry = (
  row: Record<string, string>,
  slot: number,
  componentKeys: readonly ComponentKey[],
): IndexEntry => {
  const f = (field: string) => row[`${slot}枠_${field}`] ?? "";
  const components: Partial<Record<ComponentKey, number>> = {};
  const contributions: Partial<Record<ComponentKey, number>> = {};
  for (const key of componentKeys) {
    const label = COMPONENT_LABELS[key];
    components[key] = toNumber(f(label));
    contributions[key] = toNumber(f(`寄与_${label}`));
  }
  return {
    boatNumber: slot,
    components,
    contributions,
    strengthPt: toNumber(f("強さpt")),
  };
};

const parseIndexRow = (row: Record<string, string>, predictor: PredictorSpec): IndexRow => {
  const entries: IndexEntry[] = [];
  for (let i = 1; i <= BOAT_COUNT; i++) {
    entries.push(parseIndexEntry(row, i, predictor.componentKeys));
  }
  const stateRaw = (row["状態"] ?? "daily").trim();
  const state: IndexState = stateRaw === "realtime" ? "realtime" : "daily";
  return {
    predictorId: predictor.id,
    raceCode: row["レースコード"] ?? "",
    raceDate: row["レース日"] ?? "",
    stadiumId: row["レース場コード"] ?? "",
    raceNumber: stripRSuffix(row["レース回"]),
    state,
    componentKeys: predictor.componentKeys,
    entries,
  };
};

/**
 * 予想者 `predictor` の index CSV をパースする。
 * 列名は `predictor.componentKeys` から動的に組み立てる。
 */
export const parseIndex = (csvText: string, predictor: PredictorSpec): IndexRow[] =>
  parseCsv(csvText).map((row) => parseIndexRow(row, predictor));
