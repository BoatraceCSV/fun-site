import { describe, expect, it } from "vitest";
import { parseWaku10 } from "../fetcher/waku10-schemas.js";

const META = ["レースコード", "レース日", "レース場コード", "レース回"];

/** 1 艇分のヘッダ（選手名・枠番別3指標 + 過去1..10走 × 3項目） */
const boatHeader = (n: number): string[] => {
  const cols = [
    `艇${n}_選手名`,
    `艇${n}_枠番別勝率`,
    `艇${n}_枠番別平均ST`,
    `艇${n}_枠番別平均スタート順`,
  ];
  for (let k = 1; k <= 10; k++) {
    cols.push(`艇${n}_過去${k}走_着順`, `艇${n}_過去${k}走_進入`, `艇${n}_過去${k}走_グレード`);
  }
  return cols;
};

/** 1 艇分の値。`runs` に渡した走ぶんだけ埋め、残りは空スロットにする */
const boatValues = (
  name: string,
  stats: [string, string, string],
  runs: [string, string, string][],
): string[] => {
  const vals = [name, ...stats];
  for (let k = 0; k < 10; k++) {
    const run = runs[k] ?? ["", "", ""];
    vals.push(...run);
  }
  return vals;
};

describe("parseWaku10", () => {
  it("4メタ + 6艇 × (選手名/枠番別3指標 + 過去10走) をパースする", () => {
    const header = [...META, ...[1, 2, 3, 4, 5, 6].flatMap((n) => boatHeader(n))].join(",");
    const metaVals = ["202608110101", "2026-08-11", "01", "01R"];
    const boats = [1, 2, 3, 4, 5, 6].flatMap((n) =>
      n === 1
        ? boatValues(
            "小川 知行",
            ["7.0", "0.15", "1.3"],
            [
              ["1", "", "IP"],
              ["5", "3", "G2"],
              ["F", "", "IP"],
            ],
          )
        : boatValues(`選手${n}`, ["", "", ""], []),
    );
    const csv = `${header}\n${[...metaVals, ...boats].join(",")}\n`;

    const rows = parseWaku10(csv);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.raceCode).toBe("202608110101");
    expect(row?.raceDate).toBe("2026-08-11");
    expect(row?.stadiumId).toBe("01");
    expect(row?.raceNumber).toBe(1);
    expect(row?.boats).toHaveLength(6);

    const boat1 = row?.boats[0];
    expect(boat1?.boatNumber).toBe(1);
    expect(boat1?.racerName).toBe("小川 知行");
    expect(boat1?.winRate).toBe(7.0);
    expect(boat1?.avgST).toBe(0.15);
    expect(boat1?.avgStartOrder).toBe(1.3);
    expect(boat1?.runs).toHaveLength(10);
    // 進入が空欄 = 枠なり進入なので 0 のまま保持する
    expect(boat1?.runs[0]).toEqual({ rank: "1", entryCourse: 0, grade: "IP" });
    expect(boat1?.runs[1]).toEqual({ rank: "5", entryCourse: 3, grade: "G2" });
    // 着順の特殊トークンはそのまま持つ
    expect(boat1?.runs[2]?.rank).toBe("F");
    // 出走歴が 10 走に満たない古い側は全列空
    expect(boat1?.runs[3]).toEqual({ rank: "", entryCourse: 0, grade: "" });
  });

  it("空欄の枠番別指標は 0 になる", () => {
    const header = [...META, ...boatHeader(1)].join(",");
    const csv = `${header}\n${["202608110101", "2026-08-11", "01", "01R", ...boatValues("選手1", ["", "", ""], [])].join(",")}\n`;
    const boat1 = parseWaku10(csv)[0]?.boats[0];
    expect(boat1?.winRate).toBe(0);
    expect(boat1?.avgST).toBe(0);
    expect(boat1?.avgStartOrder).toBe(0);
  });
});
