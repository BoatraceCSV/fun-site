import type { RaceResultRow } from "@fun-site/shared";
import { extractTopThree, isSettledResult } from "@fun-site/shared";
import { describe, expect, it } from "vitest";

const makeResult = (finishes: readonly (readonly [number, number])[]): RaceResultRow => ({
  raceCode: "202605021201",
  raceDate: "2026-05-02",
  stadiumId: "12",
  raceNumber: 1,
  votingDeadline: "",
  fetchedAt: "",
  recordedAt: "",
  kimarite: "",
  finishes: finishes.map(([rank, boatNumber]) => ({
    rank,
    boatNumber,
    racerName: "",
    raceTime: "",
  })),
  courses: [],
  weather: {
    weather: "1",
    windDirection: "北",
    windSpeed: 3,
    waveHeight: 2,
    airTemperature: 20,
    waterTemperature: 20,
  },
});

describe("isSettledResult", () => {
  it("結果なし (undefined) は未確定", () => {
    expect(isSettledResult(undefined)).toBe(false);
  });
  it("1〜3 着が揃っていれば確定", () => {
    expect(
      isSettledResult(
        makeResult([
          [1, 3],
          [2, 1],
          [3, 5],
        ]),
      ),
    ).toBe(true);
  });
  it("着順が揃わない (部分確定・中止) は未確定", () => {
    expect(
      isSettledResult(
        makeResult([
          [1, 3],
          [2, 1],
        ]),
      ),
    ).toBe(false);
    expect(isSettledResult(makeResult([]))).toBe(false);
  });
  it("同一艇が重複する異常結果は未確定扱い", () => {
    expect(
      isSettledResult(
        makeResult([
          [1, 3],
          [2, 3],
          [3, 5],
        ]),
      ),
    ).toBe(false);
  });
});

describe("extractTopThree", () => {
  it("1〜3 着を [1着, 2着, 3着] で返す", () => {
    expect(
      extractTopThree(
        makeResult([
          [1, 3],
          [2, 1],
          [3, 5],
        ]),
      ),
    ).toEqual([3, 1, 5]);
  });
  it("いずれかが欠ければ undefined", () => {
    expect(
      extractTopThree(
        makeResult([
          [1, 3],
          [3, 5],
        ]),
      ),
    ).toBeUndefined();
  });
});
