/** BoatraceCSV 由来の型定義 */

/** 出走表 - 艇別データ */
export type ProgramBoat = {
  readonly boatNumber: number;
  readonly registrationNumber: number;
  readonly racerName: string;
  readonly age: number;
  readonly branch: string;
  readonly weight: number;
  readonly rank: string;
  readonly nationalWinRate: number;
  readonly nationalTop2Rate: number;
  readonly localWinRate: number;
  readonly localTop2Rate: number;
  readonly motorNumber: number;
  readonly motorTop2Rate: number;
  readonly boatBodyNumber: number;
  readonly boatTop2Rate: number;
  readonly currentResults: readonly string[];
};

/** 出走表 - レース行 */
export type ProgramRow = {
  readonly raceCode: string;
  readonly title: string;
  readonly dayNumber: number;
  readonly raceDate: string;
  readonly stadium: string;
  readonly raceNumber: number;
  readonly raceName: string;
  readonly distance: number;
  readonly votingDeadline: string;
  readonly boats: readonly ProgramBoat[];
};

/** ML展示会予測 - 艇別データ */
export type PredictionPreviewBoat = {
  readonly boatNumber: number;
  readonly predictedCourse: number;
  readonly predictedStartTiming: number;
  readonly predictedTilt: number;
  readonly predictedExhibitionTime: number;
};

/** ML展示会予測 - レース行 */
export type PredictionPreviewRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadium: string;
  readonly raceNumber: number;
  readonly boats: readonly PredictionPreviewBoat[];
};

/** ML着順予想 - 艇別データ */
export type EstimateBoat = {
  readonly boatNumber: number;
  readonly predictedCourse: number;
  readonly predictedST: number;
};

/** ML着順予想 - レース行 */
export type EstimateRow = {
  readonly raceCode: string;
  readonly predicted1st: number;
  readonly predicted2nd: number;
  readonly predicted3rd: number;
  readonly predictedTechnique: string;
  readonly boats: readonly EstimateBoat[];
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

/** 的中確認 - レース行 */
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
