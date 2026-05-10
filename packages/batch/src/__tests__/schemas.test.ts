import { describe, expect, it } from "vitest";
import { parseTitles } from "../fetcher/schemas.js";

describe("parseTitles", () => {
  it("should parse a title CSV", () => {
    const csv = [
      "レースコード,レース日,レース場コード,レース場,レース回,タイトル,日次,グレード,ナイター,レース名,電話投票締切予定,中止状態",
      "202605060101,2026-05-06,01,桐生,1R,第５３回上毛新聞社杯,最終日,IP,N,一般,15:18,",
      "202605061812,2026-05-06,18,住之江,12R,SGグランドチャンピオン,初日,SG,Y,ドリーム戦,20:30,中止",
    ].join("\n");

    const result = parseTitles(csv);
    expect(result).toHaveLength(2);

    const first = result[0];
    expect(first?.raceCode).toBe("202605060101");
    expect(first?.raceDate).toBe("2026-05-06");
    expect(first?.stadiumId).toBe("01");
    expect(first?.stadium).toBe("桐生");
    expect(first?.raceNumber).toBe(1);
    expect(first?.title).toBe("第５３回上毛新聞社杯");
    expect(first?.dayNumber).toBe(0); // "最終日" は数字を含まないので 0
    expect(first?.dayLabel).toBe("最終日");
    expect(first?.grade).toBe("IP");
    expect(first?.isNighter).toBe(false);
    expect(first?.raceName).toBe("一般");
    expect(first?.votingDeadline).toBe("15:18");
    expect(first?.cancellationStatus).toBe("");

    const second = result[1];
    expect(second?.raceNumber).toBe(12);
    expect(second?.grade).toBe("SG");
    expect(second?.isNighter).toBe(true);
    expect(second?.raceName).toBe("ドリーム戦");
    expect(second?.dayLabel).toBe("初日");
    expect(second?.cancellationStatus).toBe("中止");
  });

  it("should return empty array for header-only CSV", () => {
    const csv =
      "レースコード,レース日,レース場コード,レース場,レース回,タイトル,日次,グレード,ナイター,レース名,電話投票締切予定,中止状態";
    expect(parseTitles(csv)).toHaveLength(0);
  });
});
