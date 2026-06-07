import { describe, expect, it } from "vitest";
import { parseRecentForm } from "../fetcher/recent-form-schemas.js";

const META = ["レースコード", "レース日", "レース場コード", "レース回"];

/** 1 艇分のヘッダ（登録番号・選手名 + 前1..5節 × 6項目） */
const boatHeader = (n: number): string[] => {
  const cols = [`艇${n}_登録番号`, `艇${n}_選手名`];
  for (let k = 1; k <= 5; k++) {
    cols.push(
      `艇${n}_前${k}節_開始日`,
      `艇${n}_前${k}節_終了日`,
      `艇${n}_前${k}節_場コード`,
      `艇${n}_前${k}節_場名`,
      `艇${n}_前${k}節_グレード`,
      `艇${n}_前${k}節_着順列`,
    );
  }
  return cols;
};

/** 1 艇分の値。session1 のみ埋め、残り 4 節は空にする */
const boatValues = (reg: string, name: string, session1: string[]): string[] => {
  const vals = [reg, name, ...session1];
  // 前2..5節は 6 項目空
  for (let k = 2; k <= 5; k++) vals.push("", "", "", "", "", "");
  return vals;
};

describe("parseRecentForm", () => {
  it("4メタ + 6艇 × (登録番号/選手名 + 5節) をパースし、空セッションも保持する", () => {
    const header = [...META, ...[1, 2, 3, 4, 5, 6].flatMap((n) => boatHeader(n))].join(",");

    const metaVals = ["202606060101", "2026-06-06", "01", "01R"];
    const boats = [1, 2, 3, 4, 5, 6].flatMap((n) =>
      n === 1
        ? boatValues("5006", "久保原 秀人", [
            "2026-05-28",
            "2026-06-02",
            "01",
            "桐生",
            "一般",
            "３２５　３　３１４２",
          ])
        : boatValues(`100${n}`, `選手${n}`, ["", "", "", "", "", ""]),
    );
    const csv = `${header}\n${[...metaVals, ...boats].join(",")}\n`;

    const rows = parseRecentForm(csv);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.raceCode).toBe("202606060101");
    expect(row?.stadiumId).toBe("01");
    expect(row?.raceNumber).toBe(1);
    expect(row?.boats).toHaveLength(6);

    const boat1 = row?.boats[0];
    expect(boat1?.registrationNumber).toBe(5006);
    expect(boat1?.racerName).toBe("久保原 秀人");
    expect(boat1?.sessions).toHaveLength(5);
    expect(boat1?.sessions[0]).toEqual({
      startDate: "2026-05-28",
      endDate: "2026-06-02",
      stadiumCode: "01",
      stadiumName: "桐生",
      grade: "一般",
      ranks: "３２５　３　３１４２",
    });
    // 前2節は空
    expect(boat1?.sessions[1]?.ranks).toBe("");
    expect(boat1?.sessions[1]?.stadiumName).toBe("");
  });
});
