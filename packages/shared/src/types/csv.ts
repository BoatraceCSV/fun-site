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
