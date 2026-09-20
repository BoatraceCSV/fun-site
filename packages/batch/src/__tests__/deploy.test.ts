import { describe, expect, it } from "vitest";
import { selectRemotePrefixes } from "../site-builder/deploy.js";

const TOP_LEVEL = [
  "_astro/",
  "_meta/",
  "archive/",
  "images/",
  "predictors/",
  "race/",
  "stadium/",
  "stats/",
];

describe("selectRemotePrefixes", () => {
  it("race/ と archive/ は当日のサブプレフィックスだけ、その他は丸ごと一覧する", () => {
    const local = [
      "index.html",
      "race/2026-09-20/01/1/index.html",
      "archive/2026-09-20/index.html",
      "stadium/01/index.html",
      "_astro/index.abc123.css",
    ];
    expect(selectRemotePrefixes(TOP_LEVEL, local, "2026-09-20")).toEqual([
      "_astro/",
      "archive/2026-09-20/",
      "predictors/",
      "race/2026-09-20/",
      "stadium/",
      "stats/",
    ]);
  });

  it("削除対象外のプレフィックスはローカル成果物が無ければ一覧しない", () => {
    const local = ["index.html", "race/2026-09-20/01/1/index.html"];
    const selected = selectRemotePrefixes(TOP_LEVEL, local, "2026-09-20");
    expect(selected).not.toContain("_astro/");
    expect(selected).not.toContain("_meta/");
    expect(selected).not.toContain("images/");
  });

  it("ローカル成果物に当日以外の日付 (バックフィル) があればその日付も一覧する", () => {
    const local = ["race/2026-09-01/01/1/index.html"];
    const selected = selectRemotePrefixes(["race/", "archive/"], local, "2026-09-20");
    expect(selected).toEqual([
      "archive/2026-09-01/",
      "archive/2026-09-20/",
      "race/2026-09-01/",
      "race/2026-09-20/",
    ]);
  });

  it("バケット側に無いプレフィックスは一覧しない", () => {
    expect(selectRemotePrefixes([], ["stadium/01/index.html"], "2026-09-20")).toEqual([]);
  });
});
