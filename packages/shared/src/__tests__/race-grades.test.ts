import { describe, expect, it } from "vitest";
import { getRaceGradeBadge } from "../constants/race-grades.js";

describe("getRaceGradeBadge", () => {
  it("returns null for hidden codes (IP / empty)", () => {
    expect(getRaceGradeBadge("")).toBeNull();
    expect(getRaceGradeBadge("IP")).toBeNull();
    expect(getRaceGradeBadge("一般")).toBeNull();
    expect(getRaceGradeBadge("  ")).toBeNull(); // trim 後は ""
  });

  it("maps SG / PG1 to their canonical badges", () => {
    expect(getRaceGradeBadge("SG")).toEqual({
      label: "SG",
      tailwindClass: "bg-amber-500 text-white",
    });
    expect(getRaceGradeBadge("PG1")).toEqual({
      label: "PG1",
      tailwindClass: "bg-orange-500 text-white",
    });
  });

  it("maps both G1/GI, G2/GII, G3/GIII upstream variants to the same badge", () => {
    const g1 = getRaceGradeBadge("G1");
    const gI = getRaceGradeBadge("GI");
    expect(g1).toEqual(gI);
    expect(g1?.label).toBe("G1");

    expect(getRaceGradeBadge("G2")?.label).toBe("G2");
    expect(getRaceGradeBadge("GII")?.label).toBe("G2");

    expect(getRaceGradeBadge("G3")?.label).toBe("G3");
    expect(getRaceGradeBadge("GIII")?.label).toBe("G3");
  });

  it("falls back to gray badge for unknown codes (preserves the raw label)", () => {
    expect(getRaceGradeBadge("XYZ")).toEqual({
      label: "XYZ",
      tailwindClass: "bg-gray-500 text-white",
    });
  });
});
