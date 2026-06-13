import { describe, expect, it } from "vitest";
import type { AiEvaluation, RaceRacer } from "../types/prediction.js";
import {
  type OneMarkDistanceEntry,
  bettingToleranceFor,
  computeBettingPicks,
  computeOneMarkDistances,
} from "../utils/one-mark-distance.js";

const makeRacer = (boatNumber: number, avgST: number): RaceRacer => ({
  boatNumber,
  registrationNumber: 1000 + boatNumber,
  racerName: `R${boatNumber}`,
  classGrade: "B1",
  age: 30,
  branch: "東京",
  hometown: "東京",
  prizeExcluded: false,
  flyingCount: 0,
  lateCount: 0,
  nationalAvgST: avgST,
  nationalWinRate: 5,
  nationalTop2Rate: 30,
  nationalTop3Rate: 45,
  localWinRate: 5,
  localTop2Rate: 30,
  localTop3Rate: 45,
  motorNumber: 10 + boatNumber,
  motorTop2Rate: 35,
  motorTop3Rate: 50,
  boatBodyNumber: 20 + boatNumber,
  boatTop2Rate: 33,
  boatTop3Rate: 48,
  sessionResults: [],
});

const makeAi = (entries: { boatNumber: number; strengthPt: number }[]): AiEvaluation => ({
  state: "realtime",
  componentKeys: ["waku", "racer", "motor", "exhibit", "weather"],
  entries: entries.map((e) => ({
    boatNumber: e.boatNumber,
    contribution: { waku: 0, racer: 0, motor: 0, exhibit: 0, weather: 0 },
    strengthPt: e.strengthPt,
  })),
});

describe("computeOneMarkDistances", () => {
  it("計算式 (1 - avgST) + strengthPt/50 - 1.6 で距離を出す", () => {
    const racers: RaceRacer[] = [makeRacer(1, 0.15), makeRacer(2, 0.2)];
    const ai = makeAi([
      { boatNumber: 1, strengthPt: 50 },
      { boatNumber: 2, strengthPt: 25 },
    ]);
    const result = computeOneMarkDistances(racers, ai);
    // 艇1: (1-0.15) + 50/50 - 1.6 = 0.85 + 1.0 - 1.6 = 0.25
    // 艇2: (1-0.20) + 25/50 - 1.6 = 0.80 + 0.5 - 1.6 = -0.30
    expect(result[0]?.distance).toBeCloseTo(0.25, 5);
    expect(result[1]?.distance).toBeCloseTo(-0.3, 5);
  });
});

describe("computeBettingPicks", () => {
  const entry = (boatNumber: number, distance: number): OneMarkDistanceEntry => ({
    boatNumber,
    avgST: 0,
    strengthPt: 0,
    distance,
  });

  it("各着の基準艇 ±0.10 以内の艇を艇番昇順で返す", () => {
    // 距離: 1=0.40, 2=0.39, 3=0.20, 4=0.35, 5=0.10, 6=0.05
    // 降順: 1(0.40), 2(0.39), 4(0.35), 3(0.20), 5(0.10), 6(0.05)
    const entries = [
      entry(1, 0.4),
      entry(2, 0.39),
      entry(3, 0.2),
      entry(4, 0.35),
      entry(5, 0.1),
      entry(6, 0.05),
    ];
    const picks = computeBettingPicks(entries);
    // 1着基準=0.40 → ±0.10: 1,2,4 (3=0.20差0.20不可)
    expect(picks.first).toEqual([1, 2, 4]);
    // 2着基準=0.39 → ±0.10: 1,2,4
    expect(picks.second).toEqual([1, 2, 4]);
    // 3着基準=0.35 → ±0.10: 1,2,3(差0.15不可),4
    // 1=差0.05 OK, 2=差0.04 OK, 3=差0.15 NG, 4=差0.00 OK
    expect(picks.third).toEqual([1, 2, 4]);
  });

  it("距離差がちょうど 0.10 の艇は候補に含む", () => {
    const entries = [
      entry(1, 0.5),
      entry(2, 0.4),
      entry(3, 0.3),
      entry(4, 0.2),
      entry(5, 0.1),
      entry(6, 0.0),
    ];
    const picks = computeBettingPicks(entries);
    // 1着基準=0.5: ±0.10で0.4まで → 1,2
    expect(picks.first).toEqual([1, 2]);
    // 2着基準=0.4: ±0.10で0.3〜0.5 → 1,2,3
    expect(picks.second).toEqual([1, 2, 3]);
    // 3着基準=0.3: ±0.10で0.2〜0.4 → 2,3,4
    expect(picks.third).toEqual([2, 3, 4]);
  });

  it("同値があっても降順N番目の艇の距離を基準にする", () => {
    // 1=0.40, 2=0.40, 3=0.35, 4=0.20, 5=0.10, 6=0.05
    // 降順上位3: 0.40, 0.40, 0.35
    const entries = [
      entry(1, 0.4),
      entry(2, 0.4),
      entry(3, 0.35),
      entry(4, 0.2),
      entry(5, 0.1),
      entry(6, 0.05),
    ];
    const picks = computeBettingPicks(entries);
    expect(picks.first).toEqual([1, 2, 3]); // 0.4 ±0.1
    expect(picks.second).toEqual([1, 2, 3]); // 0.4 ±0.1
    expect(picks.third).toEqual([1, 2, 3]); // 0.35 ±0.1
  });

  it("着順別しきい値: 1着は絞り 3着は広げる", () => {
    // 距離: 1=0.40, 2=0.39, 3=0.20, 4=0.35, 5=0.10, 6=0.05
    // 降順: 1(0.40), 2(0.39), 4(0.35), 3(0.20), 5(0.10), 6(0.05)
    const entries = [
      entry(1, 0.4),
      entry(2, 0.39),
      entry(3, 0.2),
      entry(4, 0.35),
      entry(5, 0.1),
      entry(6, 0.05),
    ];
    // first=0.02, second=0.10, third=0.20
    const picks = computeBettingPicks(entries, { first: 0.02, second: 0.1, third: 0.2 });
    // 1着基準=0.40 ±0.02 → 1のみ (2=差0.01 OK)。2=0.39は差0.01 ≤ 0.02 なので含む
    expect(picks.first).toEqual([1, 2]);
    // 2着基準=0.39 ±0.10 → 1,2,4 (4=差0.04, 3=差0.19 NG)
    expect(picks.second).toEqual([1, 2, 4]);
    // 3着基準=0.35 ±0.20 → 1(0.05),2(0.04),3(0.15),4(0.00),5(0.25 NG) → 1,2,3,4
    expect(picks.third).toEqual([1, 2, 3, 4]);
  });

  it("1着候補が1艇だけのとき、その艇は下位着のデッド候補として除外する (3着窓の逆流)", () => {
    // 本命1艇が突出し、3着窓(±0.20)だけが1着艇まで届くケース
    // (boatrace-fun.net 2026-05-31/06/12R で観測された不具合の再現)。
    // 距離: 1=0.60(突出), 2=0.42, 3=0.41, 4=0.40, 5=0.39, 6=0.27
    const entries = [
      entry(1, 0.6),
      entry(2, 0.42),
      entry(3, 0.41),
      entry(4, 0.4),
      entry(5, 0.39),
      entry(6, 0.27),
    ];
    const picks = computeBettingPicks(entries, { first: 0.02, second: 0.1, third: 0.2 });
    // 1着基準=0.60 ±0.02 → 1 のみ
    expect(picks.first).toEqual([1]);
    // 2着基準=0.42 ±0.10 → [0.32,0.52]: 2,3,4,5 (1=0.60 は範囲外)
    expect(picks.second).toEqual([2, 3, 4, 5]);
    // 3着基準=0.41 ±0.20 → [0.21,0.61]: 窓自体は 1〜6 を含むが、1着は常に
    // 1号艇なので 1号艇は 3着で必ず自分自身と衝突して使えない → 除外
    expect(picks.third).toEqual([2, 3, 4, 5, 6]);
    expect(picks.third).not.toContain(1);
  });

  it("1着候補が複数艇あるときは、その艇を下位着に残す (有効な出目で使えるため)", () => {
    // 距離差がちょうど 0.10 のテストと同じ配置。first=[1,2] のとき
    // 1号艇は「1着=2号艇」の出目で 2着/3着 に使えるので残る。
    const entries = [
      entry(1, 0.5),
      entry(2, 0.4),
      entry(3, 0.3),
      entry(4, 0.2),
      entry(5, 0.1),
      entry(6, 0.0),
    ];
    const picks = computeBettingPicks(entries);
    expect(picks.first).toEqual([1, 2]);
    expect(picks.second).toEqual([1, 2, 3]); // 1号艇は残る
    expect(picks.third).toEqual([2, 3, 4]);
  });

  it("bettingToleranceFor: 現状オーバーライド無しで全予想者 既定 ±0.10", () => {
    expect(bettingToleranceFor("v1_basic")).toEqual({ first: 0.1, second: 0.1, third: 0.1 });
    expect(bettingToleranceFor(undefined)).toEqual({ first: 0.1, second: 0.1, third: 0.1 });
    // 展開予想撤去で B君予想を A君予想に揃えたため v2_tenkai も既定値。
    expect(bettingToleranceFor("v2_tenkai")).toEqual({ first: 0.1, second: 0.1, third: 0.1 });
  });
});
