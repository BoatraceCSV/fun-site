import { describe, expect, it } from "vitest";
import { buildRaceCode, parseRaceCode } from "../utils/race-code.js";

describe("parseRaceCode", () => {
  it("should parse a valid 12-digit race code", () => {
    const parsed = parseRaceCode("202403150112");
    expect(parsed).toEqual({
      year: 2024,
      month: 3,
      day: 15,
      stadiumId: "01",
      raceNumber: 12,
      date: "2024-03-15",
    });
  });

  it("should parse stadium 24 (大村)", () => {
    const parsed = parseRaceCode("202401012401");
    expect(parsed.stadiumId).toBe("24");
    expect(parsed.raceNumber).toBe(1);
    expect(parsed.date).toBe("2024-01-01");
  });

  it("should throw for invalid length", () => {
    expect(() => parseRaceCode("12345")).toThrow("Invalid race code length");
    expect(() => parseRaceCode("1234567890123")).toThrow("Invalid race code length");
    expect(() => parseRaceCode("")).toThrow("Invalid race code length");
  });
});

describe("buildRaceCode", () => {
  it("should build a 12-digit race code from parts", () => {
    const code = buildRaceCode("01", "2024-03-15", 12);
    expect(code).toBe("202403150112");
  });

  it("should pad race number with leading zero", () => {
    const code = buildRaceCode("24", "2024-01-01", 1);
    expect(code).toBe("202401012401");
  });

  it("should throw for invalid date format", () => {
    expect(() => buildRaceCode("01", "20240315", 1)).toThrow("Invalid date format");
    expect(() => buildRaceCode("01", "", 1)).toThrow("Invalid date format");
  });

  it("should roundtrip with parseRaceCode", () => {
    const original = "202403150112";
    const parsed = parseRaceCode(original);
    const rebuilt = buildRaceCode(parsed.stadiumId, parsed.date, parsed.raceNumber);
    expect(rebuilt).toBe(original);
  });
});
