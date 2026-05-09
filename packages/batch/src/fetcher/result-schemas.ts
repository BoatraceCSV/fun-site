import type {
  RaceResultCourse,
  RaceResultFinish,
  RaceResultRow,
  RaceResultWeather,
} from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const BOAT_COUNT = 6;

const toNumber = (v: string | undefined): number => {
  if (v === undefined || v === "") return 0;
  const num = Number(v);
  return Number.isNaN(num) ? 0 : num;
};

const stripRSuffix = (raw: string | undefined): number => {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9]/g, "");
  return cleaned ? Number(cleaned) : 0;
};

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

const parseFinish = (row: Record<string, string>, rank: number): RaceResultFinish => ({
  rank,
  boatNumber: toNumber(row[`${rank}着_艇番`]),
  racerName: (row[`${rank}着_選手名`] ?? "").trim(),
  raceTime: (row[`${rank}着_レースタイム`] ?? "").trim(),
});

const parseCourse = (row: Record<string, string>, courseNumber: number): RaceResultCourse => {
  const flagRaw = (row[`${courseNumber}コース_F`] ?? "").trim();
  return {
    courseNumber,
    boatNumber: toNumber(row[`${courseNumber}コース_艇番`]),
    startTiming: toNumber(row[`${courseNumber}コース_スタートタイミング`]),
    flying: flagRaw === "F",
  };
};

const parseWeather = (row: Record<string, string>): RaceResultWeather => ({
  weather: (row["天候"] ?? "").trim(),
  windDirection: (row["風向"] ?? "").trim(),
  windSpeed: toNumber(row["風速(m)"]),
  waveHeight: toNumber(row["波の高さ(cm)"]),
  airTemperature: toNumber(row["気温(℃)"]),
  waterTemperature: toNumber(row["水温(℃)"]),
});

const parseResultRow = (row: Record<string, string>): RaceResultRow => {
  const finishes: RaceResultFinish[] = [];
  for (let rank = 1; rank <= BOAT_COUNT; rank++) {
    const f = parseFinish(row, rank);
    // 部分確定（着順未着）の場合は艇番が 0 になるため除外する
    if (f.boatNumber > 0) finishes.push(f);
  }

  const courses: RaceResultCourse[] = [];
  for (let course = 1; course <= BOAT_COUNT; course++) {
    const c = parseCourse(row, course);
    if (c.boatNumber > 0) courses.push(c);
  }

  return {
    raceCode: row["レースコード"] ?? "",
    raceDate: row["レース日"] ?? "",
    stadiumId: row["レース場"] ?? "",
    raceNumber: stripRSuffix(row["レース回"]),
    votingDeadline: row["締切時刻"] ?? "",
    fetchedAt: row["取得日時"] ?? "",
    recordedAt: row["結果記録時刻"] ?? "",
    kimarite: (row["決まり手"] ?? "").trim(),
    finishes,
    courses,
    weather: parseWeather(row),
  };
};

/**
 * realtime 結果 CSV (`data/results/realtime/YYYY/MM/DD.csv`) をパースする。
 *
 * 1 行 = 1 レース。preview-realtime は確定したレースだけ追記するため、
 * 当日のすべてのレースが揃うとは限らない（締切前 / 結果未着のレースは
 * 単に行が無いだけ）。
 */
export const parseResults = (csvText: string): RaceResultRow[] =>
  parseCsv(csvText).map(parseResultRow);
