/**
 * @deprecated 旧スキーマ（AI画像生成パイプライン用）。
 * 新スキーマ移行に伴い `packages/web` からは参照されなくなったが、
 * 旧 batch コード（predictor / image-generator / quality-checker）の
 * 型チェックを通すために型定義のみ残置している。
 */

import type { ProgramBoat } from "./csv.js";

export type WinningTechnique = "nige" | "sashi" | "makuri" | "makuri-sashi" | "nuki" | "megumare";

export type FormationPattern = "flat" | "inner-late" | "middle-late" | "outer-late";

export type ImageType = "generated" | "svg-fallback";

export type StartFormationEntry = {
  readonly boatNumber: number;
  readonly courseNumber: number;
  readonly predictedST: number;
};

export type StartFormation = {
  readonly entries: readonly StartFormationEntry[];
  readonly pattern: FormationPattern;
};

export type AiPrediction = {
  readonly startFormation: StartFormation;
  readonly firstTurnScenario: string;
  readonly predictedTechnique: WinningTechnique;
  readonly predictedOrder: readonly number[];
  readonly confidence: number;
  readonly narrative: string;
  readonly suggestedBets: readonly string[];
};

export type MlPrediction = {
  readonly first: number;
  readonly second: number;
  readonly third: number;
  readonly technique: string;
};

export type LegacyRacePrediction = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadium: string;
  readonly raceNumber: number;
  readonly boats: readonly ProgramBoat[];
  readonly mlPrediction: MlPrediction;
  readonly aiPrediction: AiPrediction;
  readonly imageUrl: string;
  readonly ogImageUrl: string;
  readonly imageType: ImageType;
  readonly createdAt: string;
};

export type MlAccuracy = {
  readonly hit1st: number;
  readonly hitAll: number;
  readonly hitTechnique: number;
  readonly avgCourseMatch: number;
  readonly avgSTMAE: number;
};

export type AiAccuracy = {
  readonly hit1st: number;
  readonly hitTrifecta: number;
  readonly hitTechnique: number;
};

export type AccuracyStats = {
  readonly period: string;
  readonly totalRaces: number;
  readonly ml: MlAccuracy;
  readonly ai: AiAccuracy;
};
