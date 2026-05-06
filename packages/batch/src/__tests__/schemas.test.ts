import { describe, expect, it } from "vitest";
import { parseResults, parseTitles } from "../fetcher/schemas.js";

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
    expect(second?.cancellationStatus).toBe("中止");
  });

  it("should return empty array for header-only CSV", () => {
    const csv =
      "レースコード,レース日,レース場コード,レース場,レース回,タイトル,日次,グレード,ナイター,レース名,電話投票締切予定,中止状態";
    expect(parseTitles(csv)).toHaveLength(0);
  });
});

describe("parseResults", () => {
  it("should parse result CSV with payouts", () => {
    const csv = [
      "レースコード,タイトル,日次,レース日,レース場,レース回,レース名,距離(m),天候,風向,風速(m),波の高さ(cm),決まり手,単勝_艇番,単勝_払戻金,複勝_1着_艇番,複勝_1着_払戻金,複勝_2着_艇番,複勝_2着_払戻金,2連単_組番,2連単_払戻金,2連複_組番,2連複_払戻金,拡連複_1-2着_組番,拡連複_1-2着_払戻金,拡連複_1-3着_組番,拡連複_1-3着_払戻金,拡連複_2-3着_組番,拡連複_2-3着_払戻金,3連単_組番,3連単_払戻金,3連複_組番,3連複_払戻金,1着_艇番,1着_登録番号,1着_選手名,1着_モーター番号,1着_ボート番号,1着_展示タイム,1着_進入コース,1着_スタートタイミング,1着_レースタイム,2着_艇番,2着_登録番号,2着_選手名,2着_モーター番号,2着_ボート番号,2着_展示タイム,2着_進入コース,2着_スタートタイミング,2着_レースタイム,3着_艇番,3着_登録番号,3着_選手名,3着_モーター番号,3着_ボート番号,3着_展示タイム,3着_進入コース,3着_スタートタイミング,3着_レースタイム,4着_艇番,4着_登録番号,4着_選手名,4着_モーター番号,4着_ボート番号,4着_展示タイム,4着_進入コース,4着_スタートタイミング,4着_レースタイム,5着_艇番,5着_登録番号,5着_選手名,5着_モーター番号,5着_ボート番号,5着_展示タイム,5着_進入コース,5着_スタートタイミング,5着_レースタイム,6着_艇番,6着_登録番号,6着_選手名,6着_モーター番号,6着_ボート番号,6着_展示タイム,6着_進入コース,6着_スタートタイミング,6着_レースタイム",
      "202403150101,タイトル,1日目,2024-03-15,桐生,1R,一般戦,1800,晴,北,3,5,逃げ,1,200,1,110,3,160,1-3,600,1-3,300,1-3,200,1-4,350,3-4,500,1-3-4,2400,1-3-4,800,1,1234,テスト太郎,10,20,6.80,1,0.15,1.48.5,3,3456,テスト三郎,12,22,6.90,3,0.20,1.49.0,4,4567,テスト四郎,13,23,6.88,4,0.22,1.49.5,2,2345,テスト次郎,11,21,6.85,2,0.18,1.50.0,5,5678,テスト五郎,14,24,6.82,5,0.19,1.50.5,6,6789,テスト六郎,15,25,6.95,6,0.25,1.51.0",
    ].join("\n");

    const result = parseResults(csv);
    expect(result).toHaveLength(1);
    expect(result[0]?.technique).toBe("逃げ");
    expect(result[0]?.weather).toBe("晴");
    expect(result[0]?.payouts.trifecta.payout).toBe(2400);
    expect(result[0]?.positions).toHaveLength(6);
    expect(result[0]?.positions[0]?.boatNumber).toBe(1);
  });
});
