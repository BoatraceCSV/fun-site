import type {
  MotorPtBaselineRow,
  MotorPtGradeBucket,
  MotorPtMotorRow,
  MotorPtRunRow,
} from "@fun-site/shared";
import { parse } from "csv-parse/sync";

/**
 * モーターpt 素点の内訳 CSV (`estimate/motor_pt/{runs,motors,baseline}`) のパーサ。
 * 上流スキーマ: BoatraceCSV `docs/data/motor_pt.md`
 */

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

const toNumber = (v: string | undefined): number => {
  if (v === undefined || v.trim() === "") return 0;
  const num = Number(v);
  return Number.isNaN(num) ? 0 : num;
};

/**
 * 空欄を null にする。motors CSV は履歴ゼロのモーターの集計列を空欄で出すので、
 * 0 と「そもそも計算できていない」を区別する必要がある。
 */
const toNumberOrNull = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const num = Number(v);
  return Number.isNaN(num) ? null : num;
};

/** 場コードは "01"〜"24" の 2 桁。Excel 等で先頭 0 が落ちた CSV も一応拾う */
const toStadiumCode = (v: string | undefined): string => (v ?? "").trim().padStart(2, "0");

/**
 * グレード分類。上流は `SG_G1` / `G2_G3_一般` / `全` の 3 値しか出さないが、
 * 未知の値が来たら `全`（B1・B2 の分類）に倒す — スコア表の行が引けなくなるより
 * 素点の内訳が 1 段粗く出るほうがマシなため。
 */
const toBucket = (v: string | undefined): MotorPtGradeBucket => {
  const s = (v ?? "").trim();
  return s === "SG_G1" || s === "G2_G3_一般" || s === "全" ? s : "全";
};

// === runs/YYYY/MM/DD.csv (1 走 1 行) ===

const parseRunRow = (row: Record<string, string>): MotorPtRunRow => ({
  recordDate: (row["記録日"] ?? "").trim(),
  stadiumCode: toStadiumCode(row["場コード"]),
  motorNumber: toNumber(row["モーター番号"]),
  sessionIndex: toNumber(row["節"]),
  sessionEnd: (row["節最終日"] ?? "").trim(),
  raceDate: (row["走行日"] ?? "").trim(),
  day: toNumber(row["日次"]),
  run: toNumber(row["走"]),
  racerClass: (row["級別"] ?? "").trim(),
  bucket: toBucket(row["グレード分類"]),
  entryCourse: toNumber(row["進入"]),
  finish: (row["着順"] ?? "").trim(),
  rawScore: toNumber(row["生得点"]),
  cellMu: toNumber(row["セルμ"]),
  cellSigma: toNumber(row["セルσ"]),
  residual: toNumber(row["残差z"]),
  weight: toNumber(row["減衰重み"]),
});

export const parseMotorPtRuns = (csvText: string): MotorPtRunRow[] =>
  parseCsv(csvText).map(parseRunRow);

// === motors/YYYY/MM/DD.csv (1 モーター 1 行) ===

const parseMotorRow = (row: Record<string, string>): MotorPtMotorRow => ({
  recordDate: (row["記録日"] ?? "").trim(),
  stadiumCode: toStadiumCode(row["場コード"]),
  motorNumber: toNumber(row["モーター番号"]),
  sessionCount: toNumber(row["節数"]),
  runCount: toNumber(row["走数"]),
  sumW: toNumberOrNull(row["Σw"]),
  sumW2: toNumberOrNull(row["Σw2"]),
  nEff: toNumberOrNull(row["n_eff"]),
  meanResidual: toNumberOrNull(row["加重平均残差"]),
  rawPt: toNumberOrNull(row["素点"]),
});

export const parseMotorPtMotors = (csvText: string): MotorPtMotorRow[] =>
  parseCsv(csvText).map(parseMotorRow);

// === baseline/YYYY/MM/DD.csv (コース補正セル) ===

const parseBaselineRow = (row: Record<string, string>): MotorPtBaselineRow => ({
  recordDate: (row["記録日"] ?? "").trim(),
  racerClass: (row["級別"] ?? "").trim(),
  bucket: toBucket(row["グレード分類"]),
  entryCourse: toNumber(row["進入"]),
  mu: toNumber(row["μ"]),
  sigma: toNumber(row["σ"]),
  sampleCount: toNumber(row["サンプル数"]),
});

export const parseMotorPtBaseline = (csvText: string): MotorPtBaselineRow[] =>
  parseCsv(csvText).map(parseBaselineRow);
