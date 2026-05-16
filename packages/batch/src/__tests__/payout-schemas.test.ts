import { describe, expect, it } from "vitest";
import { parsePayouts } from "../fetcher/payout-schemas.js";

// boatracecsv 側 PAYOUT_HEADERS と完全一致する 35 列ヘッダ。
const HEADER = [
  "レースコード",
  "レース日",
  "レース場",
  "レース回",
  "締切時刻",
  "取得日時",
  "単勝_艇番",
  "単勝_払戻金",
  "複勝_1着_艇番",
  "複勝_1着_払戻金",
  "複勝_2着_艇番",
  "複勝_2着_払戻金",
  "複勝_3着_艇番",
  "複勝_3着_払戻金",
  "2連単_組番",
  "2連単_払戻金",
  "2連単_人気",
  "2連複_組番",
  "2連複_払戻金",
  "2連複_人気",
  "拡連複_1-2着_組番",
  "拡連複_1-2着_払戻金",
  "拡連複_1-2着_人気",
  "拡連複_1-3着_組番",
  "拡連複_1-3着_払戻金",
  "拡連複_1-3着_人気",
  "拡連複_2-3着_組番",
  "拡連複_2-3着_払戻金",
  "拡連複_2-3着_人気",
  "3連単_組番",
  "3連単_払戻金",
  "3連単_人気",
  "3連複_組番",
  "3連複_払戻金",
  "3連複_人気",
];

// 芦屋 race 12 2026-05-16 の実払戻 (1着=1, 2着=4, 3着=2)
const ASHIYA_R12_ROW = [
  "202605162112",
  "2026-05-16",
  "21",
  "12R",
  "20:53",
  "2026-05-16T20:55:00+09:00",
  "1",
  "130",
  "1",
  "100",
  "4",
  "210",
  "",
  "",
  "1-4",
  "460",
  "2",
  "1=4",
  "490",
  "2",
  "1=4",
  "230",
  "2",
  "1=2",
  "270",
  "5",
  "2=4",
  "300",
  "7",
  "1-4-2",
  "2180",
  "8",
  "1=2=4",
  "940",
  "4",
];

const buildCsv = (rows: string[][]): string =>
  [HEADER, ...rows].map((r) => r.join(",")).join("\n");

describe("parsePayouts", () => {
  it("芦屋 race12 の 1 行をフルパースする", () => {
    const csv = buildCsv([ASHIYA_R12_ROW]);
    const result = parsePayouts(csv);
    expect(result.length).toBe(1);

    const r = result[0]!;
    expect(r.raceCode).toBe("202605162112");
    expect(r.raceDate).toBe("2026-05-16");
    expect(r.stadiumId).toBe("21");
    expect(r.raceNumber).toBe(12);
    expect(r.votingDeadline).toBe("20:53");

    expect(r.tansho).toEqual({ boatNumber: 1, payout: 130 });
    expect(r.fukusho).toEqual([
      { boatNumber: 1, payout: 100 },
      { boatNumber: 4, payout: 210 },
    ]);
    // 3 着スロット (複勝_3着_*) は空文字なので fukusho には含まれない (長さ 2)
    expect(r.fukusho.length).toBe(2);

    expect(r.nirentan).toEqual({ combination: "1-4", payout: 460, popularity: 2 });
    expect(r.nirenpuku).toEqual({ combination: "1=4", payout: 490, popularity: 2 });

    expect(r.kakurenfuku.length).toBe(3);
    expect(r.kakurenfuku[0]).toEqual({ combination: "1=4", payout: 230, popularity: 2 });
    expect(r.kakurenfuku[1]).toEqual({ combination: "1=2", payout: 270, popularity: 5 });
    expect(r.kakurenfuku[2]).toEqual({ combination: "2=4", payout: 300, popularity: 7 });

    expect(r.sanrentan).toEqual({ combination: "1-4-2", payout: 2180, popularity: 8 });
    expect(r.sanrenpuku).toEqual({ combination: "1=2=4", payout: 940, popularity: 4 });
  });

  it("拡連複の中間スロットが欠ける場合は位置不変条件を保ち null を返す", () => {
    const row = [...ASHIYA_R12_ROW];
    // 拡連複_1-3着_* を空にする (index 23-25)
    row[23] = "";
    row[24] = "";
    row[25] = "";
    const csv = buildCsv([row]);
    const r = parsePayouts(csv)[0]!;
    expect(r.kakurenfuku[0]?.combination).toBe("1=4");
    expect(r.kakurenfuku[1]).toBeNull();
    expect(r.kakurenfuku[2]?.combination).toBe("2=4");
  });

  it("空 CSV (ヘッダのみ) は空配列", () => {
    const csv = HEADER.join(",");
    expect(parsePayouts(csv)).toEqual([]);
  });

  it("レース回の R サフィックスを取り除く", () => {
    const row = [...ASHIYA_R12_ROW];
    row[3] = "12R";
    const r = parsePayouts(buildCsv([row]))[0]!;
    expect(r.raceNumber).toBe(12);
  });

  it("カンマ入り払戻金 ('2,180') もパース可能", () => {
    const row = [...ASHIYA_R12_ROW];
    row[30] = '"2,180"'; // CSV-escaped
    // For simplicity, just verify the parser handles digits-with-comma via _to_int
    const csv = buildCsv([row]);
    const r = parsePayouts(csv)[0]!;
    // The csv-parse should yield "2,180", which the parser cleans to 2180.
    expect(r.sanrentan?.payout).toBe(2180);
  });
});
