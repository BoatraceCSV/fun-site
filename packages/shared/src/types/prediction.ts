import type { BetHitStatus } from "../utils/bet-hit.js";
import type { RaceBetPayoutSummary } from "../utils/bet-payout.js";
import type { RacePayoutRow } from "./race-payout.js";
import type { IndexState } from "./race-card.js";
import type { RaceResultRow } from "./race-result.js";

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
  /**
   * 開催日次の表示用ラベル。"最終日" / "初日" / "1日目" など、上流 CSV の生文字列。
   * 古い JSON では未設定の場合があるため、UI 側では空文字フォールバックすること。
   */
  readonly dayLabel: string;
  /**
   * レースグレードの上流コード。"SG" / "PG1" / "G1" / "G2" / "G3" / "IP" など。
   * "IP" は一般戦相当。バッジ表示判定の対象外として UI 側で扱う。
   * 古い JSON では未設定の場合があるため、UI 側では空文字フォールバックすること。
   */
  readonly grade: string;
  readonly votingDeadline: string;
  readonly racers: readonly RaceRacer[];
  readonly startPrediction: StartPrediction;
  /**
   * AI 総合評価（後方互換用）。realtime が利用可能ならそちらを、無ければ daily を採用する。
   * 1マーク予想や AI 評価チャートの既存表示はこの値を参照する。
   */
  readonly aiEvaluation: AiEvaluation;
  /**
   * 朝バッチ時点の AI 評価（直前情報反映前）。買い目「当日買い目」表示に利用する。
   * index CSV に daily 行が存在しない場合は undefined。
   */
  readonly aiEvaluationDaily?: AiEvaluation;
  /**
   * 直前情報反映後の AI 評価。買い目「直前買い目」表示に利用する。
   * index CSV に realtime 行が存在しない場合（直前情報未反映時）は undefined。
   */
  readonly aiEvaluationRealtime?: AiEvaluation;
  /**
   * realtime 結果。当該レースが確定し results/realtime CSV に行が存在する
   * 場合のみセットされる。未確定 / CSV 未取得時は undefined。
   */
  readonly raceResult?: RaceResultRow;
  /**
   * 当日買い目 / 直前買い目それぞれが結果に対して的中したか。
   * `raceResult` が無い、または 1〜3 着が揃っていない場合は両方 false。
   * 古い JSON では未設定の場合があるため、UI 側では undefined フォールバックすること。
   */
  readonly betHitStatus?: BetHitStatus;
  /**
   * realtime 払戻。当該レースが確定し results/payouts CSV に行が存在する
   * 場合のみセットされる。未確定 / CSV 未取得時は undefined。
   */
  readonly racePayout?: RacePayoutRow;
  /**
   * 当日買い目 / 直前買い目それぞれの 3連単 ベット結果（点数・賭け金・払戻）。
   * `raceResult` または `racePayout` が無い場合は payoutYen=0 / hit=false。
   * 古い JSON では未設定の場合があるため、UI 側では undefined フォールバックすること。
   */
  readonly betPayout?: RaceBetPayoutSummary;
  readonly generatedAt: string;
};
