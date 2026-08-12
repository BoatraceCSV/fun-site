import { describe, expect, it } from "vitest";
import { parseTokutenHayami } from "../fetcher/tokuten-hayami-schemas.js";

const META = ["レースコード", "レース日", "レース場", "レース回", "締切時刻", "取得日時"];
const RACE_META = ["ボーダー順位", "1着点", "2着点", "3着点", "4着点", "5着点", "6着点"];

/** 1 艇分のヘッダ（基本7列 + 着順別 2 列 × 6） */
const boatHeader = (n: number): string[] => {
  const cols = [
    `艇${n}_級別`,
    `艇${n}_登録番号`,
    `艇${n}_選手名`,
    `艇${n}_得点率`,
    `艇${n}_順位`,
    `艇${n}_ボーダー状態`,
    `艇${n}_早見`,
  ];
  for (let k = 1; k <= 6; k++) {
    cols.push(`艇${n}_${k}着時得点率`, `艇${n}_${k}着時状態`);
  }
  return cols;
};

const boatValues = (
  base: [string, string, string, string, string, string, string],
  ifRanks: [string, string][],
): string[] => {
  const vals = [...base];
  for (let k = 0; k < 6; k++) {
    const cell = ifRanks[k] ?? ["", ""];
    vals.push(...cell);
  }
  return vals;
};

const buildCsv = (boats: string[][]): string => {
  const header = [...META, ...RACE_META, ...boats.flatMap((_, i) => boatHeader(i + 1))].join(",");
  const meta = [
    "202608120401",
    "2026-08-12",
    "04",
    "01R",
    "11:55",
    "2026-08-12T11:50:00+09:00",
    "18",
    "10",
    "08",
    "06",
    "04",
    "02",
    "01",
  ];
  return `${header}\n${[...meta, ...boats.flat()].join(",")}\n`;
};

describe("parseTokutenHayami", () => {
  it("レースの着順点・ボーダー順位と艇別の得点率早見をパースする", () => {
    const boats = [
      boatValues(
        ["B1", "5047", "國分 将太郎", "1.00", "43", "00", "7"],
        [
          ["5.50", "2"],
          ["4.50", "2"],
          ["3.50", "0"],
          ["2.50", "0"],
          ["1.50", "0"],
          ["1.00", "0"],
        ],
      ),
      ...[2, 3, 4, 5, 6].map((n) =>
        boatValues([`A${n}`, `100${n}`, `選手${n}`, "5.00", "10", "01", ""], []),
      ),
    ];

    const rows = parseTokutenHayami(buildCsv(boats));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.raceCode).toBe("202608120401");
    expect(row?.stadiumId).toBe("04");
    expect(row?.raceNumber).toBe(1);
    expect(row?.borderRank).toBe(18);
    expect(row?.rankPoints).toEqual([10, 8, 6, 4, 2, 1]);
    expect(row?.racers).toHaveLength(6);

    const boat1 = row?.racers[0];
    expect(boat1?.boatNumber).toBe(1);
    expect(boat1?.classGrade).toBe("B1");
    expect(boat1?.registrationNumber).toBe(5047);
    expect(boat1?.racerName).toBe("國分 将太郎");
    expect(boat1?.scoreRate).toBe(1.0);
    expect(boat1?.scoreRateLabel).toBe("1.00");
    expect(boat1?.rank).toBe(43);
    // ボーダー状態 "00" = ボーダー圏外
    expect(boat1?.withinBorder).toBe(false);
    expect(boat1?.otherRaceNumber).toBe(7);
    expect(boat1?.ifRanks).toHaveLength(6);
    expect(boat1?.ifRanks[0]).toEqual({ rank: 1, scoreRate: 5.5, status: 2 });
    expect(boat1?.ifRanks[5]).toEqual({ rank: 6, scoreRate: 1.0, status: 0 });

    // ボーダー状態 "01" = 順位がボーダー以内
    expect(row?.racers[1]?.withinBorder).toBe(true);
    // 1走のみの選手は早見が空 → null
    expect(row?.racers[1]?.otherRaceNumber).toBeNull();
    // 着順別セルが空欄の場合は null 埋め
    expect(row?.racers[1]?.ifRanks[0]).toEqual({ rank: 1, scoreRate: null, status: null });
  });

  it("得点率が数値でない (賞除 / 欠場 等) 行はラベルのみ保持する", () => {
    const boats = [
      boatValues(["B1", "5047", "選手1", "賞除", "", "00", ""], []),
      ...[2, 3, 4, 5, 6].map((n) =>
        boatValues([`A${n}`, `100${n}`, `選手${n}`, "5.00", "10", "01", ""], []),
      ),
    ];
    const boat1 = parseTokutenHayami(buildCsv(boats))[0]?.racers[0];
    expect(boat1?.scoreRate).toBeNull();
    expect(boat1?.scoreRateLabel).toBe("賞除");
    expect(boat1?.rank).toBeNull();
  });
});
