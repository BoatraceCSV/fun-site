/**
 * realtime 結果 CSV 由来の型定義。
 *
 * `data/results/realtime/YYYY/MM/DD.csv` 由来（boatracecsv 側 preview-realtime
 * が当日確定直後に bc_rs1_2 をパースして追記する）。K-file 由来の翌日確定
 * (`data/results/daily/...`) はここでは扱わない。
 */

/** 着順別の確定情報（1-6 着）。データ未着の rank は省略される（部分確定対応） */
export type RaceResultFinish = {
  /** 着順 (1-6) */
  readonly rank: number;
  /** 艇番 (1-6) */
  readonly boatNumber: number;
  /** 選手名 */
  readonly racerName: string;
  /**
   * レースタイム。1 着のみ "1'49\"3" 形式の文字列で入る。
   * 2 着以降は元 TSV 由来で空または未設定なことが多い。
   */
  readonly raceTime: string;
};

/** 進入コース別の ST / F 情報（1-6 コース） */
export type RaceResultCourse = {
  /** 進入コース番号 (1-6) */
  readonly courseNumber: number;
  /** そのコースに進入した艇番 */
  readonly boatNumber: number;
  /** スタートタイミング（負値=フライング、空なら欠航等） */
  readonly startTiming: number;
  /** F フラグ（フライング） */
  readonly flying: boolean;
};

/** 結果 CSV に同梱される観測天候 */
export type RaceResultWeather = {
  /** 天候コード（1-7、bc_rs1_2 由来の数値文字列をそのまま保持） */
  readonly weather: string;
  /** 風向（"東(向い風)" など、波・風向ラベル付きの生文字列） */
  readonly windDirection: string;
  /** 風速 (m/s) */
  readonly windSpeed: number;
  /** 波高 (cm) */
  readonly waveHeight: number;
  /** 気温 (℃) */
  readonly airTemperature: number;
  /** 水温 (℃) */
  readonly waterTemperature: number;
};

/** realtime 結果 CSV の 1 行（= 1 レース） */
export type RaceResultRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  /** 締切時刻 (HH:MM) */
  readonly votingDeadline: string;
  /** 取得日時（preview-realtime が fetch を試行した瞬間の ISO 文字列） */
  readonly fetchedAt: string;
  /**
   * 結果記録時刻。bc_rs1_2 weather 行先頭の HHMM を保持。
   * パース不能なら空文字列。
   */
  readonly recordedAt: string;
  /** 決まり手 ("まくり" / "まくり差し" / 空 等) */
  readonly kimarite: string;
  readonly finishes: readonly RaceResultFinish[];
  readonly courses: readonly RaceResultCourse[];
  readonly weather: RaceResultWeather;
};
