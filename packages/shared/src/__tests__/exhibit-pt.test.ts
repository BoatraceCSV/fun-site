import { describe, expect, it } from "vitest";
import {
  EXHIBIT_PT_DAILY_NEUTRAL,
  EXHIBIT_PT_SCALE,
  type ExhibitPtInput,
  computeExhibitPtAggregate,
} from "../utils/exhibit-pt.js";

/**
 * `computeExhibitPtAggregate()` は展示pt の再計算ではなく、同じ直前情報スナップショットの
 * 計測値（展示タイム・スタート展示ST）を展示pt と並べて順位で見比べるための参考値。
 */
const input = (boatNumber: number, overrides: Partial<ExhibitPtInput> = {}): ExhibitPtInput => ({
  boatNumber,
  exhibitionTime: null,
  exhibitionStartTiming: null,
  exhibitPt: undefined,
  ...overrides,
});

describe("computeExhibitPtAggregate", () => {
  it("展示タイムは速い順、展示pt は高い順で順位を付ける", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.8, exhibitPt: 55 }),
      input(2, { exhibitionTime: 6.7, exhibitPt: 60 }),
      input(3, { exhibitionTime: 6.9, exhibitPt: 45 }),
    ]);

    expect(agg.boats.map((b) => b.timeRank)).toEqual([2, 1, 3]);
    expect(agg.boats.map((b) => b.ptRank)).toEqual([2, 1, 3]);
    expect(agg.measuredTimeCount).toBe(3);
    expect(agg.ptCount).toBe(3);
  });

  it("同値は同順位にし、次の順位はその数だけ飛ばす", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7 }),
      input(2, { exhibitionTime: 6.7 }),
      input(3, { exhibitionTime: 6.9 }),
    ]);

    expect(agg.boats.map((b) => b.timeRank)).toEqual([1, 1, 3]);
  });

  it("未計測の艇には順位を付けず、計測できた艇だけで最速 / 最遅 / 開きを出す", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.75 }),
      input(2, { exhibitionTime: null }),
      input(3, { exhibitionTime: 6.95 }),
    ]);

    expect(agg.boats.map((b) => b.timeRank)).toEqual([1, null, 2]);
    expect(agg.measuredTimeCount).toBe(2);
    expect(agg.fastestTime).toBe(6.75);
    expect(agg.slowestTime).toBe(6.95);
    expect(agg.timeSpread).toBeCloseTo(0.2, 10);
    expect(agg.boats[0]?.gapToFastestTime).toBe(0);
    expect(agg.boats[2]?.gapToFastestTime).toBeCloseTo(0.2, 10);
    expect(agg.boats[1]?.gapToFastestTime).toBeNull();
  });

  it("スタート展示ST は負値（フライング側）も含めて速い順に並べる", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionStartTiming: 0.15 }),
      input(2, { exhibitionStartTiming: -0.02 }),
      input(3, { exhibitionStartTiming: null }),
    ]);

    expect(agg.boats.map((b) => b.startTimingRank)).toEqual([2, 1, null]);
    expect(agg.measuredStartTimingCount).toBe(2);
  });

  it("rankGap は展示pt順位 − 展示タイム順位（正なら展示タイムの速さの割に展示pt が低い）", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7, exhibitPt: 45 }), // 展示最速なのに pt 最下位
      input(2, { exhibitionTime: 6.8, exhibitPt: 55 }),
      input(3, { exhibitionTime: 6.9, exhibitPt: 50 }),
    ]);

    expect(agg.boats.map((b) => b.rankGap)).toEqual([2, -1, -1]);
  });

  it("展示タイムが速い艇ほど展示pt が高いレースでは順位相関が +1 になる", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7, exhibitPt: 62 }),
      input(2, { exhibitionTime: 6.8, exhibitPt: 55 }),
      input(3, { exhibitionTime: 6.9, exhibitPt: 48 }),
      input(4, { exhibitionTime: 7.0, exhibitPt: 41 }),
    ]);

    expect(agg.ptTimeAgreement).toBeCloseTo(1, 10);
  });

  it("展示タイムと展示pt が逆順のレースでは順位相関が −1 になる", () => {
    const agg = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7, exhibitPt: 41 }),
      input(2, { exhibitionTime: 6.8, exhibitPt: 48 }),
      input(3, { exhibitionTime: 6.9, exhibitPt: 62 }),
    ]);

    expect(agg.ptTimeAgreement).toBeCloseTo(-1, 10);
  });

  it("両方揃った艇が 3 未満、または全艇が中立値のレースでは順位相関を出さない", () => {
    const tooFew = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7, exhibitPt: 55 }),
      input(2, { exhibitionTime: 6.8, exhibitPt: 45 }),
      input(3, { exhibitionTime: null, exhibitPt: 50 }),
    ]);
    expect(tooFew.ptTimeAgreement).toBeNull();

    // daily 行は全艇が中立値 50 なので順位が付かず、相関も定義できない
    const daily = computeExhibitPtAggregate([
      input(1, { exhibitionTime: 6.7, exhibitPt: EXHIBIT_PT_DAILY_NEUTRAL }),
      input(2, { exhibitionTime: 6.8, exhibitPt: EXHIBIT_PT_DAILY_NEUTRAL }),
      input(3, { exhibitionTime: 6.9, exhibitPt: EXHIBIT_PT_DAILY_NEUTRAL }),
    ]);
    expect(daily.ptTimeAgreement).toBeNull();
  });

  it("艇番昇順に並べ替えて返す", () => {
    const agg = computeExhibitPtAggregate([
      input(6, { exhibitionTime: 6.9 }),
      input(1, { exhibitionTime: 6.7 }),
      input(3, { exhibitionTime: 6.8 }),
    ]);

    expect(agg.boats.map((b) => b.boatNumber)).toEqual([1, 3, 6]);
  });

  it("偏差値スケールは全成分共通の 50 ± 10", () => {
    expect(EXHIBIT_PT_SCALE).toEqual({ mean: 50, sd: 10 });
    expect(EXHIBIT_PT_DAILY_NEUTRAL).toBe(50);
  });
});
