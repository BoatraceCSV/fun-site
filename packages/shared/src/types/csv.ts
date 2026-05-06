/** BoatraceCSV 由来の型定義 */

/**
 * 出走表メタ情報 (programs/title CSV) - レース行
 *
 * `data/programs/title/YYYY/MM/DD.csv` 由来。
 * レース名・タイトル・締切時刻などのメタ情報専用。出走表本体（選手・モーター）は
 * race_cards CSV (RaceCardRow) を参照する。
 */
export type TitleRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly stadium: string;
  readonly raceNumber: number;
  readonly title: string;
  readonly dayNumber: number;
  readonly grade: string;
  readonly isNighter: boolean;
  readonly raceName: string;
  readonly votingDeadline: string;
  readonly cancellationStatus: string;
};

/** レース結果 - 配当情報 */
export type PayoutEntry = {
  readonly combination: string;
  readonly payout: number;
};

/** レース結果 - 配当一覧 */
export type ResultPayouts = {
  readonly win: PayoutEntry;
  readonly place: readonly PayoutEntry[];
  readonly exacta: PayoutEntry;
  readonly quinella: PayoutEntry;
  readonly quinellaPlace: readonly PayoutEntry[];
  readonly trifecta: PayoutEntry;
  readonly trio: PayoutEntry;
};

/** レース結果 - 着順別データ */
export type ResultPosition = {
  readonly position: number;
  readonly boatNumber: number;
  readonly registrationNumber: number;
  readonly racerName: string;
  readonly motorNumber: number;
  readonly boatBodyNumber: number;
  readonly exhibitionTime: number;
  readonly courseNumber: number;
  readonly startTiming: number;
  readonly raceTime: number;
};

/** レース結果 - レース行 */
export type ResultRow = {
  readonly raceCode: string;
  readonly title: string;
  readonly dayNumber: number;
  readonly raceDate: string;
  readonly stadium: string;
  readonly raceNumber: number;
  readonly raceName: string;
  readonly distance: number;
  readonly weather: string;
  readonly windDirection: string;
  readonly windSpeed: number;
  readonly waveHeight: number;
  readonly technique: string;
  readonly payouts: ResultPayouts;
  readonly positions: readonly ResultPosition[];
};

/**
 * 的中確認 - レース行
 *
 * 元 CSV (`confirmations/YYYY/MM/DD.csv`) は生成停止済みだが、
 * web/src/data/confirmations/*.json として書き出された過去分を
 * web 側で読み込むため型は残置している。
 */
export type ConfirmationRow = {
  readonly raceCode: string;
  readonly predicted1st: number;
  readonly actual1st: number;
  readonly predicted2nd: number;
  readonly actual2nd: number;
  readonly predicted3rd: number;
  readonly actual3rd: number;
  readonly hit1st: boolean;
  readonly hit2nd: boolean;
  readonly hit3rd: boolean;
  readonly hitAll: boolean;
  readonly predictedTechnique: string;
  readonly actualTechnique: string;
  readonly hitTechnique: boolean;
  readonly courseMatchCount: number;
  readonly courseExactMatch: boolean;
  readonly stMAE: number;
};
