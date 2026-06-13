/**
 * 節間成績の 1 スロット（race_cards CSV の `艇N_節D{day}走{run}_*`）。
 *
 * 今節の各走の進入・枠・ST・着順を構造化したもの。14 スロット
 * (7 日 × 2 走) を時系列順（1日目1走→…→7日目2走）に並べる。
 * 未出走スロットは `rank === ""` かつ `race === 0`。
 */
export type SessionResultSlot = {
  /** 開催日次 (1-7) */
  readonly day: number;
  /** その日の何走目か (1-2) */
  readonly run: number;
  /** 出走したレース番号 (R番号)。未出走は 0 */
  readonly race: number;
  /** 実際の進入コース (1-6)。未出走/不明は 0 */
  readonly entryCourse: number;
  /** 枠番 (1-6)。未出走/不明は 0 */
  readonly lane: number;
  /** スタートタイミング。負値はフライング。未計測は null */
  readonly st: number | null;
  /**
   * 着順または特殊トークン。半角 1〜6 / F / L / 欠 / 転 / 妨 / 落 / エ / 不。
   * 未出走は空文字。
   */
  readonly rank: string;
};

/** race_cards CSV 由来の選手情報 */
export type RaceCardRacer = {
  readonly boatNumber: number;
  readonly registrationNumber: number;
  readonly racerName: string;
  readonly age: number;
  readonly branch: string;
  readonly hometown: string;
  readonly classGrade: string;
  /** 賞金除外（補欠出走等）。CSV `賞除` 列が該当のとき true */
  readonly prizeExcluded: boolean;
  /** フライング累積本数 */
  readonly flyingCount: number;
  /** 出遅れ累積本数 */
  readonly lateCount: number;
  readonly nationalAvgST: number;
  readonly nationalWinRate: number;
  readonly nationalTop2Rate: number;
  readonly nationalTop3Rate: number;
  readonly localWinRate: number;
  readonly localTop2Rate: number;
  readonly localTop3Rate: number;
  readonly motorNumber: number;
  readonly motorTop2Rate: number;
  readonly motorTop3Rate: number;
  readonly boatBodyNumber: number;
  readonly boatTop2Rate: number;
  readonly boatTop3Rate: number;
  /** 節間成績 14 スロット（時系列順）。未出走スロットも含む */
  readonly sessionResults: readonly SessionResultSlot[];
};

/** race_cards CSV 由来のレース行 */
export type RaceCardRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  readonly racers: readonly RaceCardRacer[];
};

/** stt CSV 由来の艇別データ */
export type SttBoat = {
  readonly boatNumber: number;
  readonly courseNumber: number;
  readonly exhibitionStartTiming: number;
};

/** stt CSV 由来のレース行（直前情報・スタート展示） */
export type SttRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  readonly votingDeadline: string;
  readonly fetchedAt: string;
  readonly boats: readonly SttBoat[];
};

import type { ComponentKey } from "../predictors.js";

/** index CSV の状態（realtime: 直前情報反映済み / daily: 朝バッチ時点） */
export type IndexState = "realtime" | "daily";

/**
 * index CSV 由来の枠別 AI 評価。
 *
 * 採用成分は predictor によって異なる(現状は `v1_basic`・`v2_tenkai` とも
 * 5 成分)。`components` / `contributions` は
 * `predictor.componentKeys` をキーに持つ。
 */
export type IndexEntry = {
  readonly boatNumber: number;
  /** 成分pt(素点、偏差値スケール 50±10)。キーは ComponentKey。 */
  readonly components: Readonly<Partial<Record<ComponentKey, number>>>;
  /** 寄与pt = w × 成分pt。キーは ComponentKey。 */
  readonly contributions: Readonly<Partial<Record<ComponentKey, number>>>;
  /** 寄与の総和(強さpt)。 */
  readonly strengthPt: number;
};

/** index CSV 由来のレース行 */
export type IndexRow = {
  /** 由来予想者の ID(`v1_basic` / `v2_tenkai` / ...)。 */
  readonly predictorId: string;
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  readonly state: IndexState;
  /** この行で値を持つ成分キー(predictor.componentKeys と一致)。 */
  readonly componentKeys: readonly ComponentKey[];
  readonly entries: readonly IndexEntry[];
};
