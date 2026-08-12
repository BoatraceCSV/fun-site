import { describe, expect, it } from "vitest";
import { parseAnaPicks } from "../fetcher/ana-picks-schemas.js";

const HEADER =
  "レースコード,レース日,レース場コード,レース回,状態,1着コース,1着艇番," +
  "買い目1,買い目2,買い目3,買い目4,買い目5,決まり手1,決まり手2,決まり手3,決まり手4,決まり手5";

const row = (state: string, combos: string[], marks: string[]): string =>
  ["202608100301", "2026-08-10", "03", "1R", state, "3", "3", ...combos, ...marks].join(",");

describe("parseAnaPicks", () => {
  it("出目と決まり手注釈を対応づけて読む", () => {
    const csv = `${HEADER}\n${row(
      "realtime",
      ["3-1-4", "3-1-2", "3-1-5", "3-2-4", "3-1-6"],
      ["まくり差し", "まくり差し", "まくり差し", "まくり", "まくり差し"],
    )}`;
    const rows = parseAnaPicks(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.raceCode).toBe("202608100301");
    expect(rows[0]?.state).toBe("realtime");
    expect(rows[0]?.picks).toHaveLength(5);
    expect(rows[0]?.picks[0]).toEqual({ combo: [3, 1, 4], kimarite: "まくり差し" });
    expect(rows[0]?.picks[3]).toEqual({ combo: [3, 2, 4], kimarite: "まくり" });
  });

  it("daily 行と realtime 行を区別して両方読む", () => {
    const csv = [
      HEADER,
      row("daily", ["3-1-4", "", "", "", ""], ["まくり差し", "", "", "", ""]),
      row("realtime", ["3-1-2", "", "", "", ""], ["まくり差し", "", "", "", ""]),
    ].join("\n");
    expect(parseAnaPicks(csv).map((r) => r.state)).toEqual(["daily", "realtime"]);
  });

  it("空欄の買い目は詰めて読む (5 点未満のレースがある)", () => {
    const csv = `${HEADER}\n${row(
      "realtime",
      ["3-1-4", "3-1-2", "", "", ""],
      ["まくり差し", "まくり", "", "", ""],
    )}`;
    expect(parseAnaPicks(csv)[0]?.picks).toHaveLength(2);
  });

  it("不正な出目は落とす", () => {
    const csv = `${HEADER}\n${row(
      "realtime",
      ["3-1", "3-1-7", "3-3-4", "abc", "3-1-4"],
      ["", "", "", "", "まくり差し"],
    )}`;
    // 桁数不足 / 範囲外 / 同一艇重複 / 非数 はすべて除外され、最後の 1 点だけ残る
    const picks = parseAnaPicks(csv)[0]?.picks ?? [];
    expect(picks).toHaveLength(1);
    expect(picks[0]?.combo).toEqual([3, 1, 4]);
  });

  it("状態が不明な行とレースコード欠落行は落とす", () => {
    const csv = [
      HEADER,
      row("", ["3-1-4", "", "", "", ""], ["", "", "", "", ""]),
      ",2026-08-10,03,1R,realtime,3,3,3-1-4,,,,,,,,,",
    ].join("\n");
    expect(parseAnaPicks(csv)).toHaveLength(0);
  });

  it("空 CSV でも落ちない", () => {
    expect(parseAnaPicks(HEADER)).toEqual([]);
  });
});

// B案 v10_kimarite の CSV は 1着コース / 1着艇番 列を持たず、
// 1 レースの 5 点に複数の 1着艇が混ざる。同じパーサで読めることを固定する。
const KIMARITE_HEADER =
  "レースコード,レース日,レース場コード,レース回,状態," +
  "買い目1,買い目2,買い目3,買い目4,買い目5,決まり手1,決まり手2,決まり手3,決まり手4,決まり手5";

describe("parseAnaPicks (v10_kimarite の買い目)", () => {
  it("1着艇が混ざった 5 点を読む", () => {
    const csv = [
      KIMARITE_HEADER,
      "202608130301,2026-08-13,03,1R,realtime,2-1-3,6-1-2,5-1-2,2-1-4,3-1-2," +
        "差し,まくり差し,まくり差し,差し,まくり差し",
    ].join("\n");
    const rows = parseAnaPicks(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.picks.map((p) => p.combo[0])).toEqual([2, 6, 5, 2, 3]);
    expect(rows[0]?.picks[1]).toEqual({ combo: [6, 1, 2], kimarite: "まくり差し" });
  });
});
