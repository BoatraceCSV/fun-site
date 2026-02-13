import { describe, expect, it } from "vitest";
import { BOAT_COLORS, getBoatColor, isValidBoatNumber } from "../constants/boat-colors.js";

describe("BOAT_COLORS", () => {
  it("should have 6 entries for boats 1-6", () => {
    expect(Object.keys(BOAT_COLORS)).toHaveLength(6);
  });

  it("should have correct color names", () => {
    expect(BOAT_COLORS[1].name).toBe("白");
    expect(BOAT_COLORS[2].name).toBe("黒");
    expect(BOAT_COLORS[3].name).toBe("赤");
    expect(BOAT_COLORS[4].name).toBe("青");
    expect(BOAT_COLORS[5].name).toBe("黄");
    expect(BOAT_COLORS[6].name).toBe("緑");
  });
});

describe("isValidBoatNumber", () => {
  it("should return true for valid boat numbers 1-6", () => {
    for (let i = 1; i <= 6; i++) {
      expect(isValidBoatNumber(i)).toBe(true);
    }
  });

  it("should return false for invalid boat numbers", () => {
    expect(isValidBoatNumber(0)).toBe(false);
    expect(isValidBoatNumber(7)).toBe(false);
    expect(isValidBoatNumber(-1)).toBe(false);
  });
});

describe("getBoatColor", () => {
  it("should return color for boat 1", () => {
    const color = getBoatColor(1);
    expect(color.name).toBe("白");
    expect(color.hex).toBe("#FFFFFF");
    expect(color.textHex).toBe("#000000");
  });

  it("should return color for boat 6", () => {
    const color = getBoatColor(6);
    expect(color.name).toBe("緑");
    expect(color.hex).toBe("#008000");
  });
});
