import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateSlash,
  getPreviousDate,
  parseDate,
  toJSTDateString,
} from "../utils/date.js";

describe("toJSTDateString", () => {
  it("should format a Date to YYYY-MM-DD in JST", () => {
    // 2024-03-15 00:00:00 UTC = 2024-03-15 09:00:00 JST
    const date = new Date("2024-03-15T00:00:00Z");
    expect(toJSTDateString(date)).toBe("2024-03-15");
  });

  it("should handle date boundary at midnight JST", () => {
    // 2024-03-14 15:00:00 UTC = 2024-03-15 00:00:00 JST
    const date = new Date("2024-03-14T15:00:00Z");
    expect(toJSTDateString(date)).toBe("2024-03-15");
  });

  it("should handle date boundary just before midnight JST", () => {
    // 2024-03-14 14:59:59 UTC = 2024-03-14 23:59:59 JST
    const date = new Date("2024-03-14T14:59:59Z");
    expect(toJSTDateString(date)).toBe("2024-03-14");
  });

  it("should pad month and day with leading zeros", () => {
    const date = new Date("2024-01-05T00:00:00Z");
    expect(toJSTDateString(date)).toBe("2024-01-05");
  });
});

describe("formatDate", () => {
  it("should format Date as YYYY-MM-DD", () => {
    const date = new Date(2024, 2, 15); // March 15, 2024 (local)
    expect(formatDate(date)).toBe("2024-03-15");
  });

  it("should pad single-digit month and day", () => {
    const date = new Date(2024, 0, 5); // Jan 5, 2024
    expect(formatDate(date)).toBe("2024-01-05");
  });

  it("should handle December 31st", () => {
    const date = new Date(2024, 11, 31);
    expect(formatDate(date)).toBe("2024-12-31");
  });
});

describe("formatDateSlash", () => {
  it("should format Date as YYYY/MM/DD", () => {
    const date = new Date(2024, 2, 15);
    expect(formatDateSlash(date)).toBe("2024/03/15");
  });

  it("should pad single-digit month and day", () => {
    const date = new Date(2024, 0, 5);
    expect(formatDateSlash(date)).toBe("2024/01/05");
  });
});

describe("getPreviousDate", () => {
  it("should return the previous day", () => {
    const date = new Date(2024, 2, 15);
    const prev = getPreviousDate(date);
    expect(prev.getFullYear()).toBe(2024);
    expect(prev.getMonth()).toBe(2);
    expect(prev.getDate()).toBe(14);
  });

  it("should handle month boundary", () => {
    const date = new Date(2024, 2, 1); // March 1
    const prev = getPreviousDate(date);
    expect(prev.getMonth()).toBe(1); // February
    expect(prev.getDate()).toBe(29); // 2024 is a leap year
  });

  it("should handle year boundary", () => {
    const date = new Date(2024, 0, 1); // Jan 1, 2024
    const prev = getPreviousDate(date);
    expect(prev.getFullYear()).toBe(2023);
    expect(prev.getMonth()).toBe(11); // December
    expect(prev.getDate()).toBe(31);
  });

  it("should not mutate the original date", () => {
    const date = new Date(2024, 2, 15);
    getPreviousDate(date);
    expect(date.getDate()).toBe(15);
  });
});

describe("parseDate", () => {
  it("should parse YYYY-MM-DD string to Date", () => {
    const date = parseDate("2024-03-15");
    expect(date.getFullYear()).toBe(2024);
    expect(date.getMonth()).toBe(2); // 0-indexed
    expect(date.getDate()).toBe(15);
  });

  it("should throw for invalid format", () => {
    expect(() => parseDate("2024/03/15")).toThrow("Invalid date format");
    expect(() => parseDate("not-a-date")).toThrow("Invalid date format");
    expect(() => parseDate("")).toThrow("Invalid date format");
  });

  it("should throw for incomplete date", () => {
    expect(() => parseDate("2024-03")).toThrow("Invalid date format");
  });
});
