import { describe, expect, it } from "vitest";
import { parseMotorStats } from "../fetcher/motor-stats-schemas.js";

const HEADER = [
  "記録日",
  "モーター期起算日",
  "場コード",
  "モーター番号",
  "勝率",
  "勝率順位",
  "2連対率",
  "2連対率順位",
  "3連対率",
  "3連対率順位",
  "1着回数",
  "1着順位",
  "2着回数",
  "2着順位",
  "3着回数",
  "3着順位",
  "連対外回数",
  "出走数",
  "優勝回数",
  "優勝順位",
  "優出回数",
  "優出順位",
  "raw_col_21",
  "raw_col_22",
  "平均ラップ秒",
  "平均ラップ順位",
  "期内初使用日",
  "整備種別1回数",
  "整備種別2回数",
  "整備種別3回数",
  "整備種別4回数",
  "整備種別5回数",
  "整備種別6回数",
  "直近メンテ日",
].join(",");

describe("parseMotorStats", () => {
  it("主要フィールド（3連率・優勝/優出・平均ラップ）をパースする", () => {
    const row = [
      "2026-06-06",
      "2025-12-27",
      "01",
      "11",
      "6.67",
      "8",
      "55.56",
      "10",
      "77.78",
      "4",
      "1",
      "16",
      "4",
      "2",
      "2",
      "12",
      "2",
      "9",
      "0",
      "2",
      "0",
      "7",
      "676",
      "7",
      "14.96",
      "17",
      "2025-12-27",
      "0",
      "1",
      "0",
      "0",
      "0",
      "0",
      "2025-12-31",
    ].join(",");
    const rows = parseMotorStats(`${HEADER}\n${row}\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      recordDate: "2026-06-06",
      periodStartDate: "2025-12-27",
      stadiumCode: "01",
      motorNumber: 11,
      winRate: 6.67,
      top2Rate: 55.56,
      top3Rate: 77.78,
      top3Rank: 4,
      firstCount: 1,
      starts: 9,
      championCount: 0,
      finalAppearances: 0,
      avgLapSec: 14.96,
      avgLapRank: 17,
    });
  });

  it("平均ラップが空欄のモーターは null になる", () => {
    const cols = HEADER.split(",").length;
    const cells = Array(cols).fill("0");
    cells[0] = "2026-06-06";
    cells[2] = "06";
    cells[3] = "25";
    cells[24] = ""; // 平均ラップ秒
    cells[25] = ""; // 平均ラップ順位
    const rows = parseMotorStats(`${HEADER}\n${cells.join(",")}\n`);
    expect(rows[0]?.avgLapSec).toBeNull();
    expect(rows[0]?.avgLapRank).toBeNull();
  });
});
