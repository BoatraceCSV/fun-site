/** AI展開予想関連の型定義 */

/** 決まり手 */
export type WinningTechnique = "nige" | "sashi" | "makuri" | "makuri-sashi" | "nuki" | "megumare";

/** スリット隊形パターン */
export type FormationPattern = "flat" | "inner-late" | "outer-late";

/** 画像タイプ */
export type ImageType = "generated" | "svg-fallback";

/** スタート隊形エントリー */
export type StartFormationEntry = {
  readonly boatNumber: number;
  readonly courseNumber: number;
  readonly predictedST: number;
};

/** スタート隊形 */
export type StartFormation = {
  readonly entries: readonly StartFormationEntry[];
  readonly pattern: FormationPattern;
};

/** AI展開予想（Gemini 3 Pro分析結果） */
export type AiPrediction = {
  readonly startFormation: StartFormation;
  readonly firstTurnScenario: string;
  readonly predictedTechnique: WinningTechnique;
  readonly predictedOrder: readonly number[];
  readonly confidence: number;
  readonly narrative: string;
  readonly suggestedBets: readonly string[];
};

/** ML予測（Estimates由来） */
export type MlPrediction = {
  readonly first: number;
  readonly second: number;
  readonly third: number;
  readonly technique: string;
};

/** レース予想全体 */
export type RacePrediction = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadium: string;
  readonly raceNumber: number;
  readonly boats: readonly import("./csv.js").ProgramBoat[];
  readonly mlPrediction: MlPrediction;
  readonly aiPrediction: AiPrediction;
  readonly imageUrl: string;
  readonly ogImageUrl: string;
  readonly imageType: ImageType;
  readonly createdAt: string;
};

/** ML予測の的中率統計 */
export type MlAccuracy = {
  readonly hit1st: number;
  readonly hitAll: number;
  readonly hitTechnique: number;
  readonly avgCourseMatch: number;
  readonly avgSTMAE: number;
};

/** AI予想の的中率統計 */
export type AiAccuracy = {
  readonly hit1st: number;
  readonly hitTrifecta: number;
  readonly hitTechnique: number;
};

/** 的中実績統計 */
export type AccuracyStats = {
  readonly period: string;
  readonly totalRaces: number;
  readonly ml: MlAccuracy;
  readonly ai: AiAccuracy;
};
