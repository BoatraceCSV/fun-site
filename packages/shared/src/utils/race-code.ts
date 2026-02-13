/**
 * レースコードのパース・生成ユーティリティ
 *
 * レースコードは BoatraceCSV の全CSVに共通するキーで、
 * 会場・日付・レース番号を一意に識別する。
 * 形式: "YYYYMMDDSSRR" (12桁)
 *   YYYY: 年, MM: 月, DD: 日, SS: 会場ID(01-24), RR: レース番号(01-12)
 */

export type ParsedRaceCode = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly stadiumId: string;
  readonly raceNumber: number;
  readonly date: string;
};

const RACE_CODE_LENGTH = 12;

/** レースコードを解析 */
export const parseRaceCode = (raceCode: string): ParsedRaceCode => {
  if (raceCode.length !== RACE_CODE_LENGTH) {
    throw new Error(`Invalid race code length: ${raceCode}`);
  }

  const year = Number(raceCode.slice(0, 4));
  const month = Number(raceCode.slice(4, 6));
  const day = Number(raceCode.slice(6, 8));
  const stadiumId = raceCode.slice(8, 10);
  const raceNumber = Number(raceCode.slice(10, 12));

  return {
    year,
    month,
    day,
    stadiumId,
    raceNumber,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
};

/** 会場ID・日付・レース番号からレースコードを生成 */
export const buildRaceCode = (stadiumId: string, date: string, raceNumber: number): string => {
  const parts = date.split("-");
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!(y && m && d)) {
    throw new Error(`Invalid date format: ${date}`);
  }
  const rn = String(raceNumber).padStart(2, "0");
  return `${y}${m}${d}${stadiumId}${rn}`;
};
