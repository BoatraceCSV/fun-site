import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  HOSTING_CONFIG,
  chunk,
  gzipAndHash,
  mergeHostingFiles,
} from "../site-builder/firebase-hosting.js";

describe("gzipAndHash", () => {
  it("同じ内容なら同じハッシュになり、gzip を戻すと元の内容になる", () => {
    const a = gzipAndHash(Buffer.from("<html>same</html>"));
    const b = gzipAndHash(Buffer.from("<html>same</html>"));
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(gunzipSync(a.gzipped).toString()).toBe("<html>same</html>");
    expect(gzipAndHash(Buffer.from("<html>other</html>")).hash).not.toBe(a.hash);
  });
});

describe("mergeHostingFiles", () => {
  const today = "2026-09-26";

  it("過去日付のページと保護プレフィックスは残し、今回の成果物で上書きする", () => {
    const previous = {
      "index.html": "old-top",
      "race/2026-09-25/01/1/index.html": "past-race",
      "race/2026-09-26/01/1/index.html": "old-today",
      "archive/2026-09-25/index.html": "past-archive",
      "_astro/app.abc.css": "css",
    };
    const merged = mergeHostingFiles(
      previous,
      [
        { path: "index.html", hash: "new-top" },
        { path: "race/2026-09-26/01/1/index.html", hash: "new-today" },
      ],
      today,
    );
    expect(merged).toEqual({
      "index.html": "new-top",
      "race/2026-09-25/01/1/index.html": "past-race",
      "race/2026-09-26/01/1/index.html": "new-today",
      "archive/2026-09-25/index.html": "past-archive",
      "_astro/app.abc.css": "css",
    });
  });

  it("今回の成果物に無い当日ページと日付の無いページは削除する", () => {
    const merged = mergeHostingFiles(
      {
        "race/2026-09-26/02/1/index.html": "cancelled-race",
        "stats/old/index.html": "gone",
        "stadium/01/index.html": "kept-by-local",
      },
      [{ path: "stadium/01/index.html", hash: "s1" }],
      today,
    );
    expect(merged).toEqual({ "stadium/01/index.html": "s1" });
  });
});

describe("chunk", () => {
  it("指定件数ごとに分割する", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 1000)).toEqual([]);
  });
});

describe("HOSTING_CONFIG", () => {
  const htmlRule = HOSTING_CONFIG.headers.find((h) => "regex" in h);
  const htmlRe = new RegExp(htmlRule && "regex" in htmlRule ? htmlRule.regex : "$^");

  it("HTML 扱いの正規表現はディレクトリ URL・拡張子なし・.html にだけ一致する", () => {
    for (const path of ["/", "/race/2026-09-26/01/1/", "/stats", "/index.html", "/a/b.html"]) {
      expect(htmlRe.test(path), path).toBe(true);
    }
    for (const path of ["/_astro/app.abc.css", "/favicon.svg", "/sitemap.xml", "/a/b.json"]) {
      expect(htmlRe.test(path), path).toBe(false);
    }
  });
});
