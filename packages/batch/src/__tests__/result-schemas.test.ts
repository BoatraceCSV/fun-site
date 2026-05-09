import { describe, expect, it } from "vitest";
import { parseResults } from "../fetcher/result-schemas.js";

// レースタイム ("1'49\"3" 等) は " を含むため、Python csv.writer と同じ
// "double-quote escape" で CSV にする必要がある。
const csvQuote = (v: string): string => {
  if (v.includes('"') || v.includes(",")) {
    return `"${v.replaceAll('"', '""')}"`;
  }
  return v;
};
const csvRow = (cells: string[]): string => cells.map(csvQuote).join(",");

// boatracecsv 側 RESULT_HEADERS と完全一致する 50 列ヘッダ。
const HEADER = [
  "レースコード",
  "レース日",
  "レース場",
  "レース回",
  "締切時刻",
  "取得日時",
  "結果記録時刻",
  "決まり手",
  // 1-6 着 × {艇番, 選手名, レースタイム}
  ...[1, 2, 3, 4, 5, 6].flatMap((r) => [`${r}着_艇番`, `${r}着_選手名`, `${r}着_レースタイム`]),
  // 1-6 コース × {艇番, スタートタイミング, F}
  ...[1, 2, 3, 4, 5, 6].flatMap((c) => [
    `${c}コース_艇番`,
    `${c}コース_スタートタイミング`,
    `${c}コース_F`,
  ]),
  "天候",
  "風向",
  "風速(m)",
  "波の高さ(cm)",
  "気温(℃)",
  "水温(℃)",
].join(",");

describe("parseResults", () => {
  it("通常レース (F なし) を 1 行パースできる", () => {
    // 桐生 (jo=01) 1R 2026-05-05 — 着順 3-1-5-4-2-6, 決まり手まくり差し
    const row = csvRow([
      "202605050101",
      "2026-05-05",
      "01",
      "01R",
      "15:18",
      "2026-05-05T15:23:00+09:00",
      "1522",
      "まくり差し",
      // 着順 1-6
      "3",
      "鳥居塚 孝博",
      `1'49"3`,
      "1",
      "今泉 徹",
      `1'51"3`,
      "5",
      "田中 堅",
      `1'53"0`,
      "4",
      "外崎 悟",
      `1'54"2`,
      "2",
      "川口 貴久",
      `1'54"2`,
      "6",
      "植竹 玲奈",
      `1'55"3`,
      // コース 1-6 (進入順)
      "1",
      "0.18",
      "",
      "2",
      "0.20",
      "",
      "3",
      "0.18",
      "",
      "4",
      "0.29",
      "",
      "5",
      "0.27",
      "",
      "6",
      "0.29",
      "",
      // 天候
      "1",
      "東(向い風)",
      "4",
      "3",
      "21.0",
      "13.0",
    ]);
    const csv = `${HEADER}\n${row}\n`;
    const parsed = parseResults(csv);

    expect(parsed).toHaveLength(1);
    const r = parsed[0];
    expect(r).toBeDefined();
    if (!r) return;

    expect(r.raceCode).toBe("202605050101");
    expect(r.stadiumId).toBe("01");
    expect(r.raceNumber).toBe(1);
    expect(r.recordedAt).toBe("1522");
    expect(r.kimarite).toBe("まくり差し");

    // 全 6 着分パースされる
    expect(r.finishes).toHaveLength(6);
    const first = r.finishes.find((f) => f.rank === 1);
    expect(first?.boatNumber).toBe(3);
    expect(first?.racerName).toBe("鳥居塚 孝博");
    expect(first?.raceTime).toBe(`1'49"3`);

    // コースは進入順に並ぶ
    expect(r.courses).toHaveLength(6);
    expect(r.courses.every((c) => c.flying === false)).toBe(true);

    // 天候パース
    expect(r.weather.weather).toBe("1");
    expect(r.weather.windDirection).toBe("東(向い風)");
    expect(r.weather.windSpeed).toBe(4);
    expect(r.weather.waveHeight).toBe(3);
    expect(r.weather.airTemperature).toBe(21);
    expect(r.weather.waterTemperature).toBe(13);
  });

  it("F (フライング) を含むコース行を boolean に変換できる", () => {
    const row = csvRow([
      "202605050208",
      "2026-05-05",
      "02",
      "08R",
      "14:15",
      "2026-05-05T14:20:00+09:00",
      "1419",
      "まくり",
      // 着順 (F した艇はレースタイムが空)
      "6",
      "秋元 哲",
      `1'46"7`,
      "4",
      "中澤 咲忍",
      `1'50"6`,
      "2",
      "中里 昌志",
      `1'51"9`,
      "1",
      "小巽 晴光",
      `1'52"4`,
      "3",
      "野田 昌宏",
      "",
      "5",
      "関口 智之",
      "",
      // コース 1-6 (5 コースが F)
      "2",
      "0.08",
      "",
      "1",
      "0.14",
      "",
      "6",
      "0.05",
      "",
      "3",
      "0.02",
      "",
      "4",
      "0.03",
      "",
      "5",
      "0.01",
      "F",
      // 天候
      "1",
      "無風(無風)",
      "0",
      "0",
      "21.0",
      "19.0",
    ]);
    const csv = `${HEADER}\n${row}\n`;
    const parsed = parseResults(csv);

    expect(parsed).toHaveLength(1);
    const flyingCourse = parsed[0]?.courses.find((c) => c.boatNumber === 5);
    expect(flyingCourse?.flying).toBe(true);
    expect(flyingCourse?.startTiming).toBeCloseTo(0.01, 2);

    // 他コースは F=false
    const others = parsed[0]?.courses.filter((c) => c.boatNumber !== 5);
    expect(others?.every((c) => c.flying === false)).toBe(true);
  });

  it("ヘッダのみの CSV では空配列を返す", () => {
    expect(parseResults(`${HEADER}\n`)).toHaveLength(0);
  });
});
