/** race_cards CSV 由来の選手情報 */
export type RaceCardRacer = {
  readonly boatNumber: number;
  readonly registrationNumber: number;
  readonly racerName: string;
  readonly age: number;
  readonly branch: string;
  readonly hometown: string;
  readonly classGrade: string;
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

/** index CSV の状態（realtime: 直前情報反映済み / daily: 朝バッチ時点） */
export type IndexState = "realtime" | "daily";

/** index CSV 由来の枠別 AI 評価 */
export type IndexEntry = {
  readonly boatNumber: number;
  readonly framePt: number;
  readonly framePtContribution: number;
  readonly racerPt: number;
  readonly racerPtContribution: number;
  readonly motorPt: number;
  readonly motorPtContribution: number;
  readonly exhibitionPt: number;
  readonly exhibitionPtContribution: number;
  readonly weatherPt: number;
  readonly weatherPtContribution: number;
  readonly strengthPt: number;
};

/** index CSV 由来のレース行 */
export type IndexRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  readonly state: IndexState;
  readonly entries: readonly IndexEntry[];
};
