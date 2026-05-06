import type { IndexState } from "./race-card.js";

/** 出走表に表示する選手情報（race_cards 由来の主要項目を集約） */
export type RaceRacer = {
  readonly boatNumber: number;
  readonly registrationNumber: number;
  readonly racerName: string;
  readonly classGrade: string;
  readonly age: number;
  readonly branch: string;
  readonly nationalAvgST: number;
  readonly nationalWinRate: number;
  readonly nationalTop2Rate: number;
  readonly localWinRate: number;
  readonly localTop2Rate: number;
  readonly motorNumber: number;
  readonly motorTop2Rate: number;
};

/** スタート予想 - 1艇分のエントリ */
export type StartPredictionEntry = {
  /** 枠番 (1-6) */
  readonly boatNumber: number;
  /** 進入コース (1-6)。stt 未取得時は枠番と同一 */
  readonly courseNumber: number;
  /** スタートタイミング = race_cards の全国平均ST */
  readonly startTiming: number;
};

/** スタート予想全体 */
export type StartPrediction = {
  /** stt CSV から進入コースを取得できたか。false の場合は枠番=コースの仮表示 */
  readonly fromExhibition: boolean;
  /** 進入コース順に並んだエントリ */
  readonly entries: readonly StartPredictionEntry[];
};

/** AI 評価の寄与pt 内訳 */
export type AiEvaluationContribution = {
  readonly frame: number;
  readonly racer: number;
  readonly motor: number;
  /** 状態 daily の場合は 0 として扱う */
  readonly exhibition: number;
  /** 状態 daily の場合は 0 として扱う */
  readonly weather: number;
};

/** AI 評価 - 1枠分 */
export type AiEvaluationEntry = {
  readonly boatNumber: number;
  readonly contribution: AiEvaluationContribution;
  /** 強さpt（合計値の参考） */
  readonly strengthPt: number;
};

/** AI による総合評価（index CSV 由来） */
export type AiEvaluation = {
  readonly state: IndexState;
  readonly entries: readonly AiEvaluationEntry[];
};

/** レース予想（新スキーマ） */
export type RacePrediction = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly stadiumName: string;
  readonly raceNumber: number;
  readonly raceName: string;
  readonly raceTitle: string;
  readonly votingDeadline: string;
  readonly racers: readonly RaceRacer[];
  readonly startPrediction: StartPrediction;
  readonly aiEvaluation: AiEvaluation;
  readonly generatedAt: string;
};
