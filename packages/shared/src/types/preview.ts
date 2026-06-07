/** 直前情報 (previews/*) CSV 由来の型定義 */

/** tkz CSV (previews/tkz) の艇別データ */
export type TkzBoat = {
  readonly boatNumber: number;
  /** 体重 (kg) */
  readonly weightKg: number;
  /** 体重調整 (kg) */
  readonly weightAdjustKg: number;
  /** 展示タイム (秒)。未計測は 0 */
  readonly exhibitionTime: number;
  /** チルト角度 */
  readonly tilt: number;
};

/** tkz CSV (previews/tkz) のレース行 — 体重・展示タイム・チルト */
export type TkzRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  readonly votingDeadline: string;
  readonly fetchedAt: string;
  readonly boats: readonly TkzBoat[];
};

/** sui CSV (previews/sui) のレース行 — 水面気象スナップショット */
export type SuiRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  readonly votingDeadline: string;
  readonly fetchedAt: string;
  /** 気象観測時刻 (HHMM) */
  readonly observedAt: string;
  /** 風速 (m/s) */
  readonly windSpeed: number;
  /** 風向（場ごとの方位コード生値。空欄あり） */
  readonly windDirection: string;
  /** 波高 (cm) */
  readonly waveHeight: number;
  /** 天候コード (1=晴 / 2=曇 / 3=雨 / 4=雪 / 5=霧 など、生値) */
  readonly weather: string;
  /** 気温 (℃) */
  readonly airTemperature: number;
  /** 水温 (℃) */
  readonly waterTemperature: number;
};
