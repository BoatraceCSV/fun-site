import { describe, expect, it } from "vitest";
import {
  parseConfirmations,
  parseEstimates,
  parsePredictionPreviews,
  parsePrograms,
  parseResults,
} from "../fetcher/schemas.js";

describe("parsePrograms", () => {
  it("should parse a minimal program CSV", () => {
    const csv = [
      "レースコード,タイトル,日次,レース日,レース場,レース回,レース名,距離(m),電話投票締切予定,1枠_艇番,1枠_登録番号,1枠_選手名,1枠_年齢,1枠_支部,1枠_体重,1枠_級別,1枠_全国勝率,1枠_全国2連対率,1枠_当地勝率,1枠_当地2連対率,1枠_モーター番号,1枠_モーター2連対率,1枠_ボート番号,1枠_ボート2連対率,2枠_艇番,2枠_登録番号,2枠_選手名,2枠_年齢,2枠_支部,2枠_体重,2枠_級別,2枠_全国勝率,2枠_全国2連対率,2枠_当地勝率,2枠_当地2連対率,2枠_モーター番号,2枠_モーター2連対率,2枠_ボート番号,2枠_ボート2連対率,3枠_艇番,3枠_登録番号,3枠_選手名,3枠_年齢,3枠_支部,3枠_体重,3枠_級別,3枠_全国勝率,3枠_全国2連対率,3枠_当地勝率,3枠_当地2連対率,3枠_モーター番号,3枠_モーター2連対率,3枠_ボート番号,3枠_ボート2連対率,4枠_艇番,4枠_登録番号,4枠_選手名,4枠_年齢,4枠_支部,4枠_体重,4枠_級別,4枠_全国勝率,4枠_全国2連対率,4枠_当地勝率,4枠_当地2連対率,4枠_モーター番号,4枠_モーター2連対率,4枠_ボート番号,4枠_ボート2連対率,5枠_艇番,5枠_登録番号,5枠_選手名,5枠_年齢,5枠_支部,5枠_体重,5枠_級別,5枠_全国勝率,5枠_全国2連対率,5枠_当地勝率,5枠_当地2連対率,5枠_モーター番号,5枠_モーター2連対率,5枠_ボート番号,5枠_ボート2連対率,6枠_艇番,6枠_登録番号,6枠_選手名,6枠_年齢,6枠_支部,6枠_体重,6枠_級別,6枠_全国勝率,6枠_全国2連対率,6枠_当地勝率,6枠_当地2連対率,6枠_モーター番号,6枠_モーター2連対率,6枠_ボート番号,6枠_ボート2連対率",
      "202403150101,タイトル,1日目,2024-03-15,桐生,1R,一般戦,1800,12:00,1,1234,テスト 太郎,30,群馬,52,A1,7.50,50.00,8.00,60.00,10,40.0,20,35.0,2,2345,テスト 次郎,28,埼玉,53,B1,5.00,30.00,4.50,25.00,11,38.0,21,33.0,3,3456,テスト 三郎,35,東京,54,A2,6.50,45.00,7.00,50.00,12,42.0,22,37.0,4,4567,テスト 四郎,32,愛知,55,B1,4.80,28.00,5.00,30.00,13,36.0,23,31.0,5,5678,テスト 五郎,27,大阪,51,B2,3.50,20.00,3.00,18.00,14,34.0,24,29.0,6,6789,テスト 六郎,40,福岡,56,A1,7.80,55.00,8.50,65.00,15,45.0,25,40.0",
    ].join("\n");

    const result = parsePrograms(csv);
    expect(result).toHaveLength(1);
    expect(result[0]?.raceCode).toBe("202403150101");
    expect(result[0]?.stadium).toBe("桐生");
    expect(result[0]?.raceNumber).toBe(1);
    expect(result[0]?.boats).toHaveLength(6);
    expect(result[0]?.boats[0]?.boatNumber).toBe(1);
    expect(result[0]?.boats[0]?.racerName).toBe("テスト 太郎");
    expect(result[0]?.boats[0]?.rank).toBe("A1");
    expect(result[0]?.boats[0]?.nationalWinRate).toBe(7.5);
  });

  it("should return empty array for empty CSV", () => {
    const csv =
      "レースコード,タイトル,日次,レース日,レース場,レース回,レース名,距離(m),電話投票締切予定";
    const result = parsePrograms(csv);
    expect(result).toHaveLength(0);
  });
});

describe("parseEstimates", () => {
  it("should parse estimate CSV", () => {
    const csv = [
      "レースコード,予想1着,予想2着,予想3着,予想決まり手,艇1_予想コース,艇1_予想ST,艇2_予想コース,艇2_予想ST,艇3_予想コース,艇3_予想ST,艇4_予想コース,艇4_予想ST,艇5_予想コース,艇5_予想ST,艇6_予想コース,艇6_予想ST",
      "202403150101,1,3,4,逃げ,1,0.15,2,0.18,3,0.20,4,0.22,5,0.19,6,0.25",
    ].join("\n");

    const result = parseEstimates(csv);
    expect(result).toHaveLength(1);
    expect(result[0]?.predicted1st).toBe(1);
    expect(result[0]?.predicted2nd).toBe(3);
    expect(result[0]?.predicted3rd).toBe(4);
    expect(result[0]?.predictedTechnique).toBe("逃げ");
    expect(result[0]?.boats).toHaveLength(6);
    expect(result[0]?.boats[0]?.predictedST).toBe(0.15);
  });
});

describe("parsePredictionPreviews", () => {
  it("should parse prediction preview CSV", () => {
    const csv = [
      "レースコード,レース日,レース場,レース回,艇1_艇番,艇1_コース,艇1_スタート展示,艇1_チルト調整,艇1_展示タイム,艇2_艇番,艇2_コース,艇2_スタート展示,艇2_チルト調整,艇2_展示タイム,艇3_艇番,艇3_コース,艇3_スタート展示,艇3_チルト調整,艇3_展示タイム,艇4_艇番,艇4_コース,艇4_スタート展示,艇4_チルト調整,艇4_展示タイム,艇5_艇番,艇5_コース,艇5_スタート展示,艇5_チルト調整,艇5_展示タイム,艇6_艇番,艇6_コース,艇6_スタート展示,艇6_チルト調整,艇6_展示タイム",
      "202403150101,2024-03-15,桐生,1R,1,1,0.15,0.0,6.80,2,2,0.18,0.5,6.85,3,3,0.20,-0.5,6.90,4,4,0.22,0.0,6.88,5,5,0.19,0.0,6.82,6,6,0.25,0.0,6.95",
    ].join("\n");

    const result = parsePredictionPreviews(csv);
    expect(result).toHaveLength(1);
    expect(result[0]?.stadium).toBe("桐生");
    expect(result[0]?.boats).toHaveLength(6);
    expect(result[0]?.boats[0]?.predictedCourse).toBe(1);
  });
});

describe("parseConfirmations", () => {
  it("should parse confirmation CSV", () => {
    const csv = [
      "レースコード,予想1着,実際1着,予想2着,実際2着,予想3着,実際3着,1着的中,2着的中,3着的中,全的中,予想決まり手,決まり手,決まり手的中,コース一致数,進入完全一致,ST_MAE",
      "202403150101,1,1,3,3,4,2,○,○,×,×,逃げ,逃げ,○,5,×,0.03",
    ].join("\n");

    const result = parseConfirmations(csv);
    expect(result).toHaveLength(1);
    expect(result[0]?.raceCode).toBe("202403150101");
    expect(result[0]?.predicted1st).toBe(1);
    expect(result[0]?.actual1st).toBe(1);
    expect(result[0]?.hit1st).toBe(true);
    expect(result[0]?.hitAll).toBe(false);
    expect(result[0]?.hitTechnique).toBe(true);
    expect(result[0]?.courseMatchCount).toBe(5);
    expect(result[0]?.stMAE).toBe(0.03);
  });

  it("should parse × as false", () => {
    const csv = [
      "レースコード,予想1着,実際1着,予想2着,実際2着,予想3着,実際3着,1着的中,2着的中,3着的中,全的中,予想決まり手,決まり手,決まり手的中,コース一致数,進入完全一致,ST_MAE",
      "202403150101,1,3,3,1,4,4,×,×,○,×,逃げ,差し,×,4,×,0.05",
    ].join("\n");

    const result = parseConfirmations(csv);
    expect(result[0]?.hit1st).toBe(false);
    expect(result[0]?.hitTechnique).toBe(false);
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
