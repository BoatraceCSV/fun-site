import { describe, expect, it } from "vitest";
import {
  type RacerPtSessionInput,
  computeRacerPtBreakdown,
  racerPtGradeBucket,
  racerPtScoreFor,
  racerPtSessionInputs,
  roundHalfToEven,
} from "../utils/racer-pt.js";

/**
 * 期待値は BoatraceCSV の `scripts/boatrace/index_features.py` を実データ
 * (data/programs 配下の recent_national / recent_local) に対して実行して採取した参照値。
 * 移植のズレを検出するのが目的なので、値の書き換えは Python 側の再実行結果で
 * 裏を取ってから行うこと。
 */
const session = (
  grade: string,
  ranks: string,
  overrides: Partial<RacerPtSessionInput> = {},
): RacerPtSessionInput => ({
  source: "national",
  startDate: "2026-07-01",
  endDate: "2026-07-06",
  stadiumName: "住之江",
  grade,
  ranks,
  ...overrides,
});

describe("racerPtGradeBucket", () => {
  it("SG / PG / GⅠ を SG_GI バケットに寄せる", () => {
    expect(racerPtGradeBucket("ＳＧ")).toBe("SG_GI");
    expect(racerPtGradeBucket("ＰＧ１")).toBe("SG_GI");
    expect(racerPtGradeBucket("ＧⅠ")).toBe("SG_GI");
  });

  it("GⅡ / GⅢ をそれぞれのバケットに割り当てる", () => {
    expect(racerPtGradeBucket("ＧⅡ")).toBe("GII");
    expect(racerPtGradeBucket("ＧⅢ")).toBe("GIII");
  });

  it("一般戦・空文字・未知の文字列は GIII バケットに落ちる", () => {
    expect(racerPtGradeBucket("一般")).toBe("GIII");
    expect(racerPtGradeBucket("")).toBe("GIII");
    expect(racerPtGradeBucket("企画レース")).toBe("GIII");
  });
});

describe("racerPtScoreFor", () => {
  it("スコア表どおりの値を返す", () => {
    expect(racerPtScoreFor("SG_GI", 1, true)).toBe(100);
    expect(racerPtScoreFor("SG_GI", 1, false)).toBe(85);
    expect(racerPtScoreFor("GII", 3, false)).toBe(62);
    expect(racerPtScoreFor("GIII", 6, false)).toBe(45);
    expect(racerPtScoreFor("GIII", 1, true)).toBe(65);
  });

  it("1-6 の範囲外は 0", () => {
    expect(racerPtScoreFor("GIII", 0, false)).toBe(0);
    expect(racerPtScoreFor("GIII", 7, false)).toBe(0);
  });
});

describe("roundHalfToEven", () => {
  it("Python の round() と同じ偶数丸めをする", () => {
    expect(roundHalfToEven(56.5)).toBe(56);
    expect(roundHalfToEven(57.5)).toBe(58);
    expect(roundHalfToEven(57.4)).toBe(57);
    expect(roundHalfToEven(57.6)).toBe(58);
  });
});

describe("computeRacerPtBreakdown", () => {
  it("一般戦の 1〜6 着を集計する (Python 参照値 52)", () => {
    const r = computeRacerPtBreakdown([session("一般", "１２３４５６")]);
    expect(r.totalScore).toBe(314);
    expect(r.totalRuns).toBe(6);
    expect(r.basePoint).toBe(52);
  });

  it("優勝戦 [N] に優勝戦スコアを適用する (Python 参照値 89)", () => {
    const r = computeRacerPtBreakdown([session("ＳＧ", "１　２[１]")]);
    expect(r.totalScore).toBe(267);
    expect(r.totalRuns).toBe(3);
    expect(r.basePoint).toBe(89);
  });

  it("GⅡ の日区切りを含む着順列を集計する (Python 参照値 58)", () => {
    const r = computeRacerPtBreakdown([session("ＧⅡ", "４６３　３　１５４３６")]);
    expect(r.totalScore).toBe(526);
    expect(r.totalRuns).toBe(9);
    expect(r.basePoint).toBe(58);
  });

  it("F / L は 0 点だが出走回数に計上する (Python 参照値 30)", () => {
    const r = computeRacerPtBreakdown([session("一般", "１F２L")]);
    expect(r.totalScore).toBe(118);
    expect(r.totalRuns).toBe(4);
    expect(r.basePoint).toBe(30);
  });

  it("失 / 妨 も選手責任として出走回数に計上する (Python 参照値 20)", () => {
    const r = computeRacerPtBreakdown([session("一般", "１失妨")]);
    expect(r.totalScore).toBe(60);
    expect(r.totalRuns).toBe(3);
    expect(r.basePoint).toBe(20);
  });

  it("転 / 落 / 沈 / エ / 欠 / 不 は分子・分母とも除外する (Python 参照値 59)", () => {
    const r = computeRacerPtBreakdown([session("一般", "１転落沈エ欠不２")]);
    expect(r.totalScore).toBe(118);
    expect(r.totalRuns).toBe(2);
    expect(r.basePoint).toBe(59);
  });

  it("優勝戦の括弧に着順以外が入る [F] / [妨] は読み捨てる (Python 参照値 59)", () => {
    // bare な 妨 は出走に計上されるが (39)、括弧付きは計上されない (59)。
    // BoatraceCSV の parse_finishes() が括弧内から着順の数字だけを拾うため。
    for (const ranks of ["１[妨]２", "１[F]２", "１[]２"]) {
      const r = computeRacerPtBreakdown([session("一般", ranks)]);
      expect(r.totalRuns).toBe(2);
      expect(r.basePoint).toBe(59);
    }
    expect(computeRacerPtBreakdown([session("一般", "１妨２")]).basePoint).toBe(39);
  });

  it("出走が 0 回なら basePoint は null (index CSV 側で 30 補完される)", () => {
    expect(computeRacerPtBreakdown([]).basePoint).toBeNull();
    expect(computeRacerPtBreakdown([session("一般", "転欠")]).basePoint).toBeNull();
  });

  it("同一節が全国・当地の両方にあると二重計上され duplicated が立つ", () => {
    const r = computeRacerPtBreakdown([
      session("一般", "１２３"),
      session("一般", "１２３", { source: "local" }),
    ]);
    // Python 側も重複排除しないため 6 走・346 点になる
    expect(r.totalScore).toBe(346);
    expect(r.totalRuns).toBe(6);
    expect(r.basePoint).toBe(58);
    expect(r.sessions.every((s) => s.duplicated)).toBe(true);
  });

  it("場・期間が違う節は duplicated にしない", () => {
    const r = computeRacerPtBreakdown([
      session("一般", "１２３"),
      session("一般", "１２３", { source: "local", stadiumName: "尼崎" }),
    ]);
    expect(r.sessions.every((s) => !s.duplicated)).toBe(true);
  });

  it("偶数丸めのケースで Python と一致する (113/2 = 56.5 → 56)", () => {
    const r = computeRacerPtBreakdown([session("一般", "２３")]);
    expect(r.totalScore).toBe(113);
    expect(r.totalRuns).toBe(2);
    expect(r.basePoint).toBe(56);
  });

  it("marks に着順ごとの適用スコアと除外トークンが入る", () => {
    const [s] = computeRacerPtBreakdown([session("一般", "１　F転")]).sessions;
    expect(s?.marks).toEqual([
      { kind: "rank", rank: 1, yusho: false, score: 60 },
      { kind: "separator" },
      { kind: "responsible", token: "F" },
      { kind: "excluded", token: "転" },
    ]);
  });
});

describe("racerPtSessionInputs", () => {
  it("全国 → 当地 の順（Python の build_recent_records と同順）に並べる", () => {
    const inputs = racerPtSessionInputs({
      national: [{ startDate: "", endDate: "", stadiumName: "住之江", grade: "一般", ranks: "１" }],
      local: [{ startDate: "", endDate: "", stadiumName: "尼崎", grade: "ＧⅢ", ranks: "２" }],
    });
    expect(inputs.map((s) => s.source)).toEqual(["national", "local"]);
    expect(inputs.map((s) => s.stadiumName)).toEqual(["住之江", "尼崎"]);
  });
});
