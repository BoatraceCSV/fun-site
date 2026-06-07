import { describe, expect, it } from "vitest";
import { parseSui, parseTkz } from "../fetcher/preview-schemas.js";

// === tkz (体重・展示タイム・チルト) ===

const TKZ_HEADER = [
  "レースコード",
  "レース日",
  "レース場",
  "レース回",
  "締切時刻",
  "取得日時",
  "状態",
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => [
    `艇${n}_体重(kg)`,
    `艇${n}_体重調整(kg)`,
    `艇${n}_展示タイム`,
    `艇${n}_チルト`,
  ]),
].join(",");

describe("parseTkz", () => {
  it("先頭6列メタ + 6艇 × {体重/体重調整/展示タイム/チルト} をパースする", () => {
    const meta = [
      "202606062101",
      "2026-06-06",
      "21",
      "01R",
      "08:32",
      "2026-06-06T08:22:18+09:00",
      "1",
    ];
    // 艇1: 52.9 / 0.0 / 6.79 / 0.0、艇3: 44.5 / 2.5 / 6.83 / 0.0、艇2 チルト -0.5
    const boats = [
      ["52.9", "0.0", "6.79", "0.0"],
      ["52.3", "0.0", "6.74", "-0.5"],
      ["44.5", "2.5", "6.83", "0.0"],
      ["53.7", "0.0", "6.78", "0.0"],
      ["52.3", "0.0", "6.66", "0.0"],
      ["52.5", "0.0", "6.74", "0.0"],
    ].flat();
    const csv = `${TKZ_HEADER}\n${[...meta, ...boats].join(",")}\n`;

    const rows = parseTkz(csv);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.raceCode).toBe("202606062101");
    expect(row?.stadiumId).toBe("21");
    expect(row?.raceNumber).toBe(1);
    expect(row?.boats).toHaveLength(6);
    expect(row?.boats[0]).toEqual({
      boatNumber: 1,
      weightKg: 52.9,
      weightAdjustKg: 0,
      exhibitionTime: 6.79,
      tilt: 0,
    });
    expect(row?.boats[1]?.tilt).toBe(-0.5);
    expect(row?.boats[2]?.weightAdjustKg).toBe(2.5);
  });
});

// === sui (水面気象) ===

const SUI_HEADER = [
  "レースコード",
  "レース日",
  "レース場",
  "レース回",
  "締切時刻",
  "取得日時",
  "気象観測時刻",
  "風速(m)",
  "風向",
  "波の高さ(cm)",
  "天候",
  "気温(℃)",
  "水温(℃)",
].join(",");

describe("parseSui", () => {
  it("気象スナップショットをパースする（風向は生値、空欄可）", () => {
    const cells = [
      "202606062101",
      "2026-06-06",
      "21",
      "01R",
      "08:32",
      "2026-06-06T08:22:18+09:00",
      "0755",
      "0.0",
      "", // 風向（空欄）
      "1.0",
      "1", // 天候コード
      "22.2",
      "24.3",
    ];
    const csv = `${SUI_HEADER}\n${cells.join(",")}\n`;

    const rows = parseSui(csv);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.raceCode).toBe("202606062101");
    expect(row?.observedAt).toBe("0755");
    expect(row?.windSpeed).toBe(0);
    expect(row?.windDirection).toBe("");
    expect(row?.waveHeight).toBe(1);
    expect(row?.weather).toBe("1");
    expect(row?.airTemperature).toBe(22.2);
    expect(row?.waterTemperature).toBe(24.3);
  });
});
