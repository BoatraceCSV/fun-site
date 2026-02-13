import { describe, expect, it } from "vitest";
import { STADIUMS, getStadiumById, getStadiumByName } from "../constants/stadiums.js";

describe("STADIUMS", () => {
  it("should contain all 24 stadiums", () => {
    expect(STADIUMS).toHaveLength(24);
  });

  it("should have unique IDs", () => {
    const ids = STADIUMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(24);
  });

  it("should have unique names", () => {
    const names = STADIUMS.map((s) => s.name);
    expect(new Set(names).size).toBe(24);
  });

  it("should have IDs from 01 to 24", () => {
    for (let i = 1; i <= 24; i++) {
      const id = String(i).padStart(2, "0");
      expect(STADIUMS.find((s) => s.id === id)).toBeDefined();
    }
  });
});

describe("getStadiumById", () => {
  it("should return stadium for valid ID", () => {
    const stadium = getStadiumById("01");
    expect(stadium).toEqual({ id: "01", name: "桐生", prefecture: "群馬県" });
  });

  it("should return 大村 for ID 24", () => {
    const stadium = getStadiumById("24");
    expect(stadium?.name).toBe("大村");
  });

  it("should return undefined for invalid ID", () => {
    expect(getStadiumById("00")).toBeUndefined();
    expect(getStadiumById("25")).toBeUndefined();
    expect(getStadiumById("")).toBeUndefined();
  });
});

describe("getStadiumByName", () => {
  it("should return stadium for valid name", () => {
    const stadium = getStadiumByName("平和島");
    expect(stadium).toEqual({ id: "04", name: "平和島", prefecture: "東京都" });
  });

  it("should return undefined for invalid name", () => {
    expect(getStadiumByName("存在しない")).toBeUndefined();
    expect(getStadiumByName("")).toBeUndefined();
  });
});
