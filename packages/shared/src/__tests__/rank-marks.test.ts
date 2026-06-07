import { describe, expect, it } from "vitest";
import { tokenizeRankString } from "../utils/rank-marks.js";

describe("tokenizeRankString", () => {
  it("全角数字を着順に変換し、全角スペースを日区切りにする", () => {
    // ３２５　３　３１４２
    const marks = tokenizeRankString("３２５　３　３１４２");
    expect(marks).toEqual([
      { kind: "rank", rank: 3, yusho: false },
      { kind: "rank", rank: 2, yusho: false },
      { kind: "rank", rank: 5, yusho: false },
      { kind: "separator" },
      { kind: "rank", rank: 3, yusho: false },
      { kind: "separator" },
      { kind: "rank", rank: 3, yusho: false },
      { kind: "rank", rank: 1, yusho: false },
      { kind: "rank", rank: 4, yusho: false },
      { kind: "rank", rank: 2, yusho: false },
    ]);
  });

  it("F / L / 欠 などの特殊トークンを保持する", () => {
    const marks = tokenizeRankString("１F欠Ｌ転");
    expect(marks).toEqual([
      { kind: "rank", rank: 1, yusho: false },
      { kind: "token", token: "F" },
      { kind: "token", token: "欠" },
      { kind: "token", token: "L" },
      { kind: "token", token: "転" },
    ]);
  });

  it("優勝戦 [N] を yusho フラグ付きの着順にする", () => {
    const marks = tokenizeRankString("６[１]");
    expect(marks).toEqual([
      { kind: "rank", rank: 6, yusho: false },
      { kind: "rank", rank: 1, yusho: true },
    ]);
  });

  it("先頭・末尾・連続のスペースを正規化する", () => {
    const marks = tokenizeRankString("　１　　２　");
    expect(marks).toEqual([
      { kind: "rank", rank: 1, yusho: false },
      { kind: "separator" },
      { kind: "rank", rank: 2, yusho: false },
    ]);
  });

  it("空文字は空配列を返す", () => {
    expect(tokenizeRankString("")).toEqual([]);
  });
});
