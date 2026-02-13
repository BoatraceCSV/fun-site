import type {
  ConfirmationRow,
  EstimateBoat,
  EstimateRow,
  PredictionPreviewBoat,
  PredictionPreviewRow,
  ProgramBoat,
  ProgramRow,
  ResultPayouts,
  ResultPosition,
  ResultRow,
} from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const BOAT_COUNT = 6;

const toNumber = (v: string | undefined): number => {
  if (v === undefined || v === "") return 0;
  const num = Number(v);
  return Number.isNaN(num) ? 0 : num;
};

const toBoolean = (v: string | undefined): boolean =>
  v !== "×" && v !== "-" && v !== "" && v !== undefined;

// === Programs CSV パーサー ===

const parseProgramBoat = (row: Record<string, string>, slot: number): ProgramBoat => {
  const p = (field: string) => row[`${slot}枠_${field}`] ?? "";
  const results: string[] = [];
  for (let r = 1; r <= BOAT_COUNT; r++) {
    const val1 = p(`今節成績_${r}-1`);
    const val2 = p(`今節成績_${r}-2`);
    if (val1) results.push(`${val1}-${val2}`);
  }

  return {
    boatNumber: toNumber(p("艇番")),
    registrationNumber: toNumber(p("登録番号")),
    racerName: p("選手名").trim(),
    age: toNumber(p("年齢")),
    branch: p("支部").trim(),
    weight: toNumber(p("体重")),
    rank: p("級別").trim(),
    nationalWinRate: toNumber(p("全国勝率")),
    nationalTop2Rate: toNumber(p("全国2連対率")),
    localWinRate: toNumber(p("当地勝率")),
    localTop2Rate: toNumber(p("当地2連対率")),
    motorNumber: toNumber(p("モーター番号")),
    motorTop2Rate: toNumber(p("モーター2連対率")),
    boatBodyNumber: toNumber(p("ボート番号")),
    boatTop2Rate: toNumber(p("ボート2連対率")),
    currentResults: results,
  };
};

const parseProgramRow = (row: Record<string, string>): ProgramRow => {
  const boats: ProgramBoat[] = [];
  for (let i = 1; i <= BOAT_COUNT; i++) {
    boats.push(parseProgramBoat(row, i));
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
    votingDeadline: row["電話投票締切予定"] ?? "",
    boats,
  };
};

// === Prediction Previews CSV パーサー ===

const parsePredictionPreviewBoat = (
  row: Record<string, string>,
  boatNum: number,
): PredictionPreviewBoat => {
  const p = (field: string) => row[`艇${boatNum}_${field}`] ?? "";
  return {
    boatNumber: toNumber(p("艇番")) || boatNum,
    predictedCourse: toNumber(p("コース")),
    predictedStartTiming: toNumber(p("スタート展示")),
    predictedTilt: toNumber(p("チルト調整")),
    predictedExhibitionTime: toNumber(p("展示タイム")),
  };
};

const parsePredictionPreviewRow = (row: Record<string, string>): PredictionPreviewRow => {
  const boats: PredictionPreviewBoat[] = [];
  for (let i = 1; i <= BOAT_COUNT; i++) {
    boats.push(parsePredictionPreviewBoat(row, i));
  }

  const raceNumRaw = row["レース回"] ?? "";
  return {
    raceCode: row["レースコード"] ?? "",
    raceDate: row["レース日"] ?? "",
    stadium: row["レース場"] ?? "",
    raceNumber: toNumber(raceNumRaw.replace(/[^0-9]/g, "")),
    boats,
  };
};

// === Estimates CSV パーサー ===

const parseEstimateBoat = (row: Record<string, string>, boatNum: number): EstimateBoat => ({
  boatNumber: boatNum,
  predictedCourse: toNumber(row[`艇${boatNum}_予想コース`]),
  predictedST: toNumber(row[`艇${boatNum}_予想ST`]),
});

const parseEstimateRow = (row: Record<string, string>): EstimateRow => {
  const boats: EstimateBoat[] = [];
  for (let i = 1; i <= BOAT_COUNT; i++) {
    boats.push(parseEstimateBoat(row, i));
  }

  return {
    raceCode: row["レースコード"] ?? "",
    predicted1st: toNumber(row["予想1着"]),
    predicted2nd: toNumber(row["予想2着"]),
    predicted3rd: toNumber(row["予想3着"]),
    predictedTechnique: row["予想決まり手"] ?? "",
    boats,
  };
};

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

// === Confirmations CSV パーサー ===

const parseConfirmationRow = (row: Record<string, string>): ConfirmationRow => ({
  raceCode: row["レースコード"] ?? "",
  predicted1st: toNumber(row["予想1着"]),
  actual1st: toNumber(row["実際1着"]),
  predicted2nd: toNumber(row["予想2着"]),
  actual2nd: toNumber(row["実際2着"]),
  predicted3rd: toNumber(row["予想3着"]),
  actual3rd: toNumber(row["実際3着"]),
  hit1st: toBoolean(row["1着的中"]),
  hit2nd: toBoolean(row["2着的中"]),
  hit3rd: toBoolean(row["3着的中"]),
  hitAll: toBoolean(row["全的中"]),
  predictedTechnique: row["予想決まり手"] ?? "",
  actualTechnique: row["決まり手"] ?? "",
  hitTechnique: toBoolean(row["決まり手的中"]),
  courseMatchCount: toNumber(row["コース一致数"]),
  courseExactMatch: toBoolean(row["進入完全一致"]),
  stMAE: toNumber(row["ST_MAE"]),
});

// === 公開パーサー関数 ===

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

export const parsePrograms = (csvText: string): ProgramRow[] =>
  parseCsv(csvText).map(parseProgramRow);

export const parsePredictionPreviews = (csvText: string): PredictionPreviewRow[] =>
  parseCsv(csvText).map(parsePredictionPreviewRow);

export const parseEstimates = (csvText: string): EstimateRow[] =>
  parseCsv(csvText).map(parseEstimateRow);

export const parseResults = (csvText: string): ResultRow[] => parseCsv(csvText).map(parseResultRow);

export const parseConfirmations = (csvText: string): ConfirmationRow[] =>
  parseCsv(csvText).map(parseConfirmationRow);
